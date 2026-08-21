//! Commandes Tauri CRUD + helpers internes pour knowledge / genre cache.

use crate::db::events::emit_db_changed;
use crate::db::migrate::{
    import_disk_legacy, load_knowledge_from_conn, save_knowledge_to_conn,
};
use crate::db::{meta_get, meta_set, with_conn, with_conn_mut, DbState};
use crate::knowledge::Knowledge;
use crate::profile_store;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

// ─── Types front ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbUser {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    pub created_at: i64,
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSpotifyProfile {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub client_id: String,
    pub created_at: i64,
    pub last_used_at: i64,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub last_synced_at: Option<i64>,
    pub liked_count: i64,
    pub artist_count: i64,
    pub group_count: i64,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbGenrePeek {
    pub genre: String,
    pub folder: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbDetectionEvent {
    pub at: i64,
    pub percent: f64,
    pub delta: f64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbLibraryScan {
    pub id: String,
    pub user_id: String,
    pub root: String,
    pub saved_at: i64,
    pub selected_folder: Option<String>,
    pub mode: String,
    pub file_count: i64,
    pub unread_count: i64,
    pub unknown_count: i64,
    pub looked_up_count: i64,
    pub sorted_percent: f64,
    pub group_count: i64,
    pub folder_count: i64,
    pub duration_secs: f64,
    pub top_genres: Vec<DbGenrePeek>,
    pub detection_log: Vec<DbDetectionEvent>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTrack {
    pub path: String,
    pub file_name: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<String>,
    pub genre: String,
    pub folder: String,
    pub duration_secs: Option<f64>,
    pub bpm: Option<f64>,
    pub musical_key: Option<String>,
    pub bitrate_kbps: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbGenreGroup {
    pub genre: String,
    pub folder: String,
    pub tracks: Vec<DbTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbScanResult {
    pub root: String,
    pub file_count: i64,
    pub unread_count: i64,
    pub unknown_count: i64,
    pub looked_up_count: i64,
    pub sorted_percent: f64,
    pub groups: Vec<DbGenreGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSaveScanPayload {
    pub scan: DbLibraryScan,
    pub result: DbScanResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbImportGenrePeek {
    pub genre: String,
    pub folder: String,
    pub artist_count: i64,
    pub likes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSpotifyImport {
    pub id: String,
    pub user_id: String,
    pub profile_id: String,
    pub profile_name: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub saved_at: i64,
    pub synced_at: Option<String>,
    pub liked_count: i64,
    pub artist_count: i64,
    pub classified_artists: i64,
    pub group_count: i64,
    pub top_genres: Vec<DbImportGenrePeek>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyFrontendPayload {
    pub users: Vec<DbUser>,
    pub session_user_id: Option<String>,
    pub prefs_by_user: HashMap<String, Value>,
    pub profiles_by_user: HashMap<String, LegacyProfiles>,
    pub libraries_by_user: HashMap<String, LegacyLibraries>,
    pub imports_by_user: HashMap<String, LegacyImports>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyProfiles {
    pub active_id: Option<String>,
    pub profiles: Vec<DbSpotifyProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyLibraries {
    pub active_id: Option<String>,
    pub scans: Vec<DbSaveScanPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImports {
    pub active_id: Option<String>,
    pub imports: Vec<DbSpotifyImport>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateResult {
    pub migrated: bool,
    pub disk_imported: bool,
}

// ─── Path / reveal ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_get_path(state: State<'_, DbState>) -> Result<String, String> {
    Ok(state.path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn db_reveal_path(app: AppHandle, state: State<'_, DbState>) -> Result<String, String> {
    if let Some(uid) = crate::session_guard::read_session_user(&state)? {
        crate::session_guard::require_unlocked(&app, &uid)?;
    } else {
        return Err("Aucune session active.".into());
    }
    let path = state.path.clone();
    let folder = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| path.clone());
    app.opener()
        .open_path(folder.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// ─── Users / session ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_users(state: State<'_, DbState>) -> Result<Vec<DbUser>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, color, avatar_url, created_at, last_used_at FROM users
                 ORDER BY last_used_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DbUser {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    avatar_url: row.get(3)?,
                    created_at: row.get(4)?,
                    last_used_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn db_upsert_user(
    app: AppHandle,
    state: State<'_, DbState>,
    user: DbUser,
) -> Result<DbUser, String> {
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT INTO users (id, name, color, avatar_url, created_at, last_used_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               color = excluded.color,
               avatar_url = excluded.avatar_url,
               last_used_at = excluded.last_used_at",
            params![
                user.id,
                user.name,
                user.color,
                user.avatar_url,
                user.created_at,
                user.last_used_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "users", "upsert", Some(&user.id));
    Ok(user)
}

#[tauri::command]
pub fn db_delete_user(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
) -> Result<(), String> {
    with_conn_mut(&state, |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM prefs WHERE user_id = ?1", [&user_id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM tracks WHERE scan_id IN (SELECT id FROM library_scans WHERE user_id = ?1)", [&user_id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM library_scans WHERE user_id = ?1", [&user_id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM spotify_imports WHERE user_id = ?1", [&user_id])
            .map_err(|e| e.to_string())?;
        // Keep spotify_profiles / knowledge (tied to Spotify account) but clear user link
        tx.execute(
            "UPDATE spotify_profiles SET user_id = '' WHERE user_id = ?1",
            [&user_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM users WHERE id = ?1", [&user_id])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE session SET user_id = NULL WHERE user_id = ?1",
            [&user_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "users", "delete", Some(&user_id));
    Ok(())
}

#[tauri::command]
pub fn db_get_session(state: State<'_, DbState>) -> Result<Option<String>, String> {
    with_conn(&state, |conn| {
        conn.query_row("SELECT user_id FROM session WHERE id = 1", [], |row| {
            row.get::<_, Option<String>>(0)
        })
        .optional()
        .map(|opt| opt.flatten())
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn db_set_session(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: Option<String>,
) -> Result<(), String> {
    match &user_id {
        Some(uid) => crate::session_guard::assert_can_enter_session(&app, &state, uid)?,
        None => crate::session_guard::clear_unlock(&app),
    }
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT INTO session (id, user_id) VALUES (1, ?1)
             ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id",
            params![user_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "session", "set", user_id.as_deref());
    Ok(())
}

// ─── Prefs ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_get_prefs(
    state: State<'_, DbState>,
    user_id: String,
) -> Result<HashMap<String, Value>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT key, value FROM prefs WHERE user_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&user_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut map = HashMap::new();
        for row in rows {
            let (k, v) = row.map_err(|e| e.to_string())?;
            let parsed: Value = serde_json::from_str(&v).unwrap_or(Value::String(v));
            map.insert(k, parsed);
        }
        Ok(map)
    })
}

#[tauri::command]
pub fn db_set_prefs(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
    prefs: HashMap<String, Value>,
) -> Result<(), String> {
    with_conn_mut(&state, |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM prefs WHERE user_id = ?1", [&user_id])
            .map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO prefs (user_id, key, value) VALUES (?1, ?2, ?3)",
                )
                .map_err(|e| e.to_string())?;
            for (key, value) in &prefs {
                let raw = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
                stmt.execute(params![user_id, key, raw])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "prefs", "set", Some(&user_id));
    Ok(())
}

// ─── Spotify profiles ────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_spotify_profiles(
    state: State<'_, DbState>,
    user_id: String,
) -> Result<Vec<DbSpotifyProfile>, String> {
    with_conn(&state, |conn| list_profiles_conn(conn, &user_id))
}

fn list_profiles_conn(conn: &Connection, user_id: &str) -> Result<Vec<DbSpotifyProfile>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, name, client_id, created_at, last_used_at,
                    display_name, avatar_url, last_synced_at, liked_count,
                    artist_count, group_count, is_active
             FROM spotify_profiles
             WHERE user_id = ?1 OR user_id = ''
             ORDER BY last_used_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([user_id], |row| {
            Ok(DbSpotifyProfile {
                id: row.get(0)?,
                user_id: row.get(1)?,
                name: row.get(2)?,
                client_id: row.get(3)?,
                created_at: row.get(4)?,
                last_used_at: row.get(5)?,
                display_name: row.get(6)?,
                avatar_url: row.get(7)?,
                last_synced_at: row.get(8)?,
                liked_count: row.get(9)?,
                artist_count: row.get(10)?,
                group_count: row.get(11)?,
                is_active: row.get::<_, i64>(12)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_upsert_spotify_profile(
    app: AppHandle,
    state: State<'_, DbState>,
    profile: DbSpotifyProfile,
) -> Result<DbSpotifyProfile, String> {
    with_conn_mut(&state, |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        if profile.is_active {
            tx.execute(
                "UPDATE spotify_profiles SET is_active = 0 WHERE user_id = ?1 OR user_id = ''",
                [&profile.user_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT INTO spotify_profiles (
                id, user_id, name, client_id, created_at, last_used_at,
                display_name, avatar_url, last_synced_at, liked_count,
                artist_count, group_count, is_active
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
             ON CONFLICT(id) DO UPDATE SET
               user_id = excluded.user_id,
               name = excluded.name,
               client_id = excluded.client_id,
               last_used_at = excluded.last_used_at,
               display_name = excluded.display_name,
               avatar_url = excluded.avatar_url,
               last_synced_at = excluded.last_synced_at,
               liked_count = excluded.liked_count,
               artist_count = excluded.artist_count,
               group_count = excluded.group_count,
               is_active = excluded.is_active",
            params![
                profile.id,
                profile.user_id,
                profile.name,
                profile.client_id,
                profile.created_at,
                profile.last_used_at,
                profile.display_name,
                profile.avatar_url,
                profile.last_synced_at,
                profile.liked_count,
                profile.artist_count,
                profile.group_count,
                if profile.is_active { 1 } else { 0 },
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;
    if profile.is_active {
        profile_store::set_active_profile_id(Some(profile.id.clone()));
        let _ = profile_store::persist_active(&app);
    }
    emit_db_changed(&app, "spotify_profiles", "upsert", Some(&profile.id));
    Ok(profile)
}

#[tauri::command]
pub fn db_delete_spotify_profile(
    app: AppHandle,
    state: State<'_, DbState>,
    profile_id: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM spotify_profiles WHERE id = ?1", [&profile_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM knowledge_meta WHERE profile_id = ?1", [&profile_id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM knowledge_artists WHERE profile_id = ?1",
            [&profile_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM spotify_imports WHERE profile_id = ?1",
            [&profile_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    if profile_store::active_profile_id().as_deref() == Some(profile_id.as_str()) {
        profile_store::set_active_profile_id(None);
        let _ = profile_store::persist_active(&app);
    }
    emit_db_changed(&app, "spotify_profiles", "delete", Some(&profile_id));
    Ok(())
}

#[tauri::command]
pub fn db_set_active_spotify_profile(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
    profile_id: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE spotify_profiles SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END
             WHERE user_id = ?2 OR user_id = '' OR id = ?1",
            params![profile_id, user_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    profile_store::set_active_profile_id(Some(profile_id.clone()));
    let _ = profile_store::persist_active(&app);
    emit_db_changed(&app, "spotify_profiles", "activate", Some(&profile_id));
    Ok(())
}

// ─── Library scans ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_scans(
    state: State<'_, DbState>,
    user_id: String,
) -> Result<Vec<DbLibraryScan>, String> {
    with_conn(&state, |conn| list_scans_conn(conn, &user_id))
}

fn list_scans_conn(conn: &Connection, user_id: &str) -> Result<Vec<DbLibraryScan>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, root, saved_at, selected_folder, mode,
                    file_count, unread_count, unknown_count, looked_up_count,
                    sorted_percent, group_count, folder_count, duration_secs,
                    top_genres, detection_log, is_active
             FROM library_scans WHERE user_id = ?1
             ORDER BY saved_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([user_id], map_scan_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn map_scan_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DbLibraryScan> {
    let top_raw: String = row.get(14)?;
    let log_raw: String = row.get(15)?;
    Ok(DbLibraryScan {
        id: row.get(0)?,
        user_id: row.get(1)?,
        root: row.get(2)?,
        saved_at: row.get(3)?,
        selected_folder: row.get(4)?,
        mode: row.get(5)?,
        file_count: row.get(6)?,
        unread_count: row.get(7)?,
        unknown_count: row.get(8)?,
        looked_up_count: row.get(9)?,
        sorted_percent: row.get(10)?,
        group_count: row.get(11)?,
        folder_count: row.get(12)?,
        duration_secs: row.get(13)?,
        top_genres: serde_json::from_str(&top_raw).unwrap_or_default(),
        detection_log: serde_json::from_str(&log_raw).unwrap_or_default(),
        is_active: row.get::<_, i64>(16)? != 0,
    })
}

#[tauri::command]
pub fn db_get_scan(
    state: State<'_, DbState>,
    scan_id: String,
) -> Result<Option<DbScanResult>, String> {
    with_conn(&state, |conn| {
        let meta: Option<(String, i64, i64, i64, i64, f64)> = conn
            .query_row(
                "SELECT root, file_count, unread_count, unknown_count, looked_up_count, sorted_percent
                 FROM library_scans WHERE id = ?1",
                [&scan_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let Some((root, file_count, unread_count, unknown_count, looked_up_count, sorted_percent)) =
            meta
        else {
            return Ok(None);
        };

        let mut stmt = conn
            .prepare(
                "SELECT path, file_name, title, artist, album, year, genre, folder,
                        duration_secs, bpm, musical_key, bitrate_kbps
                 FROM tracks WHERE scan_id = ?1 ORDER BY genre, file_name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&scan_id], |row| {
                Ok(DbTrack {
                    path: row.get(0)?,
                    file_name: row.get(1)?,
                    title: row.get(2)?,
                    artist: row.get(3)?,
                    album: row.get(4)?,
                    year: row.get(5)?,
                    genre: row.get(6)?,
                    folder: row.get(7)?,
                    duration_secs: row.get(8)?,
                    bpm: row.get(9)?,
                    musical_key: row.get(10)?,
                    bitrate_kbps: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut by_folder: HashMap<String, DbGenreGroup> = HashMap::new();
        for row in rows {
            let track = row.map_err(|e| e.to_string())?;
            let key = track.folder.to_ascii_lowercase();
            let entry = by_folder.entry(key).or_insert_with(|| DbGenreGroup {
                genre: track.genre.clone(),
                folder: track.folder.clone(),
                tracks: Vec::new(),
            });
            entry.tracks.push(track);
        }

        let mut groups: Vec<DbGenreGroup> = by_folder.into_values().collect();
        groups.sort_by(|a, b| b.tracks.len().cmp(&a.tracks.len()).then(a.genre.cmp(&b.genre)));

        Ok(Some(DbScanResult {
            root,
            file_count,
            unread_count,
            unknown_count,
            looked_up_count,
            sorted_percent,
            groups,
        }))
    })
}

#[tauri::command]
pub fn db_save_scan(
    app: AppHandle,
    state: State<'_, DbState>,
    payload: DbSaveScanPayload,
) -> Result<DbLibraryScan, String> {
    let scan = payload.scan.clone();
    with_conn_mut(&state, |conn| {
        save_scan_conn(conn, &payload)?;
        Ok(())
    })?;
    emit_db_changed(&app, "library_scans", "save", Some(&scan.id));
    Ok(scan)
}

fn save_scan_conn(conn: &Connection, payload: &DbSaveScanPayload) -> Result<(), String> {
    let scan = &payload.scan;
    let top = serde_json::to_string(&scan.top_genres).unwrap_or_else(|_| "[]".into());
    let log = serde_json::to_string(&scan.detection_log).unwrap_or_else(|_| "[]".into());

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if scan.is_active {
        tx.execute(
            "UPDATE library_scans SET is_active = 0 WHERE user_id = ?1",
            [&scan.user_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO library_scans (
            id, user_id, root, saved_at, selected_folder, mode,
            file_count, unread_count, unknown_count, looked_up_count,
            sorted_percent, group_count, folder_count, duration_secs,
            top_genres, detection_log, is_active
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
         ON CONFLICT(id) DO UPDATE SET
           root = excluded.root,
           saved_at = excluded.saved_at,
           selected_folder = excluded.selected_folder,
           mode = excluded.mode,
           file_count = excluded.file_count,
           unread_count = excluded.unread_count,
           unknown_count = excluded.unknown_count,
           looked_up_count = excluded.looked_up_count,
           sorted_percent = excluded.sorted_percent,
           group_count = excluded.group_count,
           folder_count = excluded.folder_count,
           duration_secs = excluded.duration_secs,
           top_genres = excluded.top_genres,
           detection_log = excluded.detection_log,
           is_active = excluded.is_active",
        params![
            scan.id,
            scan.user_id,
            scan.root,
            scan.saved_at,
            scan.selected_folder,
            scan.mode,
            scan.file_count,
            scan.unread_count,
            scan.unknown_count,
            scan.looked_up_count,
            scan.sorted_percent,
            scan.group_count,
            scan.folder_count,
            scan.duration_secs,
            top,
            log,
            if scan.is_active { 1 } else { 0 },
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM tracks WHERE scan_id = ?1", [&scan.id])
        .map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO tracks (
                    scan_id, path, file_name, title, artist, album, year,
                    genre, folder, duration_secs, bpm, musical_key, bitrate_kbps
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            )
            .map_err(|e| e.to_string())?;
        for group in &payload.result.groups {
            for track in &group.tracks {
                stmt.execute(params![
                    scan.id,
                    track.path,
                    track.file_name,
                    track.title,
                    track.artist,
                    track.album,
                    track.year,
                    track.genre,
                    track.folder,
                    track.duration_secs,
                    track.bpm,
                    track.musical_key,
                    track.bitrate_kbps,
                ])
                .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_set_active_scan(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
    scan_id: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE library_scans SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END
             WHERE user_id = ?2",
            params![scan_id, user_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "library_scans", "activate", Some(&scan_id));
    Ok(())
}

#[tauri::command]
pub fn db_delete_scan(
    app: AppHandle,
    state: State<'_, DbState>,
    scan_id: String,
) -> Result<(), String> {
    with_conn_mut(&state, |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM tracks WHERE scan_id = ?1", [&scan_id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM library_scans WHERE id = ?1", [&scan_id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "library_scans", "delete", Some(&scan_id));
    Ok(())
}

// ─── Spotify imports ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_list_spotify_imports(
    state: State<'_, DbState>,
    user_id: String,
) -> Result<Vec<DbSpotifyImport>, String> {
    with_conn(&state, |conn| list_imports_conn(conn, &user_id))
}

fn list_imports_conn(conn: &Connection, user_id: &str) -> Result<Vec<DbSpotifyImport>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, profile_id, profile_name, display_name, avatar_url,
                    saved_at, synced_at, liked_count, artist_count, classified_artists,
                    group_count, top_genres, is_active
             FROM spotify_imports WHERE user_id = ?1
             ORDER BY saved_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([user_id], |row| {
            let top_raw: String = row.get(12)?;
            Ok(DbSpotifyImport {
                id: row.get(0)?,
                user_id: row.get(1)?,
                profile_id: row.get(2)?,
                profile_name: row.get(3)?,
                display_name: row.get(4)?,
                avatar_url: row.get(5)?,
                saved_at: row.get(6)?,
                synced_at: row.get(7)?,
                liked_count: row.get(8)?,
                artist_count: row.get(9)?,
                classified_artists: row.get(10)?,
                group_count: row.get(11)?,
                top_genres: serde_json::from_str(&top_raw).unwrap_or_default(),
                is_active: row.get::<_, i64>(13)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_upsert_spotify_import(
    app: AppHandle,
    state: State<'_, DbState>,
    import: DbSpotifyImport,
) -> Result<DbSpotifyImport, String> {
    with_conn_mut(&state, |conn| {
        let top = serde_json::to_string(&import.top_genres).unwrap_or_else(|_| "[]".into());
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        if import.is_active {
            tx.execute(
                "UPDATE spotify_imports SET is_active = 0 WHERE user_id = ?1",
                [&import.user_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT INTO spotify_imports (
                id, user_id, profile_id, profile_name, display_name, avatar_url,
                saved_at, synced_at, liked_count, artist_count, classified_artists,
                group_count, top_genres, is_active
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
             ON CONFLICT(id) DO UPDATE SET
               profile_name = excluded.profile_name,
               display_name = excluded.display_name,
               avatar_url = excluded.avatar_url,
               saved_at = excluded.saved_at,
               synced_at = excluded.synced_at,
               liked_count = excluded.liked_count,
               artist_count = excluded.artist_count,
               classified_artists = excluded.classified_artists,
               group_count = excluded.group_count,
               top_genres = excluded.top_genres,
               is_active = excluded.is_active",
            params![
                import.id,
                import.user_id,
                import.profile_id,
                import.profile_name,
                import.display_name,
                import.avatar_url,
                import.saved_at,
                import.synced_at,
                import.liked_count,
                import.artist_count,
                import.classified_artists,
                import.group_count,
                top,
                if import.is_active { 1 } else { 0 },
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "spotify_imports", "upsert", Some(&import.id));
    Ok(import)
}

#[tauri::command]
pub fn db_set_active_spotify_import(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
    import_id: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE spotify_imports SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END
             WHERE user_id = ?2",
            params![import_id, user_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "spotify_imports", "activate", Some(&import_id));
    Ok(())
}

// ─── Migration from frontend localStorage ────────────────────────────────────

#[tauri::command]
pub fn db_migrate_legacy(
    app: AppHandle,
    state: State<'_, DbState>,
    payload: LegacyFrontendPayload,
) -> Result<MigrateResult, String> {
    let mut migrated = false;
    let mut disk_imported = false;

    with_conn_mut(&state, |conn| {
        disk_imported = import_disk_legacy(&app, conn)?;

        if meta_get(conn, "frontend_migrated_v1")?.as_deref() == Some("1") {
            return Ok(());
        }

        for user in &payload.users {
            conn.execute(
                "INSERT INTO users (id, name, color, avatar_url, created_at, last_used_at)
                 VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(id) DO NOTHING",
                params![
                    user.id,
                    user.name,
                    user.color,
                    user.avatar_url,
                    user.created_at,
                    user.last_used_at
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        if let Some(uid) = &payload.session_user_id {
            conn.execute(
                "INSERT INTO session (id, user_id) VALUES (1, ?1)
                 ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id",
                [uid],
            )
            .map_err(|e| e.to_string())?;
        }

        for (user_id, prefs) in &payload.prefs_by_user {
            if let Some(obj) = prefs.as_object() {
                for (key, value) in obj {
                    let raw = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
                    conn.execute(
                        "INSERT INTO prefs (user_id, key, value) VALUES (?1,?2,?3)
                         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
                        params![user_id, key, raw],
                    )
                    .map_err(|e| e.to_string())?;
                }
            } else {
                // Whole prefs blob as single key
                let raw = serde_json::to_string(prefs).unwrap_or_else(|_| "{}".into());
                conn.execute(
                    "INSERT INTO prefs (user_id, key, value) VALUES (?1, 'bundle', ?2)
                     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
                    params![user_id, raw],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        for (user_id, pack) in &payload.profiles_by_user {
            for mut profile in pack.profiles.clone() {
                profile.user_id = user_id.clone();
                profile.is_active = pack.active_id.as_deref() == Some(&profile.id);
                conn.execute(
                    "INSERT INTO spotify_profiles (
                        id, user_id, name, client_id, created_at, last_used_at,
                        display_name, avatar_url, last_synced_at, liked_count,
                        artist_count, group_count, is_active
                     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
                     ON CONFLICT(id) DO UPDATE SET
                       user_id = excluded.user_id,
                       name = excluded.name,
                       client_id = excluded.client_id,
                       last_used_at = excluded.last_used_at,
                       display_name = excluded.display_name,
                       avatar_url = excluded.avatar_url,
                       last_synced_at = excluded.last_synced_at,
                       liked_count = excluded.liked_count,
                       artist_count = excluded.artist_count,
                       group_count = excluded.group_count,
                       is_active = excluded.is_active",
                    params![
                        profile.id,
                        profile.user_id,
                        profile.name,
                        profile.client_id,
                        profile.created_at,
                        profile.last_used_at,
                        profile.display_name,
                        profile.avatar_url,
                        profile.last_synced_at,
                        profile.liked_count,
                        profile.artist_count,
                        profile.group_count,
                        if profile.is_active { 1 } else { 0 },
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        for (_user_id, pack) in &payload.libraries_by_user {
            for item in &pack.scans {
                let mut scan = item.scan.clone();
                scan.is_active = pack.active_id.as_deref() == Some(&scan.id);
                save_scan_conn(
                    conn,
                    &DbSaveScanPayload {
                        scan,
                        result: item.result.clone(),
                    },
                )?;
            }
        }

        for (user_id, pack) in &payload.imports_by_user {
            for mut import in pack.imports.clone() {
                import.user_id = user_id.clone();
                import.is_active = pack.active_id.as_deref() == Some(&import.id);
                let top = serde_json::to_string(&import.top_genres).unwrap_or_else(|_| "[]".into());
                conn.execute(
                    "INSERT INTO spotify_imports (
                        id, user_id, profile_id, profile_name, display_name, avatar_url,
                        saved_at, synced_at, liked_count, artist_count, classified_artists,
                        group_count, top_genres, is_active
                     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
                     ON CONFLICT(id) DO NOTHING",
                    params![
                        import.id,
                        import.user_id,
                        import.profile_id,
                        import.profile_name,
                        import.display_name,
                        import.avatar_url,
                        import.saved_at,
                        import.synced_at,
                        import.liked_count,
                        import.artist_count,
                        import.classified_artists,
                        import.group_count,
                        top,
                        if import.is_active { 1 } else { 0 },
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        meta_set(conn, "frontend_migrated_v1", "1")?;
        migrated = true;
        Ok(())
    })?;

    emit_db_changed(&app, "meta", "migrate", None);
    Ok(MigrateResult {
        migrated,
        disk_imported,
    })
}

// ─── Internal helpers used by knowledge / genre_lookup / spotify ─────────────

pub fn knowledge_save(app: &AppHandle, profile_id: &str, knowledge: &Knowledge) -> Result<(), String> {
    let state = app.state::<DbState>();
    with_conn(&state, |conn| save_knowledge_to_conn(conn, profile_id, knowledge))?;
    emit_db_changed(app, "knowledge", "save", Some(profile_id));
    Ok(())
}

pub fn knowledge_load(app: &AppHandle, profile_id: &str) -> Result<Knowledge, String> {
    let state = app.state::<DbState>();
    with_conn(&state, |conn| load_knowledge_from_conn(conn, profile_id))
}

pub fn genre_cache_load(app: &AppHandle) -> HashMap<String, String> {
    let Some(state) = app.try_state::<DbState>() else {
        return HashMap::new();
    };
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT artist_key, genre FROM genre_cache")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut map = HashMap::new();
        for row in rows {
            let (k, v) = row.map_err(|e| e.to_string())?;
            map.insert(k, v);
        }
        Ok(map)
    })
    .unwrap_or_default()
}

pub fn genre_cache_save(app: &AppHandle, cache: &HashMap<String, String>) {
    let Some(state) = app.try_state::<DbState>() else {
        return;
    };
    let _ = with_conn_mut(&state, |conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM genre_cache", [])
            .map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare("INSERT INTO genre_cache (artist_key, genre) VALUES (?1, ?2)")
                .map_err(|e| e.to_string())?;
            for (k, v) in cache {
                stmt.execute(params![k, v]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    });
    emit_db_changed(app, "genre_cache", "save", None);
}

pub fn auth_load(app: &AppHandle, profile_id: &str) -> Option<(String, String, String, i64, Option<String>, Option<String>)> {
    let state = app.try_state::<DbState>()?;
    with_conn(&state, |conn| {
        conn.query_row(
            "SELECT client_id, access_token, refresh_token, expires_at, display_name, avatar_url
             FROM spotify_profiles WHERE id = ?1",
            [profile_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(3)?.unwrap_or(0),
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())
    })
    .ok()
    .and_then(|(client_id, access, refresh, exp, name, avatar)| {
        let access = match crate::secret_box::open(&access) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[bassorder] decrypt access_token ({profile_id}): {e}");
                return None;
            }
        };
        let refresh = match crate::secret_box::open(&refresh) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[bassorder] decrypt refresh_token ({profile_id}): {e}");
                return None;
            }
        };
        if access.is_empty() && refresh.is_empty() {
            return None;
        }
        Some((client_id, access, refresh, exp, name, avatar))
    })
}

/// Tokens présents en base (chiffrés ou non), sans tenter de déchiffrer.
pub fn auth_has_stored_tokens(app: &AppHandle, profile_id: &str) -> bool {
    let Some(state) = app.try_state::<DbState>() else {
        return false;
    };
    with_conn(&state, |conn| {
        conn.query_row(
            "SELECT CASE WHEN
               (refresh_token IS NOT NULL AND length(refresh_token) > 8)
               OR (access_token IS NOT NULL AND length(access_token) > 8)
             THEN 1 ELSE 0 END
             FROM spotify_profiles WHERE id = ?1",
            [profile_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|v| v > 0)
        .map_err(|e| e.to_string())
    })
    .unwrap_or(false)
}

pub fn profile_client_id(app: &AppHandle, profile_id: &str) -> Option<String> {
    let state = app.try_state::<DbState>()?;
    with_conn(&state, |conn| {
        conn.query_row(
            "SELECT client_id FROM spotify_profiles WHERE id = ?1",
            [profile_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())
    })
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
}

/// Profil le plus pertinent si aucun actif Rust (évite le trou « legacy »).
pub fn auth_fallback_profile_id(app: &AppHandle) -> Option<String> {
    let state = app.try_state::<DbState>()?;
    with_conn(&state, |conn| {
        conn.query_row(
            "SELECT id FROM spotify_profiles
             WHERE id != 'legacy'
               AND (
                 (refresh_token IS NOT NULL AND length(refresh_token) > 0)
                 OR (access_token IS NOT NULL AND length(access_token) > 0)
                 OR liked_count > 0
               )
             ORDER BY
               CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
               CASE WHEN refresh_token IS NOT NULL AND length(refresh_token) > 0 THEN 0 ELSE 1 END,
               liked_count DESC,
               last_used_at DESC
             LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())
    })
    .ok()
}

pub fn auth_save(
    app: &AppHandle,
    profile_id: &str,
    client_id: &str,
    access_token: &str,
    refresh_token: &str,
    expires_at: i64,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<(), String> {
    let access_token = crate::secret_box::seal(access_token)?;
    let refresh_token = crate::secret_box::seal(refresh_token)?;
    let state = app.state::<DbState>();
    with_conn(&state, |conn| {
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM spotify_profiles WHERE id = ?1",
                [profile_id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if exists {
            conn.execute(
                "UPDATE spotify_profiles SET
                    client_id = ?2,
                    access_token = ?3,
                    refresh_token = ?4,
                    expires_at = ?5,
                    display_name = COALESCE(?6, display_name),
                    avatar_url = COALESCE(?7, avatar_url)
                 WHERE id = ?1",
                params![
                    profile_id,
                    client_id,
                    access_token,
                    refresh_token,
                    expires_at,
                    display_name,
                    avatar_url,
                ],
            )
            .map_err(|e| e.to_string())?;
        } else {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            conn.execute(
                "INSERT INTO spotify_profiles (
                    id, user_id, name, client_id, created_at, last_used_at,
                    display_name, avatar_url, access_token, refresh_token, expires_at, is_active
                 ) VALUES (?1,'','Spotify',?2,?3,?3,?4,?5,?6,?7,?8,1)",
                params![
                    profile_id,
                    client_id,
                    now,
                    display_name,
                    avatar_url,
                    access_token,
                    refresh_token,
                    expires_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })?;
    emit_db_changed(app, "spotify_profiles", "auth", Some(profile_id));
    Ok(())
}
