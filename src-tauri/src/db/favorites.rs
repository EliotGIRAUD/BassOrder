//! Favoris unifiés + presets de réglages compte.

use crate::db::{emit_db_changed, with_conn, with_conn_mut, DbState};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbFavorite {
    pub id: String,
    pub user_id: String,
    pub kind: String,
    pub ref_key: String,
    pub title: String,
    pub meta: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbAccountPreset {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub prefs: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbCloudLink {
    pub user_id: String,
    pub account_id: Option<String>,
    pub email: Option<String>,
    pub api_base_url: Option<String>,
    pub last_sync_at: Option<i64>,
    pub linked_at: Option<i64>,
    pub has_tokens: bool,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn db_list_favorites(
    state: State<'_, DbState>,
    user_id: String,
) -> Result<Vec<DbFavorite>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, user_id, kind, ref_key, title, meta_json, created_at, updated_at
                 FROM favorites WHERE user_id = ?1 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&user_id], |row| {
                let meta_raw: String = row.get(5)?;
                Ok(DbFavorite {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    kind: row.get(2)?,
                    ref_key: row.get(3)?,
                    title: row.get(4)?,
                    meta: serde_json::from_str(&meta_raw).unwrap_or(Value::Object(Default::default())),
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn db_upsert_favorite(
    app: AppHandle,
    state: State<'_, DbState>,
    favorite: DbFavorite,
) -> Result<DbFavorite, String> {
    let mut fav = favorite;
    let now = now_ms();
    if fav.created_at <= 0 {
        fav.created_at = now;
    }
    fav.updated_at = now;
    let meta = serde_json::to_string(&fav.meta).unwrap_or_else(|_| "{}".into());
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT INTO favorites (id, user_id, kind, ref_key, title, meta_json, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(user_id, kind, ref_key) DO UPDATE SET
               title = excluded.title,
               meta_json = excluded.meta_json,
               updated_at = excluded.updated_at,
               id = excluded.id",
            params![
                fav.id,
                fav.user_id,
                fav.kind,
                fav.ref_key,
                fav.title,
                meta,
                fav.created_at,
                fav.updated_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "favorites", "upsert", Some(&fav.id));
    Ok(fav)
}

#[tauri::command]
pub fn db_delete_favorite(
    app: AppHandle,
    state: State<'_, DbState>,
    favorite_id: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM favorites WHERE id = ?1", [&favorite_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "favorites", "delete", Some(&favorite_id));
    Ok(())
}

#[tauri::command]
pub fn db_list_account_presets(
    state: State<'_, DbState>,
    user_id: String,
) -> Result<Vec<DbAccountPreset>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, user_id, name, prefs_json, created_at, updated_at
                 FROM account_presets WHERE user_id = ?1 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&user_id], |row| {
                let prefs_raw: String = row.get(3)?;
                Ok(DbAccountPreset {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    name: row.get(2)?,
                    prefs: serde_json::from_str(&prefs_raw).unwrap_or(Value::Object(Default::default())),
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn db_upsert_account_preset(
    app: AppHandle,
    state: State<'_, DbState>,
    preset: DbAccountPreset,
) -> Result<DbAccountPreset, String> {
    let mut p = preset;
    let now = now_ms();
    if p.created_at <= 0 {
        p.created_at = now;
    }
    p.updated_at = now;
    let prefs = serde_json::to_string(&p.prefs).unwrap_or_else(|_| "{}".into());
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT INTO account_presets (id, user_id, name, prefs_json, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               prefs_json = excluded.prefs_json,
               updated_at = excluded.updated_at",
            params![p.id, p.user_id, p.name, prefs, p.created_at, p.updated_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "account_presets", "upsert", Some(&p.id));
    Ok(p)
}

#[tauri::command]
pub fn db_delete_account_preset(
    app: AppHandle,
    state: State<'_, DbState>,
    preset_id: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let n = conn
            .execute("DELETE FROM account_presets WHERE id = ?1", [&preset_id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Preset introuvable.".into());
        }
        Ok(())
    })?;
    emit_db_changed(&app, "account_presets", "delete", Some(&preset_id));
    Ok(())
}

#[tauri::command]
pub fn db_get_cloud_link(
    state: State<'_, DbState>,
    user_id: String,
) -> Result<Option<DbCloudLink>, String> {
    crate::session_guard::require_session_user(&state, &user_id)?;
    with_conn(&state, |conn| {
        conn.query_row(
            "SELECT user_id, account_id, email, api_base_url, last_sync_at, linked_at,
                    access_token, refresh_token
             FROM cloud_link WHERE user_id = ?1",
            [&user_id],
            |row| {
                let access: Option<String> = row.get(6)?;
                let refresh: Option<String> = row.get(7)?;
                Ok(DbCloudLink {
                    user_id: row.get(0)?,
                    account_id: row.get(1)?,
                    email: row.get(2)?,
                    api_base_url: row.get(3)?,
                    last_sync_at: row.get(4)?,
                    linked_at: row.get(5)?,
                    has_tokens: access.as_ref().map(|s| !s.is_empty()).unwrap_or(false)
                        || refresh.as_ref().map(|s| !s.is_empty()).unwrap_or(false),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn db_set_cloud_link(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
    account_id: Option<String>,
    email: Option<String>,
    api_base_url: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: Option<i64>,
) -> Result<DbCloudLink, String> {
    crate::session_guard::require_session_unlocked(&app, &state, &user_id)?;
    if let Some(ref url) = api_base_url {
        validate_api_base_url(url)?;
    }
    let access_token = match access_token {
        Some(t) if !t.is_empty() => Some(crate::secret_box::seal(&t)?),
        Some(_) => Some(String::new()),
        None => None,
    };
    let refresh_token = match refresh_token {
        Some(t) if !t.is_empty() => Some(crate::secret_box::seal(&t)?),
        Some(_) => Some(String::new()),
        None => None,
    };
    let now = now_ms();
    with_conn_mut(&state, |conn| {
        conn.execute(
            "INSERT INTO cloud_link (
                user_id, account_id, email, access_token, refresh_token, expires_at,
                api_base_url, last_sync_at, linked_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,NULL,?8)
             ON CONFLICT(user_id) DO UPDATE SET
               account_id = excluded.account_id,
               email = excluded.email,
               access_token = COALESCE(excluded.access_token, cloud_link.access_token),
               refresh_token = COALESCE(excluded.refresh_token, cloud_link.refresh_token),
               expires_at = COALESCE(excluded.expires_at, cloud_link.expires_at),
               api_base_url = COALESCE(excluded.api_base_url, cloud_link.api_base_url),
               linked_at = COALESCE(cloud_link.linked_at, excluded.linked_at)",
            params![
                user_id,
                account_id,
                email,
                access_token,
                refresh_token,
                expires_at,
                api_base_url,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "cloud_link", "set", Some(&user_id));
    db_get_cloud_link(state, user_id)?.ok_or_else(|| "Lien cloud introuvable.".into())
}

/// Credentials cloud déchiffrés (usage interne sync knowledge).
pub struct CloudCreds {
    pub api_base_url: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: Option<i64>,
}

pub fn load_cloud_creds(
    state: &State<'_, DbState>,
    user_id: &str,
) -> Result<Option<CloudCreds>, String> {
    crate::session_guard::require_session_user(state, user_id)?;
    with_conn(state, |conn| {
        let row = conn
            .query_row(
                "SELECT api_base_url, access_token, refresh_token, expires_at
                 FROM cloud_link WHERE user_id = ?1",
                [user_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((api_base, access_sealed, refresh_sealed, expires_at)) = row else {
            return Ok(None);
        };
        let api_base_url = api_base
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "http://127.0.0.1:8787".into());
        let access_token = match access_sealed.filter(|s| !s.is_empty()) {
            Some(s) => crate::secret_box::open(&s).unwrap_or_default(),
            None => String::new(),
        };
        let refresh_token = match refresh_sealed.filter(|s| !s.is_empty()) {
            Some(s) => crate::secret_box::open(&s).unwrap_or_default(),
            None => String::new(),
        };
        if access_token.is_empty() && refresh_token.is_empty() {
            return Ok(None);
        }
        Ok(Some(CloudCreds {
            api_base_url: api_base_url.trim_end_matches('/').to_string(),
            access_token,
            refresh_token,
            expires_at,
        }))
    })
}

pub fn update_cloud_tokens(
    app: &AppHandle,
    state: &State<'_, DbState>,
    user_id: &str,
    access_token: &str,
    refresh_token: &str,
    expires_at: i64,
) -> Result<(), String> {
    crate::session_guard::require_session_unlocked(app, state, user_id)?;
    let access_sealed = crate::secret_box::seal(access_token)?;
    let refresh_sealed = crate::secret_box::seal(refresh_token)?;
    with_conn_mut(state, |conn| {
        conn.execute(
            "UPDATE cloud_link SET access_token = ?2, refresh_token = ?3, expires_at = ?4
             WHERE user_id = ?1",
            rusqlite::params![user_id, access_sealed, refresh_sealed, expires_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    Ok(())
}

pub fn touch_cloud_last_sync(
    app: &AppHandle,
    state: &State<'_, DbState>,
    user_id: &str,
) -> Result<i64, String> {
    crate::session_guard::require_session_user(state, user_id)?;
    let now = now_ms();
    with_conn_mut(state, |conn| {
        let n = conn
            .execute(
                "UPDATE cloud_link SET last_sync_at = ?2 WHERE user_id = ?1",
                rusqlite::params![user_id, now],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Lien cloud introuvable.".into());
        }
        Ok(())
    })?;
    emit_db_changed(app, "cloud_link", "sync", Some(user_id));
    Ok(now)
}

fn validate_api_base_url(url: &str) -> Result<(), String> {
    let u = url.trim();
    if u.is_empty() {
        return Ok(());
    }
    let lower = u.to_ascii_lowercase();
    if lower.contains('@') || lower.contains('\\') || lower.contains(' ') {
        return Err("URL API non autorisée.".into());
    }

    let without_slash = lower.trim_end_matches('/');
    let allowed_exact = [
        "https://api.bassorder.smegg.cloud",
        "http://127.0.0.1:8787",
        "http://localhost:8787",
        "http://127.0.0.1",
        "http://localhost",
        "https://127.0.0.1:8787",
        "https://localhost:8787",
    ];
    if allowed_exact.iter().any(|a| without_slash == *a) {
        return Ok(());
    }

    // Ports locaux arbitraires : http(s)://127.0.0.1:PORT ou localhost:PORT
    for host in ["127.0.0.1", "localhost"] {
        for scheme in ["http://", "https://"] {
            let prefix = format!("{scheme}{host}:");
            if let Some(rest) = without_slash.strip_prefix(&prefix) {
                if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
                    return Ok(());
                }
            }
        }
    }

    Err(
        "URL API non autorisée (localhost ou https://api.bassorder.smegg.cloud uniquement)."
            .into(),
    )
}

#[tauri::command]
pub fn db_clear_cloud_link(
    app: AppHandle,
    state: State<'_, DbState>,
    user_id: String,
) -> Result<(), String> {
    crate::session_guard::require_session_unlocked(&app, &state, &user_id)?;
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM cloud_link WHERE user_id = ?1", [&user_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })?;
    emit_db_changed(&app, "cloud_link", "clear", Some(&user_id));
    Ok(())
}
