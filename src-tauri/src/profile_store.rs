//! Profil Spotify actif : oriente knowledge + auth (mémoire + meta SQLite).

use crate::db::{meta_get, meta_set, with_conn, DbState};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static ACTIVE: Mutex<Option<String>> = Mutex::new(None);

fn sanitize_id(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(80)
        .collect();
    if cleaned.is_empty() {
        "default".into()
    } else {
        cleaned
    }
}

pub fn active_profile_id() -> Option<String> {
    ACTIVE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub fn set_active_profile_id(id: Option<String>) {
    let mut guard = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    *guard = id.map(|s| sanitize_id(&s));
}

fn app_data(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

pub fn persist_active(app: &AppHandle) -> Result<(), String> {
    let id = active_profile_id().unwrap_or_default();
    if let Some(state) = app.try_state::<DbState>() {
        with_conn(&state, |conn| meta_set(conn, "active_spotify_profile", &id))?;
    }
    Ok(())
}

pub fn restore_active(app: &AppHandle) {
    if let Some(state) = app.try_state::<DbState>() {
        if let Ok(Some(id)) = with_conn(&state, |conn| meta_get(conn, "active_spotify_profile")) {
            let trimmed = id.trim();
            if !trimmed.is_empty() {
                set_active_profile_id(Some(trimmed.to_string()));
                return;
            }
        }
    }
    // Legacy fichier texte (une fois, avant absorption)
    let Some(path) = active_marker_path(app) else {
        return;
    };
    if let Ok(raw) = std::fs::read_to_string(path) {
        let id = raw.trim();
        if !id.is_empty() {
            set_active_profile_id(Some(id.to_string()));
            let _ = persist_active(app);
        }
    }
}

pub fn active_marker_path(app: &AppHandle) -> Option<PathBuf> {
    app_data(app).map(|dir| dir.join("active-spotify-profile.txt"))
}

/// Première activation d’un profil : récupère les anciens fichiers globaux s’ils existent.
pub fn migrate_legacy_into(app: &AppHandle, profile_id: &str) {
    let id = sanitize_id(profile_id);
    let Some(root) = app_data(app) else {
        return;
    };

    migrate_one(
        &root.join("knowledge.json"),
        &root.join("knowledge").join(format!("{id}.json")),
    );
    migrate_one(
        &root.join("spotify-auth.json"),
        &root.join("spotify-auth").join(format!("{id}.json")),
    );
}

fn migrate_one(legacy: &Path, scoped: &Path) {
    if scoped.exists() || !legacy.exists() {
        return;
    }
    if let Some(parent) = scoped.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if std::fs::rename(legacy, scoped).is_err() {
        let _ = std::fs::copy(legacy, scoped);
    }
}
