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

fn enforce_auth_limit(
    state: &AppState,
    addr: Option<SocketAddr>,
    headers: &HeaderMap,
    email_hint: &str,
) -> ApiResult<()> {
    let key = client_key(addr, headers, email_hint);
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
    headers: HeaderMap,
    Json(body): Json<Credentials>,
) -> ApiResult<Json<AuthTokens>> {
    let email = normalize_email(&body.email)?;
    enforce_auth_limit(&state, Some(addr), &headers, &email)?;
    let hash = hash_password(&body.password)?;
    let id = Uuid::new_v4().to_string();
    state.db.create_account(&id, &email, Some(&hash))?;
    Ok(Json(issue_tokens(&state, &id, &email)?))
}

pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<Credentials>,
) -> ApiResult<Json<AuthTokens>> {
    let email = normalize_email(&body.email)?;
    enforce_auth_limit(&state, Some(addr), &headers, &email)?;
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
    headers: HeaderMap,
    Json(body): Json<RefreshBody>,
) -> ApiResult<Json<AuthTokens>> {
    let hint = {
        let mut hasher = Sha256::new();
        hasher.update(body.refresh_token.as_bytes());
        hex::encode(hasher.finalize())[..16].to_string()
    };
    enforce_auth_limit(&state, Some(addr), &headers, &hint)?;
    let hashed = hash_token(&body.refresh_token);
    let row = state
        .db
        .take_refresh(&hashed)?
        .ok_or_else(|| ApiError::Unauthorized("Refresh invalide.".into()))?;
    if row.revoked || row.expires_at < now_secs() {
        // Réutilisation d’un refresh déjà révoqué → probable vol : wipe toutes les sessions.
        if row.revoked {
            let _ = state.db.revoke_all_refresh_for_account(&row.account_id);
            tracing::warn!(
                account_id = %row.account_id,
                "refresh token reuse détecté — sessions révoquées"
            );
        }
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
    // Si access JWT valide → révoque TOUTES les sessions du compte.
    if let Ok(token) = bearer(&headers) {
        if let Ok(claims) = decode_access(&state, &token) {
            let _ = state.db.revoke_all_refresh_for_account(&claims.sub);
            return Ok(axum::http::StatusCode::NO_CONTENT);
        }
    }
    // Sinon, révoque uniquement le refresh fourni (best-effort).
    if !body.refresh_token.trim().is_empty() {
        let _ = state
            .db
            .revoke_refresh_hash(&hash_token(&body.refresh_token));
    }
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAccountBody {
    /// Doit être exactement `DELETE`.
    pub confirm: String,
    /// Requis si le compte a un mot de passe (email/password).
    pub password: Option<String>,
}

/// Suppression définitive du compte cloud (RGPD) + miroir knowledge.
pub async fn delete_account(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<DeleteAccountBody>,
) -> ApiResult<impl IntoResponse> {
    if body.confirm.trim() != "DELETE" {
        return Err(ApiError::BadRequest(
            "Confirmation invalide — envoie confirm: \"DELETE\".".into(),
        ));
    }
    let account = require_account(&state, &headers)?;
    enforce_auth_limit(&state, Some(addr), &headers, &account.email)?;

    if let Some(hash) = account.password_hash.as_deref() {
        let password = body
            .password
            .as_deref()
            .ok_or_else(|| ApiError::BadRequest("Mot de passe requis.".into()))?;
        if !verify_password(password, hash)? {
            return Err(ApiError::Unauthorized("Identifiants incorrects.".into()));
        }
    }

    if !state.db.delete_account(&account.id)? {
        return Err(ApiError::NotFound("Compte introuvable.".into()));
    }
    tracing::info!(account_id = %account.id, "compte cloud supprimé");
    Ok(axum::http::StatusCode::NO_CONTENT)
}

fn oauth_configured(provider: &str) -> bool {
    let (id_key, secret_key) = match provider {
        "google" => ("BASSORDER_GOOGLE_CLIENT_ID", "BASSORDER_GOOGLE_CLIENT_SECRET"),
        "discord" => (
            "BASSORDER_DISCORD_CLIENT_ID",
            "BASSORDER_DISCORD_CLIENT_SECRET",
        ),
        _ => return false,
    };
    let id = std::env::var(id_key).unwrap_or_default();
    let secret = std::env::var(secret_key).unwrap_or_default();
    !id.trim().is_empty() && !secret.trim().is_empty()
}

pub async fn oauth_start(
    State(_state): State<AppState>,
    Path(provider): Path<String>,
) -> impl IntoResponse {
    let p = provider.to_ascii_lowercase();
    if p != "google" && p != "discord" {
        return ApiError::NotFound("OAuth indisponible.".into()).into_response();
    }
    if !oauth_configured(&p) {
        return ApiError::NotFound("OAuth non configuré.".into()).into_response();
    }
    // Branchement réel (redirect provider) à implémenter quand les secrets sont posés.
    ApiError::BadRequest("OAuth provider non encore branché.".into()).into_response()
}

pub async fn oauth_callback(
    State(_state): State<AppState>,
    Path(provider): Path<String>,
) -> impl IntoResponse {
    let p = provider.to_ascii_lowercase();
    if (p != "google" && p != "discord") || !oauth_configured(&p) {
        return ApiError::NotFound("OAuth indisponible.".into()).into_response();
    }
    Redirect::temporary(&format!("/auth/oauth/{p}/start")).into_response()
}
