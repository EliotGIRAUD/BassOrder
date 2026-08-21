//! Sync knowledge locale ↔ API cloud (miroir + pool).

use crate::db::{self, DbState};
use crate::knowledge::{self, Knowledge, KnowledgeArtist};
use crate::profile_store;
use crate::session_guard;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncResult {
    pub pushed: usize,
    pub filled: u32,
    pub last_sync_at: i64,
    pub profile_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthTokensBody {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MirrorPutResponse {
    artist_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PoolResponse {
    entries: Vec<PoolEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PoolEntry {
    artist_key: String,
    parent: String,
    sub: String,
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("reqwest")
    })
}

async fn ensure_access(
    app: &AppHandle,
    state: &State<'_, DbState>,
    user_id: &str,
    creds: &mut db::CloudCreds,
) -> Result<String, String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let expired = creds
        .expires_at
        .map(|exp| exp <= now_ms + 30_000)
        .unwrap_or(false);

    if !creds.access_token.is_empty() && !expired {
        return Ok(creds.access_token.clone());
    }
    if creds.refresh_token.is_empty() {
        return Err("Session cloud expirée — reconnecte-toi.".into());
    }

    let res = http_client()
        .post(format!("{}/auth/refresh", creds.api_base_url))
        .json(&json!({ "refreshToken": creds.refresh_token }))
        .send()
        .await
        .map_err(|e| format!("Refresh cloud: {e}"))?;
    if !res.status().is_success() {
        let msg = res.text().await.unwrap_or_default();
        return Err(format!("Refresh cloud échoué: {msg}"));
    }
    let tokens: AuthTokensBody = res
        .json()
        .await
        .map_err(|e| format!("Refresh JSON: {e}"))?;
    db::update_cloud_tokens(
        app,
        state,
        user_id,
        &tokens.access_token,
        &tokens.refresh_token,
        tokens.expires_at,
    )?;
    creds.access_token = tokens.access_token.clone();
    creds.refresh_token = tokens.refresh_token;
    creds.expires_at = Some(tokens.expires_at);
    Ok(tokens.access_token)
}

fn classified_payload(knowledge: &Knowledge) -> serde_json::Value {
    let mut artists = serde_json::Map::new();
    for (key, a) in &knowledge.artists {
        if a.parent.trim().is_empty() {
            continue;
        }
        artists.insert(
            key.clone(),
            json!({
                "name": a.name,
                "spotifyId": a.spotify_id,
                "likes": a.likes,
                "rawGenres": a.raw_genres,
                "parent": a.parent,
                "sub": a.sub,
            }),
        );
    }
    json!({
        "version": knowledge.version,
        "syncedAt": knowledge.synced_at,
        "displayName": knowledge.display_name,
        "likedCount": knowledge.liked_count,
        "artists": artists,
    })
}

async fn push_mirror(
    api_base: &str,
    token: &str,
    profile_id: &str,
    knowledge: &Knowledge,
) -> Result<usize, String> {
    let mut body = classified_payload(knowledge);
    if let Some(obj) = body.as_object_mut() {
        obj.insert("profileId".into(), json!(profile_id));
    }
    let res = http_client()
        .put(format!("{api_base}/knowledge/mirror"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Push miroir: {e}"))?;
    if !res.status().is_success() {
        let msg = res.text().await.unwrap_or_default();
        return Err(format!("Push miroir échoué: {msg}"));
    }
    let parsed: MirrorPutResponse = res
        .json()
        .await
        .map_err(|e| format!("Push miroir JSON: {e}"))?;
    Ok(parsed.artist_count)
}

async fn fetch_pool(
    api_base: &str,
    token: &str,
    keys: &[String],
) -> Result<Vec<PoolEntry>, String> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    // Chunks pour rester sous la limite serveur (~2000)
    let mut all = Vec::new();
    for chunk in keys.chunks(1500) {
        let keys_q = chunk
            .iter()
            .map(|k| urlencoding::encode(k))
            .collect::<Vec<_>>()
            .join(",");
        let url = format!("{api_base}/knowledge/pool?keys={keys_q}&limit=5000");
        let res = http_client()
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Pool: {e}"))?;
        if !res.status().is_success() {
            let msg = res.text().await.unwrap_or_default();
            return Err(format!("Pool échoué: {msg}"));
        }
        let parsed: PoolResponse = res
            .json()
            .await
            .map_err(|e| format!("Pool JSON: {e}"))?;
        all.extend(parsed.entries);
    }
    Ok(all)
}

/// Applique le consensus pool uniquement sur artistes locaux sans parent.
pub fn fill_from_pool(app: &AppHandle, entries: &[(String, String, String)]) -> Result<u32, String> {
    if entries.is_empty() {
        return Ok(0);
    }
    knowledge::load(app);
    let mut knowledge = knowledge::snapshot();
    let mut gained = 0u32;
    for (key, parent, sub) in entries {
        let parent = parent.trim();
        let sub = sub.trim();
        if parent.is_empty() {
            continue;
        }
        let Some(artist) = knowledge.artists.get_mut(key) else {
            continue;
        };
        if !artist.parent.is_empty() {
            continue;
        }
        artist.parent = parent.to_string();
        artist.sub = if sub.is_empty() {
            parent.to_string()
        } else {
            sub.to_string()
        };
        gained += 1;
    }
    if gained > 0 {
        knowledge::save(app, &knowledge)?;
    }
    Ok(gained)
}

/// Sync complète : push miroir + fill gaps depuis le pool.
#[tauri::command]
pub async fn knowledge_cloud_sync(
    app: AppHandle,
    user_id: String,
) -> Result<CloudSyncResult, String> {
    let state = app.state::<DbState>();
    session_guard::require_session_unlocked(&app, &state, &user_id)?;

    let mut creds = db::load_cloud_creds(&state, &user_id)?
        .ok_or_else(|| "Compte cloud non lié.".to_string())?;
    let token = ensure_access(&app, &state, &user_id, &mut creds).await?;

    knowledge::load(&app);
    let knowledge = knowledge::snapshot();
    let profile_id = profile_store::active_profile_id()
        .filter(|id| !id.is_empty() && id != "legacy")
        .or_else(|| crate::db::auth_fallback_profile_id(&app))
        .ok_or_else(|| "Aucun profil Spotify actif.".to_string())?;

    let pushed = push_mirror(&creds.api_base_url, &token, &profile_id, &knowledge).await?;

    let gap_keys: Vec<String> = knowledge
        .artists
        .iter()
        .filter(|(_, a)| a.parent.trim().is_empty())
        .map(|(k, _)| k.clone())
        .collect();

    let pool = fetch_pool(&creds.api_base_url, &token, &gap_keys).await?;
    let fill_rows: Vec<(String, String, String)> = pool
        .into_iter()
        .map(|e| (e.artist_key, e.parent, e.sub))
        .collect();
    let filled = fill_from_pool(&app, &fill_rows)?;

    // Re-push si le pool a comblé des trous
    if filled > 0 {
        let knowledge = knowledge::snapshot();
        let _ = push_mirror(&creds.api_base_url, &token, &profile_id, &knowledge).await?;
    }

    let last_sync_at = db::touch_cloud_last_sync(&app, &state, &user_id)?;
    Ok(CloudSyncResult {
        pushed,
        filled,
        last_sync_at,
        profile_id,
    })
}

/// Best-effort après sync Spotify (ignore si pas de cloud).
pub async fn maybe_push_after_local_save(app: &AppHandle) {
    let state = app.state::<DbState>();
    let Ok(Some(uid)) = session_guard::read_session_user(&state) else {
        return;
    };
    if db::load_cloud_creds(&state, &uid).ok().flatten().is_none() {
        return;
    }
    let _ = knowledge_cloud_sync(app.clone(), uid).await;
}

/// Expose fill pour tests / commandes internes — applique des placements pool.
#[allow(dead_code)]
pub fn apply_pool_map(
    app: &AppHandle,
    map: HashMap<String, KnowledgeArtist>,
) -> Result<u32, String> {
    let rows: Vec<(String, String, String)> = map
        .into_iter()
        .map(|(k, a)| (k, a.parent, a.sub))
        .collect();
    fill_from_pool(app, &rows)
}
