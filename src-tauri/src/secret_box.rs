//! Chiffrement at-rest des tokens OAuth (AES-256-GCM).
//! Clé maître dans le trousseau OS (`keyring`) + miroir fichier AppData.
//! Les deux sont toujours synchronisés pour ne jamais perdre l’accès aux tokens.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const PREFIX: &str = "bo1:";
const KEYRING_SERVICE: &str = "com.eliot.bassorder";
const KEYRING_USER: &str = "token-encryption-key";

static MASTER_KEY: OnceLock<[u8; 32]> = OnceLock::new();
/// Ancienne clé (fichier) si elle diffère du trousseau — sert uniquement à `open`.
static FALLBACK_KEY: OnceLock<[u8; 32]> = OnceLock::new();

fn key_file_path(app_data: &Path) -> PathBuf {
    app_data.join(".token-key")
}

fn write_key_file(app_data: &Path, key: &[u8; 32]) {
    let path = key_file_path(app_data);
    let _ = std::fs::create_dir_all(app_data);
    let _ = std::fs::write(&path, B64.encode(key));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

fn try_keyring_get() -> Option<[u8; 32]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    let pw = entry.get_password().ok()?;
    let raw = B64.decode(pw.as_bytes()).ok()?;
    if raw.len() != 32 {
        return None;
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&raw);
    Some(key)
}

fn try_keyring_set(key: &[u8; 32]) -> bool {
    let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) else {
        return false;
    };
    entry.set_password(&B64.encode(key)).is_ok()
}

fn load_or_create_key(app_data: &Path) -> Result<[u8; 32], String> {
    let file_key = read_key_file(app_data);
    let ring_key = try_keyring_get();

    match (ring_key, file_key) {
        (Some(ring), Some(file)) if ring != file => {
            // Tokens peuvent avoir été scellés avec l’une ou l’autre.
            // Clé courante = trousseau ; fallback = fichier pour `open`.
            let _ = FALLBACK_KEY.set(file);
            eprintln!(
                "[bassorder] deux clés tokens détectées (trousseau ≠ fichier) — fallback actif"
            );
            Ok(ring)
        }
        (Some(ring), _) => {
            write_key_file(app_data, &ring);
            Ok(ring)
        }
        (None, Some(file)) => {
            let _ = try_keyring_set(&file);
            write_key_file(app_data, &file);
            Ok(file)
        }
        (None, None) => {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let _ = try_keyring_set(&key);
            write_key_file(app_data, &key);
            tracing_warn_fallback();
            Ok(key)
        }
    }
}

fn read_key_file(app_data: &Path) -> Option<[u8; 32]> {
    let path = key_file_path(app_data);
    if !path.exists() {
        return None;
    }
    let raw = std::fs::read(&path).ok()?;
    let decoded = B64.decode(&raw).ok()?;
    if decoded.len() != 32 {
        return None;
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&decoded);
    Some(key)
}

fn tracing_warn_fallback() {
    eprintln!("[bassorder] clé tokens : créée (trousseau + fichier AppData)");
}

/// Initialise la clé (à appeler au démarrage avec le dossier AppData).
pub fn init(app_data: &Path) -> Result<(), String> {
    let key = load_or_create_key(app_data)?;
    let _ = MASTER_KEY.set(key);
    Ok(())
}

fn cipher_with(key: &[u8; 32]) -> Result<Aes256Gcm, String> {
    Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())
}

fn cipher() -> Result<Aes256Gcm, String> {
    let key = MASTER_KEY
        .get()
        .ok_or_else(|| "Chiffrement non initialisé.".to_string())?;
    cipher_with(key)
}

/// Chiffre un secret. Chaîne vide → vide.
pub fn seal(plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    if plaintext.starts_with(PREFIX) {
        return Ok(plaintext.to_string());
    }
    let cipher = cipher()?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("chiffrement: {e}"))?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(format!("{PREFIX}{}", B64.encode(out)))
}

fn open_with(cipher: &Aes256Gcm, stored: &str) -> Result<String, String> {
    let Some(rest) = stored.strip_prefix(PREFIX) else {
        return Ok(stored.to_string());
    };
    let raw = B64.decode(rest.as_bytes()).map_err(|e| e.to_string())?;
    if raw.len() < 13 {
        return Err("Blob chiffré invalide.".into());
    }
    let (nonce_bytes, ciphertext) = raw.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Impossible de déchiffrer le token (clé différente ?).".to_string())?;
    String::from_utf8(plain).map_err(|e| e.to_string())
}

/// Déchiffre ; accepte encore le clair (migration).
/// Essaie la clé courante puis l’éventuelle clé fallback (fichier ancien).
pub fn open(stored: &str) -> Result<String, String> {
    if stored.is_empty() {
        return Ok(String::new());
    }
    if !stored.starts_with(PREFIX) {
        return Ok(stored.to_string());
    }
    let primary = cipher()?;
    match open_with(&primary, stored) {
        Ok(v) => Ok(v),
        Err(e) => {
            if let Some(fb) = FALLBACK_KEY.get() {
                let alt = cipher_with(fb)?;
                if let Ok(v) = open_with(&alt, stored) {
                    eprintln!("[bassorder] token déchiffré via clé fallback");
                    return Ok(v);
                }
            }
            Err(e)
        }
    }
}

/// `true` si la valeur semble déjà chiffrée.
#[allow(dead_code)]
pub fn is_sealed(stored: &str) -> bool {
    stored.starts_with(PREFIX)
}
