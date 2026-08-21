//! Connexion Spotify (PKCE) + import des titres likés → base de savoir.

use crate::genre_lookup::{lookup_artists_ex, normalize_artist};
use crate::genre_taxonomy::{placement_from_spotify_genres, resolve_placement};
use crate::knowledge::{self, Knowledge, KnowledgeArtist, KnowledgeStatus};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use futures::stream::{self, StreamExt};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

const REDIRECT_PORTS: &[u16] = &[41821, 41822];
const AUTH_TIMEOUT_SECS: u64 = 180;
const SCOPES: &str = "user-library-read user-top-read user-follow-read user-read-private";
/// Spotify bride le débit, mais un client HTTP partagé + ~28 en parallèle
/// est le meilleur compromis mesuré (moins de TLS, peu de 429 durables).
const ARTIST_CONCURRENCY: usize = 28;
const RELATED_CONCURRENCY: usize = 18;

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(18))
            .pool_max_idle_per_host(ARTIST_CONCURRENCY)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_nodelay(true)
            .build()
            .expect("reqwest client")
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    pub connected: bool,
    /// Tokens présents en DB (même si déchiffrement KO) — évite de croire « jamais connecté ».
    pub has_stored_auth: bool,
    pub client_id: Option<String>,
    pub avatar_url: Option<String>,
    pub knowledge: KnowledgeStatus,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct SpotifyAuth {
    client_id: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    display_name: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub label: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

#[derive(Deserialize, Clone)]
struct MeResponse {
    display_name: Option<String>,
    images: Option<Vec<SpotifyImage>>,
    #[allow(dead_code)]
    product: Option<String>,
}

#[derive(Deserialize, Clone)]
struct SpotifyImage {
    url: Option<String>,
    #[allow(dead_code)]
    height: Option<u32>,
    #[allow(dead_code)]
    width: Option<u32>,
}

#[derive(Deserialize)]
struct TopArtists {
    items: Vec<SpotifyArtist>,
}

#[derive(Deserialize)]
struct FollowingArtists {
    artists: Option<FollowingPage>,
}

#[derive(Deserialize)]
struct FollowingPage {
    items: Vec<SpotifyArtist>,
    cursors: Option<FollowingCursors>,
}

#[derive(Deserialize)]
struct FollowingCursors {
    after: Option<String>,
}

#[derive(Deserialize)]
struct SavedTracks {
    total: Option<usize>,
    items: Vec<SavedItem>,
}

#[derive(Deserialize)]
struct SavedItem {
    track: Option<SpotifyTrack>,
}

#[derive(Deserialize)]
struct SpotifyTrack {
    artists: Option<Vec<SpotifyArtistRef>>,
}

#[derive(Deserialize)]
struct SpotifyArtistRef {
    id: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct ArtistsResponse {
    artists: Vec<SpotifyArtist>,
}

#[derive(Deserialize)]
struct SpotifyArtist {
    id: Option<String>,
    name: Option<String>,
    genres: Option<Vec<String>>,
}

fn is_valid_spotify_client_id(client_id: &str) -> bool {
    // Les Client ID Spotify Dashboard sont en pratique 32 hex ; on accepte 16–64 [0-9a-f].
    let len = client_id.len();
    (16..=64).contains(&len) && client_id.bytes().all(|b| b.is_ascii_hexdigit())
}

fn load_auth(app: &AppHandle) -> SpotifyAuth {
    let profile_id = match crate::profile_store::active_profile_id() {
        Some(id) if !id.is_empty() && id != "legacy" => id,
        _ => {
            // Dernier recours : ne jamais écrire sous "legacy" si un vrai profil existe.
            if let Some(id) = crate::db::auth_fallback_profile_id(app) {
                crate::profile_store::set_active_profile_id(Some(id.clone()));
                let _ = crate::profile_store::persist_active(app);
                id
            } else {
                return SpotifyAuth::default();
            }
        }
    };
    if let Some((client_id, access_token, refresh_token, expires_at, display_name, avatar_url)) =
        crate::db::auth_load(app, &profile_id)
    {
        return SpotifyAuth {
            client_id,
            access_token,
            refresh_token,
            expires_at: expires_at as u64,
            display_name,
            avatar_url,
        };
    }
    SpotifyAuth::default()
}

fn profile_has_stored_auth(app: &AppHandle) -> bool {
    let Some(profile_id) = crate::profile_store::active_profile_id() else {
        return false;
    };
    crate::db::auth_has_stored_tokens(app, &profile_id)
}

fn save_auth(app: &AppHandle, auth: &SpotifyAuth) -> Result<(), String> {
    let profile_id = crate::profile_store::active_profile_id()
        .filter(|id| !id.is_empty() && id != "legacy")
        .ok_or_else(|| {
            "Aucun profil Spotify actif — enregistre un profil avant de connecter.".to_string()
        })?;
    crate::db::auth_save(
        app,
        &profile_id,
        &auth.client_id,
        &auth.access_token,
        &auth.refresh_token,
        auth.expires_at as i64,
        auth.display_name.as_deref(),
        auth.avatar_url.as_deref(),
    )
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_pair() -> (String, String) {
    let verifier = random_token(32);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

fn http_ok(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
}

fn wait_for_code(listener: TcpListener, expected_state: String) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        if start.elapsed() > Duration::from_secs(AUTH_TIMEOUT_SECS) {
            return Err("Connexion Spotify annulée (délai dépassé).".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .ok();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let line = req.lines().next().unwrap_or("");
                let query = line
                    .split_whitespace()
                    .nth(1)
                    .and_then(|p| p.split('?').nth(1))
                    .unwrap_or("");
                let mut code = None::<String>;
                let mut state = None::<String>;
                let mut error = None::<String>;
                for part in query.split('&') {
                    let mut kv = part.splitn(2, '=');
                    let k = kv.next().unwrap_or("");
                    let v = urlencoding::decode(kv.next().unwrap_or(""))
                        .unwrap_or_default()
                        .into_owned();
                    match k {
                        "code" => code = Some(v),
                        "state" => state = Some(v),
                        "error" => error = Some(v),
                        _ => {}
                    }
                }
                let page = callback_page(code.is_some() && error.is_none());
                let _ = stream.write_all(http_ok(&page).as_bytes());
                let _ = stream.flush();
                if let Some(err) = error {
                    return Err(format!("Spotify a refusé la connexion ({err})."));
                }
                if state.as_deref() != Some(expected_state.as_str()) {
                    return Err("État OAuth invalide.".into());
                }
                return code.ok_or_else(|| "Spotify n’a pas renvoyé de code.".into());
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

async fn exchange_token(
    client_id: &str,
    redirect: &str,
    code: &str,
    verifier: &str,
) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect),
            ("code_verifier", verifier),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Échange du token Spotify impossible. {body}"));
    }
    res.json().await.map_err(|e| e.to_string())
}

async fn refresh_token(auth: &SpotifyAuth) -> Result<SpotifyAuth, String> {
    if auth.refresh_token.is_empty() {
        return Err("Session Spotify expirée. Reconnecte-toi.".into());
    }
    let client = reqwest::Client::new();
    let res = client
        .post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("client_id", auth.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", auth.refresh_token.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err("Session Spotify expirée. Reconnecte-toi.".into());
    }
    let token: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(SpotifyAuth {
        client_id: auth.client_id.clone(),
        access_token: token.access_token,
        refresh_token: token.refresh_token.unwrap_or_else(|| auth.refresh_token.clone()),
        expires_at: now_secs() + token.expires_in.saturating_sub(30),
        display_name: auth.display_name.clone(),
        avatar_url: auth.avatar_url.clone(),
    })
}

async fn valid_auth(app: &AppHandle) -> Result<SpotifyAuth, String> {
    let mut auth = load_auth(app);
    if auth.refresh_token.is_empty() && auth.access_token.is_empty() {
        return Err("Aucun compte Spotify lié.".into());
    }
    if auth.access_token.is_empty() || auth.expires_at <= now_secs() {
        auth = refresh_token(&auth).await?;
        save_auth(app, &auth)?;
    }
    Ok(auth)
}

async fn spotify_get<T: for<'de> Deserialize<'de>>(
    token: &str,
    url: &str,
) -> Result<T, String> {
    let client = http_client();
    for attempt in 0..5u32 {
        let res = client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = res.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err("Session Spotify expirée. Reconnecte-toi.".into());
        }
        if status.as_u16() == 429 {
            let wait = res
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(1 + u64::from(attempt));
            // Respecte Retry-After sans bloquer tout le runtime.
            tokio::time::sleep(Duration::from_secs(wait.min(12))).await;
            continue;
        }
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(map_spotify_error(status.as_u16(), &body));
        }
        return res.json().await.map_err(|e| e.to_string());
    }
    Err("Spotify API : trop de requêtes (429), réessaie dans une minute.".into())
}

fn map_spotify_error(status: u16, body: &str) -> String {
    if status == 403 {
        return "Spotify refuse l’accès à tes likes (403). Dans le dashboard de l’app : User Management → ajoute ton compte. Le propriétaire de l’app doit être Premium (règle 2026). Puis Déconnecter et reconnecter dans BassOrder.".into();
    }
    if body.trim().is_empty() {
        return format!("Spotify API : HTTP {status}");
    }
    format!("Spotify API : {body}")
}

fn emit_progress(app: &AppHandle, phase: &str, done: usize, total: usize, label: &str) {
    let _ = app.emit(
        "spotify-sync-progress",
        SyncProgress {
            phase: phase.into(),
            done,
            total,
            label: label.into(),
        },
    );
}

#[tauri::command]
pub fn spotify_status(app: AppHandle) -> SpotifyStatus {
    knowledge::load(&app);
    let auth = load_auth(&app);
    let has_stored_auth = profile_has_stored_auth(&app);
    let client_id = if !auth.client_id.is_empty() {
        Some(auth.client_id.clone())
    } else {
        crate::profile_store::active_profile_id()
            .and_then(|id| crate::db::profile_client_id(&app, &id))
    };
    SpotifyStatus {
        connected: !auth.access_token.is_empty() || !auth.refresh_token.is_empty(),
        has_stored_auth,
        client_id,
        avatar_url: auth.avatar_url,
        knowledge: knowledge::status_groups(),
    }
}

/// Boot rapide : compteurs sans groupes (UI KPI immédiate).
#[tauri::command]
pub fn spotify_status_summary(app: AppHandle) -> SpotifyStatus {
    knowledge::load(&app);
    let auth = load_auth(&app);
    let has_stored_auth = profile_has_stored_auth(&app);
    let client_id = if !auth.client_id.is_empty() {
        Some(auth.client_id.clone())
    } else {
        crate::profile_store::active_profile_id()
            .and_then(|id| crate::db::profile_client_id(&app, &id))
    };
    SpotifyStatus {
        connected: !auth.access_token.is_empty() || !auth.refresh_token.is_empty(),
        has_stored_auth,
        client_id,
        avatar_url: auth.avatar_url,
        knowledge: knowledge::status_summary(),
    }
}

#[tauri::command]
pub async fn spotify_resume_session(app: AppHandle) -> Result<SpotifyStatus, String> {
    {
        let state = app.state::<crate::db::DbState>();
        if let Some(uid) = crate::session_guard::read_session_user(&state)? {
            crate::session_guard::require_unlocked(&app, &uid)?;
        }
    }
    knowledge::load(&app);
    let mut auth = load_auth(&app);
    if auth.refresh_token.is_empty() {
        return Err("Aucune session Spotify enregistrée pour ce profil.".into());
    }
    if auth.access_token.is_empty() || auth.expires_at <= now_secs() {
        auth = refresh_token(&auth).await?;
    }
    // Rescelle sous la clé courante (unifie trousseau / fichier).
    save_auth(&app, &auth)?;
    Ok(spotify_status(app))
}

#[tauri::command]
pub async fn spotify_connect(app: AppHandle, client_id: String) -> Result<SpotifyStatus, String> {
    {
        let state = app.state::<crate::db::DbState>();
        if let Some(uid) = crate::session_guard::read_session_user(&state)? {
            crate::session_guard::require_unlocked(&app, &uid)?;
        }
    }
    let client_id = client_id.trim().to_string();
    if !is_valid_spotify_client_id(&client_id) {
        return Err(
            "Client ID Spotify invalide. Colle l’ID de ton app (32 caractères hexadécimaux) depuis le dashboard développeur."
                .into(),
        );
    }

    // Soft reconnect : tokens déjà en DB → refresh sans navigateur.
    let existing = load_auth(&app);
    if !existing.refresh_token.is_empty()
        && (existing.client_id.is_empty() || existing.client_id == client_id)
    {
        let mut auth = existing.clone();
        auth.client_id = client_id.clone();
        match refresh_token(&auth).await {
            Ok(mut next) => {
                next.client_id = client_id.clone();
                if next.display_name.is_none() {
                    if let Ok(me) =
                        spotify_get::<MeResponse>(&next.access_token, "https://api.spotify.com/v1/me")
                            .await
                    {
                        next.display_name = me.display_name.clone();
                        next.avatar_url = pick_avatar(&me);
                    }
                }
                save_auth(&app, &next)?;
                let mut knowledge = knowledge::snapshot();
                if next.display_name.is_some() {
                    knowledge.display_name = next.display_name.clone();
                    let _ = knowledge::save(&app, &knowledge);
                }
                return Ok(spotify_status(app));
            }
            Err(_) => {
                // Token révoqué → OAuth complet ci-dessous
            }
        }
    }

    let mut bound = None;
    for port in REDIRECT_PORTS {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", *port)) {
            bound = Some(listener);
            break;
        }
    }
    let listener = bound.ok_or(
        "Impossible d’ouvrir le port local 41821. Ferme une ancienne tentative puis réessaie.",
    )?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}/callback");
    let (verifier, challenge) = pkce_pair();
    let state = random_token(16);
    // show_dialog=false si on a déjà autorisé : Spotify ne force pas le login à chaque fois.
    let force_dialog = existing.refresh_token.is_empty();
    let url = format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}&code_challenge_method=S256&code_challenge={}&state={}&show_dialog={}",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect),
        urlencoding::encode(SCOPES),
        challenge,
        state,
        if force_dialog { "true" } else { "false" }
    );

    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Impossible d’ouvrir le navigateur : {e}. URL : {url}"))?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, state))
        .await
        .map_err(|e| e.to_string())??;

    let token = exchange_token(&client_id, &redirect, &code, &verifier).await?;
    let me: MeResponse = spotify_get(&token.access_token, "https://api.spotify.com/v1/me").await?;
    let auth = SpotifyAuth {
        client_id,
        access_token: token.access_token,
        refresh_token: token.refresh_token.unwrap_or_default(),
        expires_at: now_secs() + token.expires_in.saturating_sub(30),
        display_name: me.display_name.clone(),
        avatar_url: pick_avatar(&me),
    };
    save_auth(&app, &auth)?;

    let mut knowledge = knowledge::snapshot();
    knowledge.display_name = auth.display_name.clone();
    knowledge::save(&app, &knowledge)?;

    Ok(spotify_status(app))
}

