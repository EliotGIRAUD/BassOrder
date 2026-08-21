//! Garde-fous fichiers / chemins pour BassOrder (desktop Tauri).
//! Empêche l’import et la lecture de contenus hors musique légitime.

use lofty::file::FileType;
use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Taille max d’un fichier audio lu / importé (~500 Mo).
pub const MAX_AUDIO_BYTES: u64 = 500 * 1024 * 1024;
/// Taille min pour écarter les leurres vides / stubs.
pub const MIN_AUDIO_BYTES: u64 = 256;
/// Taille max d’une pochette embarquée renvoyée en data-URL.
pub const MAX_COVER_BYTES: usize = 8 * 1024 * 1024;
/// Plafond de fichiers audio par scan (anti DoS).
pub const MAX_SCAN_FILES: usize = 50_000;
/// Profondeur max de parcours (anti zip-bomb de dossiers).
pub const MAX_WALK_DEPTH: usize = 32;
/// Octets lus pour le sniff « magic bytes ».
const SNIFF_LEN: usize = 64;

const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "aiff", "aif", "ape", "wv", "mpc", "m4b",
];

/// Extensions refusées même si le contenu ressemble à de l’audio (souvent vidéo / conteneurs risqués).
const BLOCKED_EXTS: &[&str] = &[
    "exe", "dll", "bat", "cmd", "ps1", "vbs", "js", "jse", "wsf", "scr", "msi", "com", "pif",
    "jar", "apk", "dmg", "iso", "img", "bin", "sh", "bash", "zsh", "py", "rb", "php", "html",
    "htm", "svg", "xml", "json", "lnk", "url", "reg", "sys", "drv", "cpl", "msp", "msu", "cab",
    "zip", "rar", "7z", "tar", "gz", "xz", "torrent", "docm", "xlsm", "pptm",
];

static ALLOWED_ROOTS: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

fn roots_lock() -> std::sync::MutexGuard<'static, Option<HashSet<PathBuf>>> {
    ALLOWED_ROOTS.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn is_allowed_audio_extension(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let lower = ext.to_ascii_lowercase();
    if BLOCKED_EXTS.iter().any(|b| *b == lower) {
        return false;
    }
    AUDIO_EXTS.iter().any(|a| *a == lower)
}

/// Sidecars macOS / Windows qui se font passer pour de l’audio (ex. `._titre.mp3`).
pub fn is_junk_sidecar_name(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    // AppleDouble resource fork : toujours `._` + nom du fichier réel.
    if name.starts_with("._") {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        ".ds_store" | "thumbs.db" | "desktop.ini" | ".localized" | "albumartsmall.jpg"
    )
}

pub fn is_blocked_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| BLOCKED_EXTS.iter().any(|b| e.eq_ignore_ascii_case(b)))
}

/// Dossiers système / secrets : on refuse de scanner ou d’organiser ici.
pub fn is_sensitive_path(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    let markers = [
        r"\windows\system32",
        r"\windows\syswow64",
        r"\windows\winsxs",
        r"\program files\",
        r"\program files (x86)\",
        r"\$recycle.bin",
        "/etc/",
        "/usr/bin",
        "/usr/sbin",
        "/bin/",
        "/sbin/",
        "/System/Library",
        "/private/etc",
        "/.ssh/",
        "\\.ssh\\",
        "/.gnupg/",
        "\\.gnupg\\",
        "/.aws/",
        "\\.aws\\",
        "credentials.json",
        "id_rsa",
        "id_ed25519",
    ];
    if markers.iter().any(|m| lower.contains(m)) {
        return true;
    }

    for component in path.components() {
        let Component::Normal(name) = component else {
            continue;
        };
        let name = name.to_string_lossy();
        let n = name.to_ascii_lowercase();
        if matches!(
            n.as_str(),
            "windows" | "system32" | "syswow64" | "$recycle.bin" | "recycle.bin"
        ) {
            // « Windows » seul en milieu de chemin utilisateur (ex. dossier musique) :
            // on ne bloque que s’il est près de la racine disque.
            continue;
        }
        if n == ".ssh" || n == ".gnupg" || n == ".aws" {
            return true;
        }
    }

    // Racines système Windows (C:\Windows, etc.)
    if let Some(first) = path.components().nth(1) {
        if let Component::Normal(name) = first {
            let n = name.to_string_lossy().to_ascii_lowercase();
            if n == "windows" || n == "program files" || n == "program files (x86)" {
                return true;
            }
        }
    }

    false
}

