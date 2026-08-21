use crate::error::{ApiError, ApiResult};
use crate::rate_limit::client_key;
use crate::state::AppState;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{ConnectInfo, Path, State},
    http::HeaderMap,
    response::{IntoResponse, Redirect},
    Json,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshBody {
    pub refresh_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub account_id: String,
    pub email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeBody {
    pub id: String,
    pub email: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: String,
    email: String,
    exp: i64,
    iat: i64,
}

fn normalize_email(email: &str) -> ApiResult<String> {
    let e = email.trim().to_ascii_lowercase();
    if e.len() < 6 || e.len() > 254 {
        return Err(ApiError::BadRequest("Email invalide.".into()));
    }
    if e.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(ApiError::BadRequest("Email invalide.".into()));
    }
    let Some((local, domain)) = e.split_once('@') else {
        return Err(ApiError::BadRequest("Email invalide.".into()));
    };
    if local.is_empty() || local.len() > 64 || domain.len() < 3 {
        return Err(ApiError::BadRequest("Email invalide.".into()));
    }
    if !domain.contains('.') || domain.starts_with('.') || domain.ends_with('.') {
        return Err(ApiError::BadRequest("Email invalide.".into()));
    }
    let local_ok = local
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-' ));
    let domain_ok = domain
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' ));
    if !local_ok || !domain_ok {
        return Err(ApiError::BadRequest("Email invalide.".into()));
    }
    Ok(e)
}

fn enforce_auth_limit(state: &AppState, addr: Option<SocketAddr>, email_hint: &str) -> ApiResult<()> {
    let key = client_key(addr, email_hint);
    if state.auth_limiter.check(&key) {
        Ok(())
    } else {
        Err(ApiError::TooManyRequests(
            "Trop de tentatives — réessaie dans quelques minutes.".into(),
        ))
    }
}

fn hash_password(password: &str) -> ApiResult<String> {
    if password.len() < 8 {
        return Err(ApiError::BadRequest(
            "Mot de passe trop court (min. 8).".into(),
        ));
    }
    if password.len() > 128 {
        return Err(ApiError::BadRequest("Mot de passe trop long.".into()));
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| ApiError::Internal(e.to_string()))
}

fn verify_password(password: &str, hash: &str) -> ApiResult<bool> {
    let parsed = PasswordHash::new(hash).map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

fn hash_token(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

fn issue_tokens(state: &AppState, account_id: &str, email: &str) -> ApiResult<AuthTokens> {
    let iat = now_secs();
    let exp = iat + state.access_ttl_secs;
    let claims = Claims {
        sub: account_id.to_string(),
        email: email.to_string(),
        exp,
        iat,
    };
    let access = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    let refresh_raw = format!("r_{}", Uuid::new_v4());
    let refresh_id = Uuid::new_v4().to_string();
    let refresh_exp = iat + state.refresh_ttl_secs;
    state.db.store_refresh(
        &refresh_id,
        account_id,
        &hash_token(&refresh_raw),
        refresh_exp,
    )?;

    Ok(AuthTokens {
        access_token: access,
        refresh_token: refresh_raw,
        expires_at: exp * 1000,
        account_id: account_id.to_string(),
        email: email.to_string(),
    })
}

fn bearer(headers: &HeaderMap) -> ApiResult<String> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::Unauthorized("Token manquant.".into()))?;
    auth.strip_prefix("Bearer ")
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::Unauthorized("Bearer invalide.".into()))
}

fn decode_access(state: &AppState, token: &str) -> ApiResult<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|d| d.claims)
    .map_err(|_| ApiError::Unauthorized("Token invalide ou expiré.".into()))
}

/// Compte authentifié via Bearer JWT (endpoints knowledge, etc.).
pub fn require_account(
    state: &AppState,
    headers: &HeaderMap,
) -> ApiResult<crate::db::AccountRow> {
    let token = bearer(headers)?;
    let claims = decode_access(state, &token)?;
    state
        .db
        .find_by_id(&claims.sub)?
        .ok_or_else(|| ApiError::Unauthorized("Compte introuvable.".into()))
}

