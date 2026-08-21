//! Persistance SQLite locale unique (`bassorder.db`).

mod commands;
mod events;
mod favorites;
mod migrate;
mod schema;

pub use commands::*;
pub use events::emit_db_changed;
pub use favorites::*;
pub use migrate::{heal_spotify_profiles, import_disk_legacy};

use rusqlite::{Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct DbState {
    pub conn: Mutex<Connection>,
    pub path: PathBuf,
}

pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("bassorder.db"))
}

pub fn open(app: &AppHandle) -> Result<DbState, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("sqlite open: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;",
    )
    .map_err(|e| format!("sqlite pragma: {e}"))?;
    schema::migrate(&conn)?;
    Ok(DbState {
        conn: Mutex::new(conn),
        path,
    })
}

pub fn with_conn<T>(
    state: &State<'_, DbState>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state
        .conn
        .lock()
        .map_err(|_| "Base de données verrouillée.".to_string())?;
    f(&guard)
}

pub fn with_conn_mut<T>(
    state: &State<'_, DbState>,
    f: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .conn
        .lock()
        .map_err(|_| "Base de données verrouillée.".to_string())?;
    f(&mut guard)
}

pub fn meta_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM meta WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Chiffre les tokens Spotify / cloud encore stockés en clair.
pub fn migrate_seal_tokens(conn: &Connection) -> Result<(), String> {
    use crate::secret_box;

    let mut stmt = conn
        .prepare(
            "SELECT id, access_token, refresh_token FROM spotify_profiles
             WHERE (access_token IS NOT NULL AND access_token != '' AND access_token NOT LIKE 'bo1:%')
                OR (refresh_token IS NOT NULL AND refresh_token != '' AND refresh_token NOT LIKE 'bo1:%')",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, Option<String>, Option<String>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for (id, access, refresh) in rows {
        let access_s = match access {
            Some(a) if !a.is_empty() => secret_box::seal(&a)?,
            other => other.unwrap_or_default(),
        };
        let refresh_s = match refresh {
            Some(r) if !r.is_empty() => secret_box::seal(&r)?,
            other => other.unwrap_or_default(),
        };
        conn.execute(
            "UPDATE spotify_profiles SET access_token = ?2, refresh_token = ?3 WHERE id = ?1",
            rusqlite::params![id, access_s, refresh_s],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut stmt = conn
        .prepare(
            "SELECT user_id, access_token, refresh_token FROM cloud_link
             WHERE (access_token IS NOT NULL AND access_token != '' AND access_token NOT LIKE 'bo1:%')
                OR (refresh_token IS NOT NULL AND refresh_token != '' AND refresh_token NOT LIKE 'bo1:%')",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, Option<String>, Option<String>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for (uid, access, refresh) in rows {
        let access_s = match access {
            Some(a) if !a.is_empty() => Some(secret_box::seal(&a)?),
            a => a,
        };
        let refresh_s = match refresh {
            Some(r) if !r.is_empty() => Some(secret_box::seal(&r)?),
            r => r,
        };
        conn.execute(
            "UPDATE cloud_link SET access_token = ?2, refresh_token = ?3 WHERE user_id = ?1",
            rusqlite::params![uid, access_s, refresh_s],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