pub fn canonicalize_dir(path: &Path) -> Result<PathBuf, String> {
    if !path.is_dir() {
        return Err("Ce chemin n'est pas un dossier.".into());
    }
    if is_sensitive_path(path) {
        return Err("Ce dossier système ou sensible ne peut pas être importé.".into());
    }
    // dunce enlève le préfixe Windows `\\?\` qui casse Path::starts_with.
    let canon = dunce::canonicalize(path).map_err(|e| e.to_string())?;
    if is_sensitive_path(&canon) {
        return Err("Ce dossier système ou sensible ne peut pas être importé.".into());
    }
    Ok(canon)
}

/// `root` doit idéalement être déjà canonique (via `canonicalize_dir`).
pub fn is_within(root: &Path, child: &Path) -> bool {
    let Ok(child) = dunce::canonicalize(child) else {
        return false;
    };
    let root = dunce::canonicalize(root).unwrap_or_else(|_| normalize_windows_path(root));
    child.starts_with(&root)
}

fn normalize_windows_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

pub fn register_allowed_root(root: PathBuf) {
    let mut guard = roots_lock();
    let set = guard.get_or_insert_with(HashSet::new);
    set.insert(root);
}

pub fn is_under_allowed_root(path: &Path) -> bool {
    let Ok(canon) = dunce::canonicalize(path) else {
        return false;
    };
    let guard = roots_lock();
    let Some(set) = guard.as_ref() else {
        return false;
    };
    set.iter().any(|root| {
        let Ok(root) = dunce::canonicalize(root) else {
            return canon.starts_with(root);
        };
        canon.starts_with(&root)
    })
}

/// Enregistre le dossier bibliothèque + ouvre le scope asset protocol (preview audio).
pub fn ensure_library_access(app: &AppHandle, root: &str) -> Result<PathBuf, String> {
    let root_path = PathBuf::from(root);
    let canon = canonicalize_dir(&root_path)?;
    register_allowed_root(canon.clone());
    app.asset_protocol_scope()
        .allow_directory(&canon, true)
        .map_err(|e| format!("Impossible d’autoriser l’accès au dossier : {e}"))?;
    Ok(canon)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioReject {
    Extension,
    BlockedExt,
    Size,
    Magic,
    Sensitive,
    Io,
}

impl AudioReject {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Extension => "extension non audio",
            Self::BlockedExt => "type de fichier interdit",
            Self::Size => "taille hors limites",
            Self::Magic => "contenu non audio (signature invalide)",
            Self::Sensitive => "chemin sensible",
            Self::Io => "lecture impossible",
        }
    }
}

/// Extension + taille + magic bytes (pas seulement le nom de fichier).
pub fn validate_audio_file(path: &Path) -> Result<(), AudioReject> {
    if is_sensitive_path(path) {
        return Err(AudioReject::Sensitive);
    }
    if is_junk_sidecar_name(path) {
        return Err(AudioReject::Magic);
    }
    if is_blocked_extension(path) {
        return Err(AudioReject::BlockedExt);
    }
    if !is_allowed_audio_extension(path) {
        return Err(AudioReject::Extension);
    }

    let meta = std::fs::metadata(path).map_err(|_| AudioReject::Io)?;
    if !meta.is_file() {
        return Err(AudioReject::Io);
    }
    let len = meta.len();
    if len < MIN_AUDIO_BYTES || len > MAX_AUDIO_BYTES {
        return Err(AudioReject::Size);
    }

    if !sniff_matches_audio(path) {
        return Err(AudioReject::Magic);
    }
    Ok(())
}

fn sniff_matches_audio(path: &Path) -> bool {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut buf = [0u8; SNIFF_LEN];
    let n = match file.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return false,
    };
    if n < 4 {
        return false;
    }

    // AppleDouble / AppleSingle — souvent nommés `._*.mp3` après copie depuis un Mac.
    if looks_like_apple_double(&buf[..n]) {
        return false;
    }

    let Some(detected) = FileType::from_buffer(&buf[..n]) else {
        // Certains MP3 commencent par ID3 ou frames MPEG ; lofty gère souvent ça.
        // Si from_buffer échoue, on tente encore via l’extension + absence de signatures dangereuses.
        return !looks_like_executable(&buf[..n])
            && !looks_like_apple_double(&buf[..n])
            && extension_allows_soft_sniff(path);
    };

    matches!(
        detected,
        FileType::Mpeg
            | FileType::Flac
            | FileType::Mp4
            | FileType::Aac
            | FileType::Vorbis
            | FileType::Opus
            | FileType::Wav
            | FileType::Aiff
            | FileType::Ape
            | FileType::WavPack
            | FileType::Mpc
            | FileType::Speex
    ) && extension_compatible(path, detected)
}