#[tauri::command]
pub async fn spotify_sync_likes(app: AppHandle) -> Result<SpotifyStatus, String> {
    knowledge::load(&app);
    let auth = valid_auth(&app).await?;
    emit_progress(&app, "likes", 0, 1, "Lecture des titres likés…");

    let (like_counts, liked_count, source) = match fetch_saved_artist_likes(&app, &auth.access_token).await {
        Ok((counts, total)) => {
            emit_progress(
                &app,
                "likes",
                total,
                total.max(1),
                &format!("{total} titres likés"),
            );
            (counts, total, "likes")
        }
        Err(err) if err.contains("403") => {
            emit_progress(
                &app,
                "likes",
                0,
                1,
                "Likes bloqués (403) — j’importe tes artistes les plus écoutés…",
            );
            let counts = fetch_taste_artists(&auth.access_token).await?;
            if counts.is_empty() {
                return Err(err);
            }
            let n = counts.len();
            (counts, n, "écoute")
        }
        Err(err) => return Err(err),
    };

    emit_progress(
        &app,
        "artists",
        0,
        like_counts.len().max(1),
        "Classement des artistes…",
    );
    let ids: Vec<String> = like_counts.keys().cloned().collect();
    let fetched = fetch_artists_detailed(&app, &auth.access_token, &ids).await;

    let mut knowledge = Knowledge {
        version: 1,
        synced_at: Some(chrono_now()),
        display_name: auth.display_name.clone(),
        liked_count,
        artists: HashMap::new(),
    };

    for (id, (fallback_name, _, likes)) in like_counts {
        let artist = fetched.get(&id);
        let name = artist
            .and_then(|a| a.name.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or(fallback_name);
        let raw_genres = artist
            .and_then(|a| a.genres.clone())
            .unwrap_or_default();
        let placement = placement_from_spotify_genres(&raw_genres)
            .or_else(|| crate::genre_db::placement_builtin(Some(&name)));
        let (parent, sub) = match placement {
            Some(p) => (
                p.segments.first().cloned().unwrap_or_default(),
                p.segments.last().cloned().unwrap_or_default(),
            ),
            None => (String::new(), String::new()),
        };
        knowledge.artists.insert(
            crate::genre_db::norm(&name),
            KnowledgeArtist {
                name,
                spotify_id: id,
                likes,
                raw_genres,
                parent,
                sub,
            },
        );
    }

    knowledge::save(&app, &knowledge)?;
    enrich_knowledge_gaps(&app, &auth.access_token).await?;
    crate::cloud_knowledge::maybe_push_after_local_save(&app).await;
    let label = if source == "likes" {
        "Base de savoir enregistrée"
    } else {
        "Base enregistrée via tes artistes les plus écoutés (likes encore bloqués)"
    };
    emit_progress(&app, "done", 1, 1, label);
    Ok(spotify_status(app))
}

#[tauri::command]
pub async fn spotify_enrich_knowledge(app: AppHandle) -> Result<SpotifyStatus, String> {
    knowledge::load(&app);
    let auth = valid_auth(&app).await?;
    emit_progress(
        &app,
        "enrich",
        0,
        1,
        "Préparation — on repère les artistes sans genre…",
    );
    enrich_knowledge_gaps(&app, &auth.access_token).await?;
    crate::cloud_knowledge::maybe_push_after_local_save(&app).await;
    emit_progress(&app, "done", 1, 1, "Terminé — ta base de savoir est à jour");
    Ok(spotify_status(app))
}

#[tauri::command]
pub fn spotify_disconnect(app: AppHandle) -> Result<SpotifyStatus, String> {
    {
        let state = app.state::<crate::db::DbState>();
        if let Some(uid) = crate::session_guard::read_session_user(&state)? {
            crate::session_guard::require_unlocked(&app, &uid)?;
        }
    }
    let empty = SpotifyAuth::default();
    let _ = save_auth(&app, &empty);
    Ok(spotify_status(app))
}

fn chrono_now() -> String {
    let secs = now_secs();
    format!("{secs}")
}

fn pick_avatar(me: &MeResponse) -> Option<String> {
    let mut images = me.images.clone().unwrap_or_default();
    images.sort_by(|a, b| b.height.unwrap_or(0).cmp(&a.height.unwrap_or(0)));
    images.into_iter().find_map(|img| img.url.filter(|u| !u.is_empty()))
}

type ArtistLikes = HashMap<String, (String, String, u32)>;

fn bump_artist(map: &mut ArtistLikes, artist: SpotifyArtist, weight: u32) {
    let Some(id) = artist.id.clone() else {
        return;
    };
    let name = artist.name.clone().unwrap_or_default();
    let entry = map.entry(id.clone()).or_insert((name, id, 0));
    entry.2 = entry.2.saturating_add(weight);
}

async fn fetch_saved_artist_likes(
    app: &AppHandle,
    token: &str,
) -> Result<(ArtistLikes, usize), String> {
    let mut offset = 0usize;
    let mut total;
    let mut like_counts = ArtistLikes::new();
    loop {
        let url = format!("https://api.spotify.com/v1/me/tracks?limit=50&offset={offset}");
        let page: SavedTracks = spotify_get(token, &url).await?;
        total = page.total.unwrap_or(offset + page.items.len());
        if page.items.is_empty() {
            break;
        }
        for item in page.items {
            let Some(track) = item.track else {
                continue;
            };
            for artist in track.artists.unwrap_or_default() {
                let Some(id) = artist.id else {
                    continue;
                };
                let name = artist.name.unwrap_or_default();
                let entry = like_counts.entry(id.clone()).or_insert((name, id, 0));
                entry.2 += 1;
            }
        }
        offset += 50;
        emit_progress(
            app,
            "likes",
            offset.min(total),
            total.max(1),
            &format!("Titres likés {}/{}", offset.min(total), total),
        );
        if offset >= total {
            break;
        }
    }
    Ok((like_counts, total))
}

async fn fetch_taste_artists(token: &str) -> Result<ArtistLikes, String> {
    let mut map = ArtistLikes::new();
    for range in ["long_term", "medium_term", "short_term"] {
        let url = format!("https://api.spotify.com/v1/me/top/artists?limit=50&time_range={range}");
        if let Ok(page) = spotify_get::<TopArtists>(token, &url).await {
            for artist in page.items {
                bump_artist(&mut map, artist, 3);
            }
        }
    }
    let mut after = None::<String>;
    for _ in 0..20 {
        let url = match &after {
            Some(cursor) => format!(
                "https://api.spotify.com/v1/me/following?type=artist&limit=50&after={cursor}"
            ),
            None => "https://api.spotify.com/v1/me/following?type=artist&limit=50".into(),
        };
        let Ok(page) = spotify_get::<FollowingArtists>(token, &url).await else {
            break;
        };
        let Some(artists) = page.artists else {
            break;
        };
        if artists.items.is_empty() {
            break;
        }
        for artist in artists.items {
            bump_artist(&mut map, artist, 1);
        }
        after = artists.cursors.and_then(|c| c.after);
        if after.is_none() {
            break;
        }
    }
    Ok(map)
}

async fn fetch_artists_detailed(
    app: &AppHandle,
    token: &str,
    ids: &[String],
) -> HashMap<String, SpotifyArtist> {
    let mut fetched = HashMap::new();
    if ids.is_empty() {
        return fetched;
    }

    // Probe : le batch /artists?ids= est souvent 403 sur les apps 2026.
    emit_progress(
        app,
        "artists",
        0,
        ids.len().max(1),
        "Test du lot Spotify (si ça échoue, bascule artiste par artiste)…",
    );
    let batch_ok = {
        let probe = &ids[..ids.len().min(50)];
        let url = format!(
            "https://api.spotify.com/v1/artists?ids={}",
            probe.join(",")
        );
        match spotify_get::<ArtistsResponse>(token, &url).await {
            Ok(pack) => {
                for artist in pack.artists {
                    if let Some(id) = artist.id.clone() {
                        fetched.insert(id, artist);
                    }
                }
                true
            }
            Err(_) => false,
        }
    };

    if batch_ok {
        let remaining: Vec<Vec<String>> = ids
            .chunks(50)
            .skip(1)
            .map(|chunk| chunk.to_vec())
            .collect();
        if !remaining.is_empty() {
            let token = token.to_string();
            let mut stream = stream::iter(remaining)
                .map(|chunk| {
                    let token = token.clone();
                    async move {
                        let url = format!(
                            "https://api.spotify.com/v1/artists?ids={}",
                            chunk.join(",")
                        );
                        spotify_get::<ArtistsResponse>(&token, &url).await.ok()
                    }
                })
                .buffer_unordered(6);

            while let Some(pack) = stream.next().await {
                if let Some(pack) = pack {
                    for artist in pack.artists {
                        if let Some(id) = artist.id.clone() {
                            fetched.insert(id, artist);
                        }
                    }
                }
                emit_progress(
                    app,
                    "artists",
                    fetched.len(),
                    ids.len().max(1),
                    &format!(
                        "Fiches Spotify en lots… {}/{}",
                        fetched.len(),
                        ids.len()
                    ),
                );
            }
        }
    }

    let missing: Vec<String> = ids
        .iter()
        .filter(|id| !fetched.contains_key(*id))
        .cloned()
        .collect();
    if missing.is_empty() {
        return fetched;
    }

    emit_progress(
        app,
        "artists",
        fetched.len(),
        ids.len().max(1),
        &format!(
            "Parallèle Spotify ×{ARTIST_CONCURRENCY} — {} fiches restantes…",
            missing.len()
        ),
    );

    let token = token.to_string();
    let total = ids.len().max(1);
    let mut done = fetched.len();
    let mut stream = stream::iter(missing)
        .map(|id| {
            let token = token.clone();
            async move {
                let url = format!("https://api.spotify.com/v1/artists/{id}");
                let artist = spotify_get::<SpotifyArtist>(&token, &url).await.ok();
                (id, artist)
            }
        })
        .buffer_unordered(ARTIST_CONCURRENCY);

    while let Some((id, artist)) = stream.next().await {
        let name = artist
            .as_ref()
            .and_then(|a| a.name.clone())
            .filter(|n| !n.is_empty());
        if let Some(artist) = artist {
            fetched.insert(id, artist);
        }
        done += 1;
        if done == 1 || done == total || done % 5 == 0 {
            let label = match &name {
                Some(n) => format!("Fiche Spotify — {n} · {done}/{total}"),
                None => format!("Fiches artistes Spotify… {done}/{total}"),
            };
            emit_progress(app, "artists", done, total, &label);
        }
    }
    fetched
}

/// Classe localement ce qu’on peut (genres déjà connus + dico embarqué) avant le réseau.
fn seed_local_placements(app: &AppHandle) -> usize {
    let mut knowledge = knowledge::snapshot();
    let mut seeded = 0usize;
    for artist in knowledge.artists.values_mut() {
        if !artist.parent.is_empty() {
            continue;
        }
        let Some(p) = placement_from_spotify_genres(&artist.raw_genres)
            .or_else(|| crate::genre_db::placement_builtin(Some(&artist.name)))
        else {
            continue;
        };
        artist.parent = p.segments.first().cloned().unwrap_or_default();
        artist.sub = p.segments.last().cloned().unwrap_or_default();
        seeded += 1;
    }
    if seeded > 0 {
        let _ = knowledge::save(app, &knowledge);
    }
    seeded
}

/// Complète les artistes sans parent : Spotify + related + iTunes/Deezer.
async fn enrich_knowledge_gaps(app: &AppHandle, token: &str) -> Result<(), String> {
    // Classement local d’abord (dico embarqué + genres déjà connus) → moins d’appels réseau.
    let seeded = seed_local_placements(app);
    if seeded > 0 {
        emit_progress(
            app,
            "enrich",
            0,
            1,
            &format!("Raccourci local — {seeded} artistes classés sans appeler Spotify…"),
        );
    }

    let mut knowledge = knowledge::snapshot();
    let mut need_rows: Vec<(String, u32)> = knowledge
        .artists
        .values()
        .filter(|a| a.parent.is_empty() && !a.spotify_id.is_empty())
        .map(|a| (a.spotify_id.clone(), a.likes))
        .collect();
    // Priorité aux plus likés : valeur visible plus tôt pendant l’attente.
    need_rows.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let need_ids: Vec<String> = need_rows.into_iter().map(|(id, _)| id).collect();

    if !need_ids.is_empty() {
        emit_progress(
            app,
            "artists",
            0,
            need_ids.len().max(1),
            &format!(
                "Étape 1/3 — fiches Spotify (×{ARTIST_CONCURRENCY} en parallèle) · {} artistes…",
                need_ids.len()
            ),
        );
        let fetched = fetch_artists_detailed(app, token, &need_ids).await;
        for artist in knowledge.artists.values_mut() {
            if !artist.parent.is_empty() {
                continue;
            }
            if let Some(sp) = fetched.get(&artist.spotify_id) {
                if let Some(genres) = &sp.genres {
                    if !genres.is_empty() {
                        artist.raw_genres = genres.clone();
                    }
                }
                if let Some(name) = &sp.name {
                    if !name.is_empty() {
                        artist.name = name.clone();
                    }
                }
            }
            if let Some(p) = placement_from_spotify_genres(&artist.raw_genres)
                .or_else(|| crate::genre_db::placement_builtin(Some(&artist.name)))
            {
                artist.parent = p.segments.first().cloned().unwrap_or_default();
                artist.sub = p.segments.last().cloned().unwrap_or_default();
            }
        }
        knowledge::save(app, &knowledge)?;
    }

    // Spotify vide genres[] : on vote via related.
    // Astuce : même si related.genres est vide, on croise leurs IDs avec
    // les artistes DÉJÀ classés dans notre dictionnaire (propagation locale).
    knowledge = knowledge::snapshot();
    let mut related_targets: Vec<(String, String, u32)> = knowledge
        .artists
        .values()
        .filter(|a| a.parent.is_empty() && !a.spotify_id.is_empty())
        .map(|a| (a.spotify_id.clone(), a.name.clone(), a.likes))
        .collect();
    related_targets.sort_by(|a, b| b.2.cmp(&a.2).then(a.1.cmp(&b.1)));
    let related_targets: Vec<(String, String)> = related_targets
        .into_iter()
        .map(|(id, name, _)| (id, name))
        .collect();
    if !related_targets.is_empty() {
        emit_progress(
            app,
            "related",
            0,
            related_targets.len().max(1),
            &format!(
                "Étape 2/4 — artistes liés + ton dico (×{RELATED_CONCURRENCY}) · {} restants…",
                related_targets.len()
            ),
        );
        let token_owned = token.to_string();
        let total = related_targets.len().max(1);
        let mut stream = stream::iter(related_targets)
            .map(|(id, _name)| {
                let token = token_owned.clone();
                async move {
                    let hint = related_artist_hint(&token, &id).await;
                    (id, hint)
                }
            })
            .buffer_unordered(RELATED_CONCURRENCY);

        let mut by_id: HashMap<String, RelatedHint> = HashMap::new();
        let mut done = 0usize;
        while let Some((id, hint)) = stream.next().await {
            done += 1;
            if !hint.genres.is_empty() || !hint.related_ids.is_empty() {
                by_id.insert(id, hint);
            }
            if done % 2 == 0 || done == total || done == 1 {
                emit_progress(
                    app,
                    "related",
                    done,
                    total,
                    &format!("Artistes proches — croisement des goûts… {done}/{total}"),
                );
            }
        }

        let mut knowledge = knowledge::snapshot();
        let known_by_sid: HashMap<String, (String, String, u32)> = knowledge
            .artists
            .values()
            .filter(|a| !a.spotify_id.is_empty() && !a.parent.is_empty())
            .map(|a| {
                (
                    a.spotify_id.clone(),
                    (a.parent.clone(), a.sub.clone(), a.likes.max(1)),
                )
            })
            .collect();

        for artist in knowledge.artists.values_mut() {
            if !artist.parent.is_empty() {
                continue;
            }
            let Some(hint) = by_id.get(&artist.spotify_id) else {
                continue;
            };
            if !hint.genres.is_empty() {
                artist.raw_genres = hint.genres.clone();
                if let Some(p) = placement_from_spotify_genres(&hint.genres)
                    .or_else(|| crate::genre_db::placement_builtin(Some(&artist.name)))
                {
                    artist.parent = p.segments.first().cloned().unwrap_or_default();
                    artist.sub = p.segments.last().cloned().unwrap_or_default();
                    continue;
                }
            }
            // Propagation : vote des voisins déjà classés dans NOTRE dico
            if let Some((parent, sub)) =
                vote_placement_from_related(&known_by_sid, &hint.related_ids)
            {
                artist.parent = parent;
                artist.sub = sub;
            }
        }
        knowledge::save(app, &knowledge)?;
    }

    knowledge = knowledge::snapshot();
    let mut queries: Vec<(String, Option<String>)> = Vec::new();
    for artist in knowledge.artists.values() {
        if !artist.parent.is_empty() {
            continue;
        }
        let name = normalize_artist(&artist.name);
        if name.is_empty() {
            continue;
        }
        if !queries
            .iter()
            .any(|(existing, _)| existing.eq_ignore_ascii_case(&name))
        {
            queries.push((name, None));
        }
    }

    if !queries.is_empty() {
        emit_progress(
            app,
            "catalog",
            0,
            queries.len().max(1),
            &format!(
                "Étape 3/4 — iTunes & Deezer pour {} artistes encore flous…",
                queries.len()
            ),
        );
        // retry_misses : le 1er enrich avait mis "" en cache iTunes.
        let cache = lookup_artists_ex(app, queries, true).await;
        let mut knowledge = knowledge::snapshot();
        for artist in knowledge.artists.values_mut() {
            if !artist.parent.is_empty() {
                continue;
            }
            let key = normalize_artist(&artist.name).to_ascii_lowercase();
            let Some(genre) = cache.get(&key) else {
                continue;
            };
            let p = resolve_placement(Some(genre.as_str()), None, "track.mp3", Some(&artist.name));
            if p.label == "Sans genre" || p.segments.first().map(String::as_str) == Some("Sans genre")
            {
                continue;
            }
            artist.parent = p.segments.first().cloned().unwrap_or_default();
            artist.sub = p.segments.last().cloned().unwrap_or_default();
            if artist.raw_genres.is_empty() {
                artist.raw_genres.push(genre.clone());
            }
        }
        knowledge::save(app, &knowledge)?;
    }

    // Étape 4 : MusicBrainz (tags) — lent mais gratuit, uniquement les restants les plus likés.
    knowledge = knowledge::snapshot();
    let mut mb_targets: Vec<(String, String, u32)> = knowledge
        .artists
        .values()
        .filter(|a| a.parent.is_empty())
        .map(|a| {
            (
                normalize_artist(&a.name),
                a.name.clone(),
                a.likes,
            )
        })
        .filter(|(norm, _, _)| !norm.is_empty())
        .collect();
    mb_targets.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)));
    {
        let mut seen = std::collections::HashSet::new();
        mb_targets.retain(|(norm, _, _)| seen.insert(norm.to_ascii_lowercase()));
    }
    // Cap pour rester raisonnable (~1 req/s MusicBrainz).
    const MB_CAP: usize = 280;
    if mb_targets.len() > MB_CAP {
        mb_targets.truncate(MB_CAP);
    }
    if !mb_targets.is_empty() {
        let names: Vec<String> = mb_targets.iter().map(|(n, _, _)| n.clone()).collect();
        let total_mb = names.len().max(1);
        emit_progress(
            app,
            "musicbrainz",
            0,
            total_mb,
            &format!(
                "Étape 4/4 — MusicBrainz tags · {} artistes prioritaires…",
                names.len()
            ),
        );
        let mb = crate::genre_lookup::lookup_musicbrainz_batch(app, names).await;
        let mut knowledge = knowledge::snapshot();
        let mut gained = 0u32;
        for artist in knowledge.artists.values_mut() {
            if !artist.parent.is_empty() {
                continue;
            }
            let key = normalize_artist(&artist.name).to_ascii_lowercase();
            let Some(genre) = mb.get(&key) else {
                continue;
            };
            if let Some(p) = placement_from_spotify_genres(std::slice::from_ref(genre)).or_else(
                || {
                    let r = resolve_placement(
                        Some(genre.as_str()),
                        None,
                        "track.mp3",
                        Some(&artist.name),
                    );
                    if r.label == "Sans genre"
                        || r.segments.first().map(String::as_str) == Some("Sans genre")
                    {
                        None
                    } else {
                        Some(r)
                    }
                },
            ) {
                artist.parent = p.segments.first().cloned().unwrap_or_default();
                artist.sub = p.segments.last().cloned().unwrap_or_default();
                if artist.raw_genres.is_empty() {
                    artist.raw_genres.push(genre.clone());
                }
                gained += 1;
            }
        }
        knowledge::save(app, &knowledge)?;
        if gained > 0 {
            emit_progress(
                app,
                "musicbrainz",
                total_mb,
                total_mb,
                &format!("MusicBrainz — {gained} artistes classés en plus"),
            );
        }
    }

    // Recaler les clés sur le nom normalisé (après renommages Spotify)
    {
        let mut knowledge = knowledge::snapshot();
        let rebuilt: HashMap<String, KnowledgeArtist> = knowledge
            .artists
            .into_values()
            .map(|a| (crate::genre_db::norm(&a.name), a))
            .collect();
        knowledge.artists = rebuilt;
        knowledge::save(app, &knowledge)?;
    }

    let _ = knowledge::reclassify_and_save(app);
    Ok(())
}

