//! BassOrder API — auth email + base OAuth hooks + health.
//! Dev: `cd server && cargo run`
//! Env: BASSORDER_JWT_SECRET, BASSORDER_API_ADDR (default 127.0.0.1:8787), BASSORDER_DB

mod auth;
mod db;
mod error;
mod knowledge;
mod rate_limit;
mod state;

use axum::{
    http::{header, HeaderValue, Method},
    routing::{get, post, put},
    Router,
};
use state::AppState;
use std::net::SocketAddr;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

fn cors_layer(bind_addr: SocketAddr) -> Result<CorsLayer, String> {
    let from_env = std::env::var("BASSORDER_CORS_ORIGINS").ok();
    let defaults = [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
    ];

    let list: Vec<String> = match from_env {
        Some(raw) if !raw.trim().is_empty() => raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        _ => {
            if !bind_addr.ip().is_loopback() {
                return Err(
                    "API liée hors localhost : définis BASSORDER_CORS_ORIGINS \
                     (liste d’origines séparées par des virgules)."
                        .into(),
                );
            }
            defaults.iter().map(|s| (*s).to_string()).collect()
        }
    };

    let origins: Result<Vec<HeaderValue>, _> = list
        .iter()
        .map(|o| {
            HeaderValue::from_str(o)
                .map_err(|_| format!("Origine CORS invalide: {o}"))
        })
        .collect();
    let origins = origins?;

    Ok(CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::OPTIONS])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
        ]))
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("bassorder_api=info".parse().unwrap()),
        )
        .init();

    let state = AppState::from_env().expect("init state");
    let addr: SocketAddr = std::env::var("BASSORDER_API_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8787".into())
        .parse()
        .expect("BASSORDER_API_ADDR");

    let cors = cors_layer(addr).expect("CORS");

    let app = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/refresh", post(auth::refresh))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/oauth/{provider}/start", get(auth::oauth_start))
        .route(
            "/auth/oauth/{provider}/callback",
            get(auth::oauth_callback),
        )
        .route("/knowledge/mirror", put(knowledge::put_mirror))
        .route("/knowledge/mirror", get(knowledge::get_mirror))
        .route("/knowledge/pool", get(knowledge::get_pool))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    tracing::info!("BassOrder API listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("serve");
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
