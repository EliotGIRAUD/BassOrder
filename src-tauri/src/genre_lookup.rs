use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const CONCURRENCY: usize = 22;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupProgress {
    pub done: usize,
    pub total: usize,
    pub artist: String,
}

#[derive(Serialize, Deserialize, Default)]
struct DiskCache {
    /// artist_key (lowercase) -> genre, or "" for known miss
    artists: HashMap<String, String>,
}

#[derive(Deserialize)]
struct ITunesResponse {
    results: Vec<ITunesResult>,
}

#[derive(Deserialize)]
struct ITunesResult {
    #[serde(rename = "artistName")]
    artist_name: Option<String>,
    #[serde(rename = "trackName")]
    track_name: Option<String>,
    #[serde(rename = "primaryGenreName")]
    primary_genre_name: Option<String>,
}

pub fn normalize_artist(raw: &str) -> String {
    let mut name = raw.trim().to_string();
    for suffix in [
        " - Topic",
        " - topic",
        " Official",
        " Officiel",
        " VEVO",
        " Vevo",
    ] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            name = stripped.trim().to_string();
        }
    }

    let lower = name.to_ascii_lowercase();
    for marker in [" feat. ", " ft. ", " featuring ", " x ", " & "] {
        if let Some(idx) = lower.find(marker) {
            if name.is_char_boundary(idx) {
                name = name[..idx].trim().to_string();
                break;
            }
        }
    }
    name
}

fn load_cache(app: &AppHandle) -> DiskCache {
    DiskCache {
        artists: crate::db::genre_cache_load(app),
    }
}

fn save_cache(app: &AppHandle, cache: &DiskCache) {
    crate::db::genre_cache_save(app, &cache.artists);
}

/// Retourne artist_key → genre (seulement les succès).
/// `retry_misses` : re-interroge les artistes déjà cachés comme échec ("").
pub async fn lookup_artists(
    app: &AppHandle,
    artists: Vec<(String, Option<String>)>,
) -> HashMap<String, String> {
    lookup_artists_ex(app, artists, false).await
}

pub async fn lookup_artists_ex(
    app: &AppHandle,
    artists: Vec<(String, Option<String>)>,
    retry_misses: bool,
) -> HashMap<String, String> {
    let mut disk = load_cache(app);
    let mut result: HashMap<String, String> = HashMap::new();
    let mut todo: Vec<(String, Option<String>)> = Vec::new();

    for (artist, title) in artists {
        let key = artist.to_ascii_lowercase();
        if let Some(cached) = disk.artists.get(&key) {
            if !cached.is_empty() {
                result.insert(key, cached.clone());
                continue;
            }
            // Miss en cache : on ne retente que si demandé (enrichissement).
            if !retry_misses {
                continue;
            }
        }
        if let Some(known) = crate::genre_db::placement_for_artist(Some(&artist)) {
            result.insert(key.clone(), known.label.clone());
            disk.artists.insert(key, known.label);
            continue;
        }
        todo.push((artist, title));
    }

    if todo.is_empty() {
        return result;
    }

    let client = match reqwest::Client::builder()
        .user_agent("BassOrder/0.1 (local music organizer)")
        .timeout(Duration::from_secs(7))
        .pool_max_idle_per_host(CONCURRENCY)
        .build()
    {
        Ok(client) => client,
        Err(_) => return result,
    };

    let total = todo.len();
    let done = Arc::new(AtomicUsize::new(0));
    let _ = app.emit(
        "genre-lookup-progress",
        LookupProgress {
            done: 0,
            total,
            artist: String::new(),
        },
    );

    let pairs: Vec<(String, Option<String>)> = stream::iter(todo)
        .map(|(artist, sample_title)| {
            let client = client.clone();
            let app = app.clone();
            let done = done.clone();
            async move {
                let genre = lookup_one(&client, &artist, sample_title.as_deref()).await;
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = app.emit(
                    "genre-lookup-progress",
                    LookupProgress {
                        done: n,
                        total,
                        artist: artist.clone(),
                    },
                );
                (artist, genre)
            }
        })
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;

    for (artist, genre) in pairs {
        let key = artist.to_ascii_lowercase();
        match genre {
            Some(g) => {
                disk.artists.insert(key.clone(), g.clone());
                result.insert(key, g);
            }
            None => {
                disk.artists.insert(key, String::new());
            }
        }
    }

    save_cache(app, &disk);
    result
}

