//! Knowledge cloud — miroir privé + pool agrégé lecture seule.

use crate::auth;
use crate::db::MirrorArtistRow;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const MAX_MIRROR_ARTISTS: usize = 50_000;
const MAX_POOL_LIMIT: i64 = 5_000;
const MAX_POOL_KEYS: usize = 2_000;
const MAX_PROFILE_ID_LEN: usize = 128;
const MAX_ARTIST_KEY_LEN: usize = 256;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorPutBody {
    pub profile_id: String,
    #[serde(default = "default_version")]
    pub version: u32,
    pub synced_at: Option<String>,
    pub display_name: Option<String>,
    #[serde(default)]
    pub liked_count: u64,
    #[serde(default)]
    pub artists: HashMap<String, MirrorArtistBody>,
}

fn default_version() -> u32 {
    1
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorArtistBody {
    pub name: String,
    #[serde(default)]
    pub spotify_id: String,
    #[serde(default)]
    pub likes: u32,
    #[serde(default)]
    pub raw_genres: Vec<String>,
    #[serde(default)]
    pub parent: String,
    #[serde(default)]
    pub sub: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorPutResponse {
    pub profile_id: String,
    pub artist_count: usize,
    pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorGetResponse {
    pub profile_id: String,
    pub version: u32,
    pub synced_at: Option<String>,
    pub display_name: Option<String>,
    pub liked_count: u64,
    pub updated_at: String,
    pub artists: HashMap<String, MirrorArtistOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorArtistOut {
    pub name: String,
    pub spotify_id: String,
    pub likes: u32,
    pub raw_genres: Vec<String>,
    pub parent: String,
    pub sub: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorQuery {
    pub profile_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolQuery {
    /// Clés artistes séparées par des virgules (optionnel).
    pub keys: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolResponse {
    pub entries: Vec<PoolEntryOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolEntryOut {
    pub artist_key: String,
    pub parent: String,
    pub sub: String,
    pub votes: u32,
    pub weight: u64,
}

fn validate_profile_id(id: &str) -> ApiResult<&str> {
    let t = id.trim();
    if t.is_empty() || t.len() > MAX_PROFILE_ID_LEN {
        return Err(ApiError::BadRequest("profileId invalide.".into()));
    }
    if t.chars().any(|c| c.is_control()) {
        return Err(ApiError::BadRequest("profileId invalide.".into()));
    }
    Ok(t)
}

pub async fn put_mirror(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<MirrorPutBody>,
) -> ApiResult<Json<MirrorPutResponse>> {
    let account = auth::require_account(&state, &headers)?;
    let profile_id = validate_profile_id(&body.profile_id)?.to_string();

    if body.artists.len() > MAX_MIRROR_ARTISTS {
        return Err(ApiError::BadRequest(format!(
            "Trop d’artistes (max {MAX_MIRROR_ARTISTS})."
        )));
    }

    let mut rows: Vec<MirrorArtistRow> = Vec::with_capacity(body.artists.len());
    for (key, artist) in &body.artists {
        let artist_key = key.trim();
        if artist_key.is_empty() || artist_key.len() > MAX_ARTIST_KEY_LEN {
            continue;
        }
        let parent = artist.parent.trim();
        if parent.is_empty() {
            continue;
        }
        let raw = serde_json::to_string(&artist.raw_genres).unwrap_or_else(|_| "[]".into());
        rows.push(MirrorArtistRow {
            artist_key: artist_key.to_string(),
            name: artist.name.trim().chars().take(256).collect(),
            spotify_id: artist.spotify_id.trim().chars().take(64).collect(),
            likes: i64::from(artist.likes),
            raw_genres: raw,
            parent: parent.chars().take(128).collect(),
            sub: artist.sub.trim().chars().take(128).collect(),
        });
    }

    let count = state.db.put_knowledge_mirror(
        &account.id,
        &profile_id,
        i64::from(body.version.max(1)),
        body.synced_at.as_deref(),
        body.display_name.as_deref(),
        body.liked_count as i64,
        &rows,
    )?;

    Ok(Json(MirrorPutResponse {
        profile_id,
        artist_count: count,
        updated_at: chrono::Utc::now().to_rfc3339(),
    }))
}

pub async fn get_mirror(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<MirrorQuery>,
) -> ApiResult<Json<MirrorGetResponse>> {
    let account = auth::require_account(&state, &headers)?;
    let profile_id = validate_profile_id(&q.profile_id)?.to_string();

    let bundle = state
        .db
        .get_knowledge_mirror(&account.id, &profile_id)?
        .ok_or_else(|| ApiError::NotFound("Miroir knowledge introuvable.".into()))?;

    let mut artists = HashMap::new();
    for a in bundle.artists {
        let raw_genres: Vec<String> =
            serde_json::from_str(&a.raw_genres).unwrap_or_default();
        artists.insert(
            a.artist_key,
            MirrorArtistOut {
                name: a.name,
                spotify_id: a.spotify_id,
                likes: a.likes.clamp(0, u32::MAX as i64) as u32,
                raw_genres,
                parent: a.parent,
                sub: a.sub,
            },
        );
    }

    Ok(Json(MirrorGetResponse {
        profile_id,
        version: bundle.meta.version.clamp(0, u32::MAX as i64) as u32,
        synced_at: bundle.meta.synced_at,
        display_name: bundle.meta.display_name,
        liked_count: bundle.meta.liked_count.max(0) as u64,
        updated_at: bundle.meta.updated_at,
        artists,
    }))
}

pub async fn get_pool(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<PoolQuery>,
) -> ApiResult<Json<PoolResponse>> {
    let _account = auth::require_account(&state, &headers)?;

    let keys: Option<Vec<String>> = q.keys.as_ref().map(|raw| {
        raw.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s.len() <= MAX_ARTIST_KEY_LEN)
            .take(MAX_POOL_KEYS)
            .collect()
    });

    let limit = q
        .limit
        .unwrap_or(MAX_POOL_LIMIT)
        .clamp(1, MAX_POOL_LIMIT);

    let rows = state
        .db
        .knowledge_pool(keys.as_deref(), limit)?;

    Ok(Json(PoolResponse {
        entries: rows
            .into_iter()
            .map(|r| PoolEntryOut {
                artist_key: r.artist_key,
                parent: r.parent,
                sub: r.sub,
                votes: r.votes.clamp(0, u32::MAX as i64) as u32,
                weight: r.weight.max(0) as u64,
            })
            .collect(),
    }))
}
