//! PIN / mot de passe local par profil (Argon2id).

use crate::db::{emit_db_changed, with_conn, DbState};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand::rngs::OsRng;
use serde::Serialize;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAuthStatus {
    pub user_id: String,
    pub has_password: bool,
}

fn hash_secret(secret: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(secret.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| e.to_string())
}

fn verify_secret(secret: &str, hash: &str) -> Result<bool, String> {
    let parsed = PasswordHash::new(hash).map_err(|e| e.to_string())?;
    Ok(Argon2::default()
        .verify_password(secret.as_bytes(), &parsed)
        .is_ok())
}

fn load_hash(state: &State<'_, DbState>, user_id: &str) -> Result<Option<String>, String> {
    with_conn(state, |conn| {
        conn.query_row(
            "SELECT password_hash FROM users WHERE id = ?1",
            [user_id],
            |row| row.get(0),
        )
        .map_err(|_| "Utilisateur introuvable.".to_string())
    })
}

#[tauri::command]
pub fn local_auth_status(
    state: State<'_, DbState>,
    user_id: String,
) -> Result<LocalAuthStatus, String> {
    let hash = load_hash(&state, &user_id)?;
    Ok(LocalAuthStatus {
        user_id,
        has_password: hash.as_ref().is_some_and(|h| !h.is_empty()),
    })
}

#[tauri::command]
pub fn local_auth_set_password(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
    password: String,
    current_password: Option<String>,
) -> Result<LocalAuthStatus, String> {
    let trimmed = password.trim();
    if trimmed.len() < 6 {
        return Err("Mot de passe / PIN trop court (min. 6).".into());
    }
    if trimmed.len() > 128 {
        return Err("Mot de passe trop long.".into());
    }

    let existing = load_hash(&state, &user_id)?;
    if let Some(ref hash) = existing {
        if !hash.is_empty() {
            crate::session_guard::require_session_unlocked(&app, &state, &user_id)?;
            let cur = current_password.unwrap_or_default();
            if !verify_secret(&cur, hash)? {
                return Err("Mot de passe actuel incorrect.".into());
            }
        }
    }

    let hashed = hash_secret(trimmed)?;
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE users SET password_hash = ?2 WHERE id = ?1",
            rusqlite::params![user_id, hashed],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;

    let _ = crate::session_guard::mark_unlocked(&app, &user_id);
    emit_db_changed(&app, "users", "password", Some(&user_id));
    local_auth_status(state, user_id)
}

#[tauri::command]
pub fn local_auth_clear_password(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
    current_password: String,
) -> Result<LocalAuthStatus, String> {
    crate::session_guard::require_session_unlocked(&app, &state, &user_id)?;
    let existing = load_hash(&state, &user_id)?;
    let hash = existing
        .filter(|h| !h.is_empty())
        .ok_or_else(|| "Aucun mot de passe défini.".to_string())?;
    if !verify_secret(&current_password, &hash)? {
        return Err("Mot de passe actuel incorrect.".into());
    }
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE users SET password_hash = NULL WHERE id = ?1",
            [&user_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "users", "password", Some(&user_id));
    local_auth_status(state, user_id)
}

#[tauri::command]
pub fn local_auth_verify(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
    password: String,
) -> Result<bool, String> {
    let existing = load_hash(&state, &user_id)?;
    let ok = match existing {
        Some(hash) if !hash.is_empty() => verify_secret(&password, &hash)?,
        _ => true,
    };
    if ok {
        crate::session_guard::mark_unlocked(&app, &user_id)?;
    }
    Ok(ok)
}