async fn lookup_one(
    client: &reqwest::Client,
    artist: &str,
    sample_title: Option<&str>,
) -> Option<String> {
    // Titre d'abord : plus précis + utile quand l'artiste YouTube est obscur
    if let Some(title) = sample_title {
        if let Some(genre) = itunes_search(client, artist, "song", Some(title)).await {
            return Some(genre);
        }
    }
    if let Some(genre) = itunes_search(client, artist, "musicArtist", None).await {
        return Some(genre);
    }
    // Spotify API (dev) renvoie souvent genres=[] → Deezer complète bien
    if let Some(genre) = deezer_artist_genre(client, artist).await {
        return Some(genre);
    }
    // Dernier recours : titre seul
    if let Some(title) = sample_title {
        itunes_search_term(client, title, "song").await
    } else {
        None
    }
}

/// Deezer : genre_id d'albums liés à l'artiste (pas de clé API).
async fn deezer_artist_genre(client: &reqwest::Client, artist: &str) -> Option<String> {
    let url = format!(
        "https://api.deezer.com/search/album?q={}&limit=8",
        urlencoding::encode(artist)
    );
    let Ok(response) = client.get(&url).send().await else {
        return None;
    };
    if !response.status().is_success() {
        return None;
    }
    let Ok(parsed) = response.json::<DeezerAlbumSearch>().await else {
        return None;
    };
    let artist_l = artist.to_ascii_lowercase();
    let mut votes: HashMap<i64, usize> = HashMap::new();
    for album in parsed.data.unwrap_or_default() {
        let Some(album_artist) = album.artist.as_ref().and_then(|a| a.name.as_deref()) else {
            continue;
        };
        let a = album_artist.to_ascii_lowercase();
        if !(a.contains(&artist_l) || artist_l.contains(&a) || names_overlap(&artist_l, &a)) {
            continue;
        }
        if let Some(gid) = album.genre_id {
            if gid > 0 {
                *votes.entry(gid).or_default() += 1;
            }
        }
    }
    let best = votes
        .into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(id, _)| id)?;
    deezer_genre_name(best)
}

fn names_overlap(a: &str, b: &str) -> bool {
    let aw: Vec<&str> = a.split_whitespace().filter(|w| w.len() > 2).collect();
    let bw: Vec<&str> = b.split_whitespace().filter(|w| w.len() > 2).collect();
    if aw.is_empty() || bw.is_empty() {
        return false;
    }
    aw.iter().any(|w| bw.contains(w))
}

fn deezer_genre_name(id: i64) -> Option<String> {
    // https://api.deezer.com/genre — ids stables Deezer
    let name = match id {
        132 => "Pop",
        116 => "Hip-Hop/Rap",
        152 => "Rock",
        113 => "Dance",
        106 => "Electro",
        129 => "Jazz",
        85 => "Alternative",
        466 => "Folk",
        98 => "Classical",
        173 | 459 => "Soundtrack",
        464 => "Metal",
        169 => "Soul & Funk",
        165 => "R&B",
        144 => "Reggae",
        153 => "Blues",
        84 => "Country",
        122 => "Songwriter",
        133 => "Indie",
        75 => "Variety",
        457 => "Comedy",
        2 => "French Pop",
        16 => "French Hip Hop",
        97 => "World",
        95 => "Kids",
        _ => return None,
    };
    Some(name.into())
}

#[derive(Deserialize)]
struct DeezerAlbumSearch {
    data: Option<Vec<DeezerAlbum>>,
}

#[derive(Deserialize)]
struct DeezerAlbum {
    #[serde(rename = "genre_id")]
    genre_id: Option<i64>,
    artist: Option<DeezerArtistRef>,
}

#[derive(Deserialize)]
struct DeezerArtistRef {
    name: Option<String>,
}

async fn itunes_search(
    client: &reqwest::Client,
    artist: &str,
    entity: &str,
    title: Option<&str>,
) -> Option<String> {
    let term = match title {
        Some(title) => format!("{artist} {title}"),
        None => artist.to_string(),
    };
    itunes_search_term(client, &term, entity).await.and_then(|genre| {
        // Re-validate against artist when we have results context — handled in pick
        Some(genre)
    })
}

async fn itunes_search_term(
    client: &reqwest::Client,
    term: &str,
    entity: &str,
) -> Option<String> {
    // FR d'abord (catalogue FR), US seulement en secours → 2× moins d'appels
    for country in ["fr", "us"] {
        let url = format!(
            "https://itunes.apple.com/search?term={}&entity={entity}&limit=8&country={country}",
            urlencoding::encode(term)
        );
        let Ok(response) = client.get(&url).send().await else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(parsed) = response.json::<ITunesResponse>().await else {
            continue;
        };
        if let Some(genre) = pick_genre(&parsed.results, term) {
            return Some(genre);
        }
    }
    None
}

