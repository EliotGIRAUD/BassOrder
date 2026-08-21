//! Session / déverrouillage PIN côté Rust (anti-IPC sans gate).

use crate::db::{with_conn, DbState};
use rusqlite::OptionalExtension;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const UNLOCK_TTL: Duration = Duration::from_secs(30 * 60);

pub struct SessionGate {
    unlocked: Mutex<Option<Unlocked>>,
}

struct Unlocked {
    user_id: String,
    until: Instant,
}

impl SessionGate {
    pub fn new() -> Self {
        Self {
            unlocked: Mutex::new(None),
        }
    }
}

fn gate(app: &AppHandle) -> Result<tauri::State<'_, SessionGate>, String> {
    app.try_state::<SessionGate>()
        .ok_or_else(|| "Session gate indisponible.".to_string())
}

pub fn mark_unlocked(app: &AppHandle, user_id: &str) -> Result<(), String> {
    let g = gate(app)?;
    let mut lock = g
        .unlocked
        .lock()
        .map_err(|_| "Session verrouillée.".to_string())?;
    *lock = Some(Unlocked {
        user_id: user_id.to_string(),
        until: Instant::now() + UNLOCK_TTL,
    });
    Ok(())
}

pub fn clear_unlock(app: &AppHandle) {
    if let Some(g) = app.try_state::<SessionGate>() {
        if let Ok(mut lock) = g.unlocked.lock() {
            *lock = None;
        }
    }
}

fn unlocked_user(app: &AppHandle) -> Option<String> {
    let g = app.try_state::<SessionGate>()?;
    let mut lock = g.unlocked.lock().ok()?;
    match lock.as_ref() {
        Some(u) if Instant::now() < u.until => Some(u.user_id.clone()),
        Some(_) => {
            *lock = None;
            None
        }
        None => None,
    }
}

pub fn read_session_user(state: &State<'_, DbState>) -> Result<Option<String>, String> {
    with_conn(state, |conn| {
        conn.query_row("SELECT user_id FROM session WHERE id = 1", [], |row| {
            row.get::<_, Option<String>>(0)
        })
        .optional()
        .map(|opt| opt.flatten())
        .map_err(|e| e.to_string())
    })
}

fn user_has_password(state: &State<'_, DbState>, user_id: &str) -> Result<bool, String> {
    with_conn(state, |conn| {
        let hash: Option<String> = conn
            .query_row(
                "SELECT password_hash FROM users WHERE id = ?1",
                [user_id],
                |row| row.get(0),
            )
            .map_err(|_| "Utilisateur introuvable.".to_string())?;
        Ok(hash.as_ref().is_some_and(|h| !h.is_empty()))
    })
}

/// Le `user_id` doit correspondre à la session active.
pub fn require_session_user(state: &State<'_, DbState>, user_id: &str) -> Result<(), String> {
    let current = read_session_user(state)?;
    match current {
        Some(ref id) if id == user_id => Ok(()),
        Some(_) => Err("Session active différente — reconnecte ce profil.".into()),
        None => Err("Aucune session active.".into()),
    }
}

/// Profil déverrouillé (PIN vérifié ou profil sans PIN).
pub fn require_unlocked(app: &AppHandle, user_id: &str) -> Result<(), String> {
    match unlocked_user(app) {
        Some(ref id) if id == user_id => Ok(()),
        Some(_) => Err("Profil verrouillé — déverrouille d’abord ce compte.".into()),
        None => Err("Profil verrouillé — saisis le PIN / mot de passe.".into()),
    }
}

/// Pour `db_set_session` : exige un unlock récent si le profil a un PIN.
pub fn assert_can_enter_session(
    app: &AppHandle,
    state: &State<'_, DbState>,
    user_id: &str,
) -> Result<(), String> {
    if user_has_password(state, user_id)? {
        require_unlocked(app, user_id)?;
    } else {
        mark_unlocked(app, user_id)?;
    }
    Ok(())
}

/// Opérations sensibles : session + unlock.
pub fn require_session_unlocked(
    app: &AppHandle,
    state: &State<'_, DbState>,
    user_id: &str,
) -> Result<(), String> {
    require_session_user(state, user_id)?;
    require_unlocked(app, user_id)
}