struct RelatedHint {
    genres: Vec<String>,
    related_ids: Vec<String>,
}

#[derive(Deserialize)]
struct RelatedArtistsResponse {
    artists: Vec<SpotifyArtist>,
}

/// Related Spotify : genres bruts + IDs (pour voter via notre dico).
async fn related_artist_hint(token: &str, artist_id: &str) -> RelatedHint {
    let url = format!("https://api.spotify.com/v1/artists/{artist_id}/related-artists");
    let Ok(page) = spotify_get::<RelatedArtistsResponse>(token, &url).await else {
        return RelatedHint {
            genres: Vec::new(),
            related_ids: Vec::new(),
        };
    };
    let mut votes: HashMap<String, usize> = HashMap::new();
    let mut related_ids = Vec::new();
    for related in page.artists {
        if let Some(id) = related.id {
            if !id.is_empty() {
                related_ids.push(id);
            }
        }
        for g in related.genres.unwrap_or_default() {
            let key = g.trim().to_string();
            if key.is_empty() {
                continue;
            }
            *votes.entry(key).or_default() += 1;
        }
    }
    let mut ranked: Vec<(String, usize)> = votes.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    RelatedHint {
        genres: ranked.into_iter().take(8).map(|(g, _)| g).collect(),
        related_ids,
    }
}