fn pick_genre(results: &[ITunesResult], term: &str) -> Option<String> {
    let term_l = term.to_ascii_lowercase();
    let mut scored: Vec<(&ITunesResult, i32)> = results
        .iter()
        .map(|item| {
            let mut score = 0;
            if let Some(artist) = &item.artist_name {
                let a = artist.to_ascii_lowercase();
                if term_l.contains(&a) || a.contains(&term_l.split_whitespace().next().unwrap_or(""))
                {
                    score += 3;
                }
            }
            if let Some(track) = &item.track_name {
                let t = track.to_ascii_lowercase();
                if term_l.contains(&t) || t.split_whitespace().any(|w| w.len() > 3 && term_l.contains(w))
                {
                    score += 2;
                }
            }
            (item, score)
        })
        .collect();
    scored.sort_by(|a, b| b.1.cmp(&a.1));

    scored
        .iter()
        .find_map(|(item, _)| clean_genre(item.primary_genre_name.as_deref()))
}

fn clean_genre(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }
    let lower = value.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "unknown" | "other" | "unclassifiable" | "none"
    ) {
        return None;
    }
    Some(value.to_string())
}

/// MusicBrainz — 1 req/s recommandé. Tags artiste → genre approximatif.
pub async fn lookup_musicbrainz_batch(
    app: &AppHandle,
    artists: Vec<String>,
) -> HashMap<String, String> {
    let mut result = HashMap::new();
    if artists.is_empty() {
        return result;
    }
    let client = reqwest::Client::builder()
        .user_agent("BassOrder/0.1 (local music triage; contact: local-app)")
        .timeout(Duration::from_secs(12))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let total = artists.len();
    for (i, artist) in artists.into_iter().enumerate() {
        let key = artist.to_ascii_lowercase();
        let label = artist.clone();
        if let Some(tag) = musicbrainz_top_tag(&client, &artist).await {
            result.insert(key, tag);
        }
        let done = i + 1;
        if done == 1 || done == total || done % 3 == 0 {
            let _ = app.emit(
                "genre-lookup-progress",
                LookupProgress {
                    done,
                    total,
                    artist: label,
                },
            );
            let _ = app.emit(
                "spotify-sync-progress",
                serde_json::json!({
                    "phase": "musicbrainz",
                    "done": done,
                    "total": total,
                    "label": format!("MusicBrainz — {done}/{total}")
                }),
            );
        }
        // Politesse MusicBrainz
        tokio::time::sleep(Duration::from_millis(1100)).await;
    }
    result
}

#[derive(Deserialize)]
struct MbSearch {
    artists: Option<Vec<MbArtist>>,
}

#[derive(Deserialize)]
struct MbArtist {
    name: Option<String>,
    tags: Option<Vec<MbTag>>,
    score: Option<i32>,
}

#[derive(Deserialize)]
struct MbTag {
    name: Option<String>,
    count: Option<i32>,
}

async fn musicbrainz_top_tag(client: &reqwest::Client, artist: &str) -> Option<String> {
    let query = format!("artist:\"{}\"", artist.replace('"', ""));
    let url = format!(
        "https://musicbrainz.org/ws/2/artist/?query={}&fmt=json&limit=5",
        urlencoding::encode(&query)
    );
    let Ok(response) = client.get(&url).send().await else {
        return None;
    };
    if !response.status().is_success() {
        return None;
    }
    let Ok(parsed) = response.json::<MbSearch>().await else {
        return None;
    };
    let artist_l = artist.to_ascii_lowercase();
    let mut best: Option<(i32, String)> = None;
    for a in parsed.artists.unwrap_or_default() {
        let name = a.name.unwrap_or_default();
        let name_l = name.to_ascii_lowercase();
        let name_score = if name_l == artist_l {
            100
        } else if name_l.contains(&artist_l) || artist_l.contains(&name_l) {
            60
        } else {
            continue;
        };
        let api_score = a.score.unwrap_or(0);
        let mut tags = a.tags.unwrap_or_default();
        tags.sort_by(|x, y| y.count.unwrap_or(0).cmp(&x.count.unwrap_or(0)));
        let Some(tag) = tags
            .into_iter()
            .find_map(|t| clean_genre(t.name.as_deref()))
        else {
            continue;
        };
        let score = name_score + api_score / 2;
        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
            best = Some((score, tag));
        }
    }
    best.map(|(_, t)| t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_youtube_suffixes() {
        assert_eq!(
            normalize_artist("Vladimir Cauchemar - Topic"),
            "Vladimir Cauchemar"
        );
        assert_eq!(normalize_artist("Drake feat. 21 Savage"), "Drake");
    }
}