fn extension_allows_soft_sniff(path: &Path) -> bool {
    // MP3 avec ID3 mal formé / padding : on accepte si extension mp3 uniquement.
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("mp3"))
}

fn extension_compatible(path: &Path, detected: FileType) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    let ext = ext.to_ascii_lowercase();
    match detected {
        FileType::Mpeg => ext == "mp3",
        FileType::Flac => ext == "flac",
        FileType::Mp4 => matches!(ext.as_str(), "m4a" | "m4b" | "aac"),
        FileType::Aac => matches!(ext.as_str(), "aac" | "m4a"),
        FileType::Vorbis => ext == "ogg",
        FileType::Opus => matches!(ext.as_str(), "opus" | "ogg"),
        FileType::Wav => ext == "wav",
        FileType::Aiff => matches!(ext.as_str(), "aiff" | "aif"),
        FileType::Ape => ext == "ape",
        FileType::WavPack => ext == "wv",
        FileType::Mpc => ext == "mpc",
        FileType::Speex => ext == "ogg",
        _ => false,
    }
}

fn looks_like_executable(buf: &[u8]) -> bool {
    if buf.len() >= 2 && buf[0] == b'M' && buf[1] == b'Z' {
        return true; // PE / DOS
    }
    if buf.len() >= 4 && buf[0] == 0x7f && &buf[1..4] == b"ELF" {
        return true;
    }
    if buf.len() >= 4 && buf[0] == 0xca && buf[1] == 0xfe && buf[2] == 0xba && buf[3] == 0xbe {
        return true; // Mach-O fat
    }
    if buf.len() >= 4 && &buf[0..4] == b"\x89PNG" {
        return true;
    }
    if buf.len() >= 4 && &buf[0..4] == b"%PDF" {
        return true;
    }
    false
}

/// Magic AppleSingle (`00 05 16 00`) / AppleDouble (`00 05 16 07`).
fn looks_like_apple_double(buf: &[u8]) -> bool {
    buf.len() >= 4
        && buf[0] == 0x00
        && buf[1] == 0x05
        && buf[2] == 0x16
        && (buf[3] == 0x07 || buf[3] == 0x00)
}

pub fn cover_data_allowed(data: &[u8]) -> bool {
    !data.is_empty() && data.len() <= MAX_COVER_BYTES && looks_like_image(data)
}

fn looks_like_image(data: &[u8]) -> bool {
    if data.len() < 4 {
        return false;
    }
    // JPEG
    if data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
        return true;
    }
    // PNG
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return true;
    }
    // GIF
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return true;
    }
    // BMP
    if data.starts_with(b"BM") {
        return true;
    }
    // TIFF
    if data.starts_with(b"II*\0") || data.starts_with(b"MM\0*") {
        return true;
    }
    // WebP
    if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        path.push(format!("bassorder-sec-{nanos}-{name}"));
        let mut f = File::create(&path).expect("create");
        f.write_all(bytes).expect("write");
        path
    }

    #[test]
    fn rejects_exe_renamed_mp3() {
        let mut data = b"MZ\x90\x00this is not audio".to_vec();
        data.resize(300, 0);
        let path = temp_file("evil.mp3", &data);
        assert_eq!(validate_audio_file(&path), Err(AudioReject::Magic));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn accepts_flac_header() {
        let mut data = b"fLaC".to_vec();
        data.extend(vec![0u8; 300]);
        let path = temp_file("ok.flac", &data);
        assert!(validate_audio_file(&path).is_ok());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_blocked_ext() {
        let path = Path::new("payload.exe");
        assert!(is_blocked_extension(path));
        assert!(!is_allowed_audio_extension(path));
    }

    #[test]
    fn rejects_apple_double_sidecar_name() {
        assert!(is_junk_sidecar_name(Path::new(r"D:\Musique\._JUMP.mp3")));
        assert!(is_junk_sidecar_name(Path::new("._2 AM-2.mp3")));
        assert!(!is_junk_sidecar_name(Path::new("_Diggy Diggy Hole.mp3")));
        assert!(!is_junk_sidecar_name(Path::new("JUMP.mp3")));
    }

    #[test]
    fn rejects_apple_double_magic() {
        let mut data = vec![0x00, 0x05, 0x16, 0x07];
        data.resize(300, 0);
        let path = temp_file("sidecar.mp3", &data);
        assert_eq!(validate_audio_file(&path), Err(AudioReject::Magic));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_tiny_files() {
        let path = temp_file("tiny.mp3", b"ID3");
        assert_eq!(validate_audio_file(&path), Err(AudioReject::Size));
        let _ = std::fs::remove_file(path);
    }
}