fn vote_placement_from_related(
    known_by_sid: &HashMap<String, (String, String, u32)>,
    related_ids: &[String],
) -> Option<(String, String)> {
    let mut votes: HashMap<(String, String), u32> = HashMap::new();
    let mut voters = 0u32;
    for id in related_ids {
        let Some((parent, sub, weight)) = known_by_sid.get(id) else {
            continue;
        };
        voters += 1;
        *votes
            .entry((parent.clone(), sub.clone()))
            .or_default() += *weight;
    }
    if voters == 0 {
        return None;
    }
    let mut ranked: Vec<((String, String), u32)> = votes.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.0.cmp(&b.0.0)));
    let ((parent, sub), _) = ranked.into_iter().next()?;
    Some((parent, sub))
}

fn callback_page(ok: bool) -> String {
    let (kicker, title, body, pill, pill_color) = if ok {
        (
            "MODULE CLOUD",
            "Compte lié",
            "Reviens dans BassOrder — l’import démarre tout seul. Tu peux fermer cet onglet.",
            "OK",
            "#7dffd4",
        )
    } else {
        (
            "MODULE CLOUD",
            "Connexion interrompue",
            "Spotify n’a pas validé l’accès. Referme cet onglet et réessaie depuis BassOrder.",
            "REFUS",
            "#ff8a7a",
        )
    };
    format!(
        r##"<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BassOrder · Spotify</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet">
  <style>
    html, body {{
      margin: 0;
      min-height: 100%;
      background: #000;
      color: #f6f1e8;
      font-family: "IBM Plex Sans", system-ui, sans-serif;
    }}
    body {{
      display: grid;
      place-items: center;
      padding: 32px 20px;
    }}
    main {{
      width: min(440px, 100%);
      padding: 2rem 1.8rem 1.7rem;
      border: 1px solid rgba(228, 195, 145, 0.28);
      border-radius: 22px;
      background: #050505;
      box-shadow: 0 0 80px rgba(125, 255, 212, 0.08);
    }}
    .eyebrow {{
      margin: 0;
      color: #e4c391;
      font-size: 0.72rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }}
    h1 {{
      margin: 0.45rem 0 0.85rem;
      font-family: Syne, system-ui, sans-serif;
      font-size: 2.1rem;
      letter-spacing: -0.04em;
    }}
    p {{
      margin: 0;
      color: #9a9288;
      line-height: 1.55;
    }}
    .pill {{
      display: inline-block;
      margin-top: 1.25rem;
      padding: 0.32rem 0.75rem;
      border-radius: 999px;
      border: 1px solid {pill_color};
      color: {pill_color};
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.12em;
    }}
    .brand {{
      background: linear-gradient(120deg, #e4c391, #fff6e8 40%, #7dffd4);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }}
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">{kicker}</p>
    <h1><span class="brand">Bass</span>Order</h1>
    <p><strong style="color:#f6f1e8">{title}</strong><br>{body}</p>
    <span class="pill">{pill}</span>
  </main>
</body>
</html>"##
    )
}