pub async fn register(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<Credentials>,
) -> ApiResult<Json<AuthTokens>> {
    let email = normalize_email(&body.email)?;
    enforce_auth_limit(&state, Some(addr), &email)?;
    let hash = hash_password(&body.password)?;
    let id = Uuid::new_v4().to_string();
    state.db.create_account(&id, &email, Some(&hash))?;
    Ok(Json(issue_tokens(&state, &id, &email)?))
}

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<Credentials>,
) -> ApiResult<Json<AuthTokens>> {
    let email = normalize_email(&body.email)?;
    enforce_auth_limit(&state, Some(addr), &email)?;
    let account = state
        .db
        .find_by_email(&email)?
        .ok_or_else(|| ApiError::Unauthorized("Identifiants incorrects.".into()))?;
    let hash = account
        .password_hash
        .as_deref()
        .ok_or_else(|| {
            ApiError::Unauthorized(
                "Compte OAuth uniquement — utilise Google/Discord.".into(),
            )
        })?;
    if !verify_password(&body.password, hash)? {
        return Err(ApiError::Unauthorized("Identifiants incorrects.".into()));
    }
    Ok(Json(issue_tokens(&state, &account.id, &account.email)?))
}

pub async fn refresh(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<RefreshBody>,
) -> ApiResult<Json<AuthTokens>> {
    let hint = {
        let mut hasher = Sha256::new();
        hasher.update(body.refresh_token.as_bytes());
        hex::encode(hasher.finalize())[..16].to_string()
    };
    enforce_auth_limit(&state, Some(addr), &hint)?;
    let hashed = hash_token(&body.refresh_token);
    let row = state
        .db
        .take_refresh(&hashed)?
        .ok_or_else(|| ApiError::Unauthorized("Refresh invalide.".into()))?;
    if row.revoked || row.expires_at < now_secs() {
        return Err(ApiError::Unauthorized("Refresh expiré.".into()));
    }
    let account = state
        .db
        .find_by_id(&row.account_id)?
        .ok_or_else(|| ApiError::Unauthorized("Compte introuvable.".into()))?;
    Ok(Json(issue_tokens(&state, &account.id, &account.email)?))
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RefreshBody>,
) -> ApiResult<impl IntoResponse> {
    let _ = bearer(&headers); // access optional for revoke
    let _ = state
        .db
        .revoke_refresh_hash(&hash_token(&body.refresh_token));
    Ok(axum::http::StatusCode::NO_CONTENT)
}

pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<MeBody>> {
    let token = bearer(&headers)?;
    let claims = decode_access(&state, &token)?;
    let account = state
        .db
        .find_by_id(&claims.sub)?
        .ok_or_else(|| ApiError::NotFound("Compte introuvable.".into()))?;
    Ok(Json(MeBody {
        id: account.id,
        email: account.email,
        created_at: account.created_at,
    }))
}

pub async fn oauth_start(
    State(state): State<AppState>,
    Path(provider): Path<String>,
) -> impl IntoResponse {
    let p = provider.to_ascii_lowercase();
    if p != "google" && p != "discord" {
        return ApiError::BadRequest("Provider inconnu.".into()).into_response();
    }
    // Provider déjà restreint à un allowlist — pas d’interpolation HTML libre.
    let label = if p == "google" { "Google" } else { "Discord" };
    let env_key = if p == "google" { "GOOGLE" } else { "DISCORD" };
    let base = html_escape(&state.public_base);
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>OAuth {label}</title>\
         <body style='font-family:system-ui;background:#0a0c0e;color:#e8ecef;padding:2rem'>\
         <h1>OAuth {label}</h1>\
         <p>Configure <code>BASSORDER_{env_key}_CLIENT_ID</code> / <code>SECRET</code> sur le serveur.\
         Callback : <code>{base}/auth/oauth/{p}/callback</code></p>\
         <p><a href='{base}' style='color:#5ec4b0'>Retour API</a></p></body>",
    );
    (
        axum::http::StatusCode::OK,
        [("content-type", "text/html; charset=utf-8")],
        html,
    )
        .into_response()
}

pub async fn oauth_callback(
    State(_state): State<AppState>,
    Path(provider): Path<String>,
) -> impl IntoResponse {
    let p = provider.to_ascii_lowercase();
    if p != "google" && p != "discord" {
        return ApiError::BadRequest("Provider inconnu.".into()).into_response();
    }
    Redirect::temporary(&format!("/auth/oauth/{p}/start")).into_response()
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
