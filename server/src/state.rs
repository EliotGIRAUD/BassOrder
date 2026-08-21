use crate::rate_limit::RateLimiter;
use crate::db::Db;
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Db>,
    pub jwt_secret: String,
    pub access_ttl_secs: i64,
    pub refresh_ttl_secs: i64,
    pub public_base: String,
    pub auth_limiter: Arc<RateLimiter>,
    /// Rate-limit écritures knowledge (PUT mirror) par compte.
    pub knowledge_write_limiter: Arc<RateLimiter>,
    /// Quorum minimal de comptes distincts pour publier une entrée pool.
    pub pool_min_votes: i64,
    /// Plafond likes pris en compte dans le poids pool (et à l’écriture miroir).
    pub likes_cap: i64,
}

impl AppState {
    pub fn from_env() -> Result<Self, String> {
        let jwt_secret = match std::env::var("BASSORDER_JWT_SECRET") {
            Ok(s) => {
                let t = s.trim().to_string();
                if t.len() < 32 {
                    return Err(
                        "BASSORDER_JWT_SECRET trop court (min 32 caractères aléatoires).".into(),
                    );
                }
                if t == "bassorder-dev-secret-change-me"
                    || t.contains("change-me")
                    || t.contains("changeme")
                {
                    return Err(
                        "BASSORDER_JWT_SECRET trop faible — génère un secret aléatoire.".into(),
                    );
                }
                t
            }
            Err(_) => {
                let allow = std::env::var("BASSORDER_ALLOW_INSECURE_DEV")
                    .ok()
                    .as_deref()
                    == Some("1");
                if !allow {
                    return Err(
                        "BASSORDER_JWT_SECRET requis. Pour le dév local uniquement : \
                         BASSORDER_ALLOW_INSECURE_DEV=1"
                            .into(),
                    );
                }
                tracing::warn!(
                    "BASSORDER_ALLOW_INSECURE_DEV=1 — secret JWT de dév faible (ne jamais exposer)"
                );
                // ≥ 32 chars, clairement non-prod
                "bassorder-insecure-dev-only-do-not-use".into()
            }
        };

        let db_path = std::env::var("BASSORDER_DB").unwrap_or_else(|_| {
            let dir = std::env::temp_dir().join("bassorder-api");
            let _ = std::fs::create_dir_all(&dir);
            dir.join("server.db").to_string_lossy().into_owned()
        });
        let db = Db::open(&db_path)?;
        let public_base = std::env::var("BASSORDER_PUBLIC_BASE")
            .unwrap_or_else(|_| "http://127.0.0.1:8787".into());

        // 20 tentatives / 15 min par IP(+email) sur login/register/refresh
        let auth_limiter = Arc::new(RateLimiter::new(20, Duration::from_secs(15 * 60)));
        // 10 syncs miroir / 15 min par compte (anti-DoS / spam pool)
        let knowledge_write_limiter =
            Arc::new(RateLimiter::new(10, Duration::from_secs(15 * 60)));

        let pool_min_votes = std::env::var("BASSORDER_POOL_MIN_VOTES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(2)
            .max(1);
        let likes_cap = std::env::var("BASSORDER_LIKES_CAP")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(100)
            .clamp(1, 10_000);

        Ok(Self {
            db: Arc::new(db),
            jwt_secret,
            access_ttl_secs: 15 * 60,
            refresh_ttl_secs: 60 * 60 * 24 * 30,
            public_base,
            auth_limiter,
            knowledge_write_limiter,
            pool_min_votes,
            likes_cap,
        })
    }
}
