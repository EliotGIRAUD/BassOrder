//! Rate-limit mémoire simple (fenêtre glissante) par clé IP / email.
//! Derrière Nginx : si le peer est loopback, on lit X-Real-IP (posé par le proxy).

use axum::http::HeaderMap;
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    inner: Mutex<HashMap<String, VecDeque<Instant>>>,
    max: usize,
    window: Duration,
}

impl RateLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            max,
            window,
        }
    }

    /// Renvoie `true` si la requête est autorisée.
    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut map = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let q = map.entry(key.to_string()).or_default();
        while let Some(front) = q.front() {
            if now.duration_since(*front) > self.window {
                q.pop_front();
            } else {
                break;
            }
        }
        if q.len() >= self.max {
            return false;
        }
        q.push_back(now);
        // Évite une croissance infinie de clés mortes
        if map.len() > 10_000 {
            map.retain(|_, v| !v.is_empty());
        }
        true
    }
}

/// IP client pour le rate-limit.
/// Ne fait confiance à `X-Real-IP` / `X-Forwarded-For` que si le peer est loopback
/// (Nginx local) — sinon spoof trivial.
pub fn client_ip(peer: Option<SocketAddr>, headers: &HeaderMap) -> String {
    let trusted_proxy = peer.map(|a| a.ip().is_loopback()).unwrap_or(false);
    if trusted_proxy {
        if let Some(ip) = parse_ip_header(headers, "x-real-ip") {
            return ip.to_string();
        }
        if let Some(ip) = first_forwarded_for(headers) {
            return ip.to_string();
        }
    }
    peer.map(|a| a.ip().to_string())
        .unwrap_or_else(|| "unknown".into())
}

pub fn client_key(peer: Option<SocketAddr>, headers: &HeaderMap, extra: &str) -> String {
    let ip = client_ip(peer, headers);
    if extra.is_empty() {
        ip
    } else {
        format!("{ip}|{extra}")
    }
}

fn parse_ip_header(headers: &HeaderMap, name: &str) -> Option<IpAddr> {
    let raw = headers.get(name)?.to_str().ok()?.trim();
    // Un seul hop attendu pour X-Real-IP
    if raw.contains(',') {
        return None;
    }
    raw.parse().ok()
}

fn first_forwarded_for(headers: &HeaderMap) -> Option<IpAddr> {
    let raw = headers.get("x-forwarded-for")?.to_str().ok()?;
    let first = raw.split(',').next()?.trim();
    first.parse().ok()
}
