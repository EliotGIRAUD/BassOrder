//! Base de savoir apprise depuis les likes Spotify.
//! Un fichier par profil Spotify actif (`knowledge/{profileId}.json`).

use crate::genre_db::{artist_candidates, is_generic_token, nested, norm};
use crate::genre_taxonomy::Placement;
use crate::profile_store;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

static STORE: OnceLock<Mutex<Knowledge>> = OnceLock::new();

fn store() -> &'static Mutex<Knowledge> {
    STORE.get_or_init(|| Mutex::new(Knowledge::default()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeArtist {
    pub name: String,
    pub spotify_id: String,
    pub likes: u32,
    pub raw_genres: Vec<String>,
    pub parent: String,
    pub sub: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Knowledge {
    pub version: u32,
    pub synced_at: Option<String>,
    pub display_name: Option<String>,
    pub liked_count: usize,
    pub artists: HashMap<String, KnowledgeArtist>,
}

impl Default for Knowledge {
    fn default() -> Self {
        Self {
            version: 1,
            synced_at: None,
            display_name: None,
            liked_count: 0,
            artists: HashMap::new(),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGroup {
    pub genre: String,
    pub folder: String,
    pub artist_count: usize,
    pub likes: u32,
    pub artists: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeStatus {
    pub synced_at: Option<String>,
    pub display_name: Option<String>,
    pub liked_count: usize,
    pub artist_count: usize,
    pub classified_artists: usize,
    pub groups: Vec<KnowledgeGroup>,
}

pub fn load(app: &AppHandle) {
    let profile_id = profile_store::active_profile_id()
        .filter(|id| !id.is_empty() && id != "legacy")
        .or_else(|| crate::db::auth_fallback_profile_id(app))
        .unwrap_or_else(|| "legacy".into());
    if profile_store::active_profile_id().as_deref() != Some(profile_id.as_str())
        && profile_id != "legacy"
    {
        profile_store::set_active_profile_id(Some(profile_id.clone()));
        let _ = profile_store::persist_active(app);
    }
    match crate::db::knowledge_load(app, &profile_id) {
        Ok(mut parsed) => {
            let changed = reclassify_inplace(&mut parsed);
            if let Ok(mut guard) = store().lock() {
                *guard = parsed.clone();
            }
            if changed {
                let _ = save(app, &parsed);
            }
        }
        Err(_) => {
            if let Ok(mut guard) = store().lock() {
                *guard = Knowledge::default();
            }
        }
    }
}

/// Active un profil : bascule knowledge (+ marqueur disque). L’auth Spotify suit le même id.
#[tauri::command]
pub fn activate_spotify_profile(app: AppHandle, profile_id: String) -> KnowledgeStatus {
    let id = profile_id.trim();
    if id.is_empty() {
        return status_summary();
    }
    profile_store::migrate_legacy_into(&app, id);
    profile_store::set_active_profile_id(Some(id.to_string()));
    let _ = profile_store::persist_active(&app);
    load(&app);
    status_groups()
}

#[tauri::command]
pub fn active_spotify_profile() -> Option<String> {
    profile_store::active_profile_id()
}

/// Remplit parent/sub depuis raw_genres + dictionnaire interne (sans réseau).
pub fn reclassify_inplace(knowledge: &mut Knowledge) -> bool {
    use crate::genre_taxonomy::placement_from_spotify_genres;
    let mut changed = false;
    for artist in knowledge.artists.values_mut() {
        if !artist.parent.is_empty() {
            continue;
        }
        let placement = placement_from_spotify_genres(&artist.raw_genres)
            .or_else(|| crate::genre_db::placement_builtin(Some(&artist.name)));
        let Some(p) = placement else {
            continue;
        };
        artist.parent = p.segments.first().cloned().unwrap_or_default();
        artist.sub = p.segments.last().cloned().unwrap_or_default();
        changed = true;
    }
    changed
}

pub fn reclassify_and_save(app: &AppHandle) -> KnowledgeStatus {
    load(app);
    let mut knowledge = snapshot();
    if reclassify_inplace(&mut knowledge) {
        let _ = save(app, &knowledge);
    }
    status()
}

pub fn save(app: &AppHandle, knowledge: &Knowledge) -> Result<(), String> {
    let profile_id = profile_store::active_profile_id()
        .filter(|id| !id.is_empty() && id != "legacy")
        .ok_or_else(|| "Aucun profil Spotify actif pour sauvegarder le dictionnaire.".to_string())?;
    crate::db::knowledge_save(app, &profile_id, knowledge)?;
    if let Ok(mut guard) = store().lock() {
        *guard = knowledge.clone();
    }
    Ok(())
}

pub fn snapshot() -> Knowledge {
    match store().lock() {
        Ok(g) => g.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

pub fn status() -> KnowledgeStatus {
    status_inner(true)
}

/// Compteurs seuls — boot UI rapide (pas de groupes IPC).
pub fn status_summary() -> KnowledgeStatus {
    let store = snapshot();
    let classified = store
        .artists
        .values()
        .filter(|a| !a.parent.is_empty())
        .count();
    KnowledgeStatus {
        synced_at: store.synced_at,
        display_name: store.display_name,
        liked_count: store.liked_count,
        artist_count: store.artists.len(),
        classified_artists: classified,
        groups: Vec::new(),
    }
}

/// Groupes sans listes d’artistes (noms chargés à la demande).
pub fn status_groups() -> KnowledgeStatus {
    status_inner(false)
}

fn status_inner(include_artist_names: bool) -> KnowledgeStatus {
    let store = snapshot();
    let classified = store
        .artists
        .values()
        .filter(|a| !a.parent.is_empty())
        .count();

    let mut buckets: HashMap<String, KnowledgeGroup> = HashMap::new();
    for artist in store.artists.values() {
        let (genre, folder) = placement_folder(artist);
        let entry = buckets.entry(folder.to_ascii_lowercase()).or_insert_with(|| {
            KnowledgeGroup {
                genre,
                folder: folder.clone(),
                artist_count: 0,
                likes: 0,
                artists: Vec::new(),
            }
        });
        entry.artist_count += 1;
        entry.likes += artist.likes;
        if include_artist_names && entry.artists.len() < 48 {
            entry.artists.push(artist.name.clone());
        }
    }

    let mut groups: Vec<KnowledgeGroup> = buckets.into_values().collect();
    groups.sort_by(|a, b| {
        let a_open = a.folder == "À classer";
        let b_open = b.folder == "À classer";
        a_open
            .cmp(&b_open)
            .then(b.likes.cmp(&a.likes))
            .then(a.genre.cmp(&b.genre))
    });

    KnowledgeStatus {
        synced_at: store.synced_at,
        display_name: store.display_name,
        liked_count: store.liked_count,
        artist_count: store.artists.len(),
        classified_artists: classified,
        groups,
    }
}

/// Artistes d’un dossier (max 48), pour le détail Spotify.
#[tauri::command]
pub fn knowledge_group_artists(app: AppHandle, folder: String) -> Vec<String> {
    load(&app);
    let needle = folder.trim().to_ascii_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    let store = snapshot();
    let mut names: Vec<(usize, String)> = Vec::new();
    for artist in store.artists.values() {
        let (_, folder_path) = placement_folder(artist);
        if folder_path.to_ascii_lowercase() != needle {
            continue;
        }
        names.push((artist.likes as usize, artist.name.clone()));
    }
    names.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    names.into_iter().take(48).map(|(_, n)| n).collect()
}

fn placement_folder(artist: &KnowledgeArtist) -> (String, String) {
    if artist.parent.is_empty() {
        ("À classer".to_string(), "À classer".to_string())
    } else if artist.sub.is_empty() || artist.sub.eq_ignore_ascii_case(&artist.parent) {
        (artist.parent.clone(), artist.parent.clone())
    } else {
        (
            format!("{} · {}", artist.parent, artist.sub),
            format!("{}\\{}", artist.parent, artist.sub),
        )
    }
}

pub fn placement_for(artist: &str) -> Option<Placement> {
    let store = store().lock().ok()?;
    let mut best: Option<(usize, Placement)> = None;
    for cand in artist_candidates(artist) {
        let key = norm(&cand);
        if key.is_empty() {
            continue;
        }
        if let Some(row) = store.artists.get(&key) {
            let p = if !row.parent.is_empty() {
                nested(
                    &row.parent,
                    if row.sub.is_empty() {
                        &row.parent
                    } else {
                        &row.sub
                    },
                )
            } else if let Some(mapped) =
                crate::genre_taxonomy::placement_from_spotify_genres(&row.raw_genres)
            {
                mapped
            } else {
                continue;
            };
            let score = key.len() + if row.parent.is_empty() { 0 } else { 50 };
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, p));
            }
        }
    }
    best.map(|(_, p)| p)
}

pub fn placement_in_text(haystack: &str) -> Option<Placement> {
    let store = store().lock().ok()?;
    let text = format!(" {} ", norm(haystack));
    let mut best: Option<(usize, Placement)> = None;
    for (key, row) in store.artists.iter() {
        if key.len() < 5 || is_generic_token(key) || row.parent.is_empty() {
            continue;
        }
        let needle = format!(" {key} ");
        if text.contains(&needle) {
            let p = nested(&row.parent, if row.sub.is_empty() { &row.parent } else { &row.sub });
            let score = key.len();
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, p));
            }
        }
    }
    best.map(|(_, p)| p)
}

/// Remplit parent/sub pour des artistes déjà dans le dico (ou les crée soft).
/// N’écrase jamais un classement existant.
pub fn learn_placements(
    app: &AppHandle,
    rows: &[(String, String, String)],
) -> Result<u32, String> {
    if rows.is_empty() {
        return Ok(0);
    }
    load(app);
    let mut knowledge = snapshot();
    let mut gained = 0u32;
    for (name, parent, sub) in rows {
        let parent = parent.trim();
        let sub = sub.trim();
        if parent.is_empty() || parent.eq_ignore_ascii_case("Sans genre") {
            continue;
        }
        let key = norm(name);
        if key.is_empty() {
            continue;
        }
        if let Some(artist) = knowledge.artists.get_mut(&key) {
            if !artist.parent.is_empty() {
                continue;
            }
            artist.parent = parent.to_string();
            artist.sub = if sub.is_empty() {
                parent.to_string()
            } else {
                sub.to_string()
            };
            if artist.raw_genres.is_empty() {
                artist.raw_genres.push(format!("{parent}/{sub}"));
            }
            gained += 1;
        } else {
            knowledge.artists.insert(
                key,
                KnowledgeArtist {
                    name: name.trim().to_string(),
                    spotify_id: String::new(),
                    likes: 0,
                    raw_genres: vec![format!("{parent}/{sub}")],
                    parent: parent.to_string(),
                    sub: if sub.is_empty() {
                        parent.to_string()
                    } else {
                        sub.to_string()
                    },
                },
            );
            gained += 1;
        }
    }
    if gained > 0 {
        save(app, &knowledge)?;
    }
    Ok(gained)
}

#[tauri::command]
pub fn knowledge_dump(app: AppHandle) -> Knowledge {
    load(&app);
    snapshot()
}
