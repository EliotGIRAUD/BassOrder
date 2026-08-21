//! Rate-limit mémoire simple (fenêtre glissante) par clé IP / email.

use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
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

pub fn client_key(addr: Option<SocketAddr>, extra: &str) -> String {
    let ip = addr
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| "unknown".into());
    if extra.is_empty() {
        ip
    } else {
        format!("{ip}|{extra}")
    }
}
