use crate::genre_lookup::{lookup_artists_ex, normalize_artist};
use crate::genre_db::artist_candidates;
use crate::genre_taxonomy::{
    is_safe_relative, resolve_placement, sanitize_folder_path, sanitize_segment,
};
use crate::security::{
    self, cover_data_allowed, is_within, validate_audio_file, MAX_SCAN_FILES, MAX_WALK_DEPTH,
};
use lofty::config::ParseOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

const UNKNOWN_GENRE: &str = "Sans genre";
const UNREADABLE_GENRE: &str = "Illisible";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub path: String,
    pub file_name: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<String>,
    pub genre: String,
    pub folder: String,
    pub duration_secs: Option<u32>,
    pub bpm: Option<u32>,
    #[serde(default)]
    pub musical_key: Option<String>,
    pub bitrate_kbps: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreGroup {
    pub genre: String,
    pub folder: String,
    pub tracks: Vec<Track>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root: String,
    pub file_count: usize,
    pub unread_count: usize,
    pub unknown_count: usize,
    pub looked_up_count: usize,
    pub sorted_percent: u32,
    pub groups: Vec<GenreGroup>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeTrack {
    pub path: String,
    pub folder: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OrganizeMode {
    Copy,
    Move,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RenameMode {
    /// Conserve le nom de fichier d’origine.
    Keep,
    /// `Titre.ext`
    Title,
    /// `Artiste - Titre.ext` (recommandé)
    #[default]
    ArtistTitle,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeRequest {
    /// Dossier source (bibliothèque analysée) — les fichiers doivent en provenir.
    pub root: String,
    /// Dossier où créer l’arborescence par genre.
    pub destination: String,
    pub mode: OrganizeMode,
    #[serde(default)]
    pub rename_mode: RenameMode,
    pub tracks: Vec<OrganizeTrack>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeResult {
    pub copied: usize,
    pub moved: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub destination: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub label: String,
    pub file_name: Option<String>,
}

#[tauri::command]
pub fn ensure_library_access(app: AppHandle, root: String) -> Result<(), String> {
    security::ensure_library_access(&app, &root).map(|_| ())
}

#[tauri::command]
pub async fn scan_local_library(app: AppHandle, root: String) -> Result<ScanResult, String> {
    let _ = crate::knowledge::reclassify_and_save(&app);
    let root_canon = security::ensure_library_access(&app, &root)?;
    let app_progress = app.clone();
    let root_for_scan = root_canon.to_string_lossy().into_owned();
    tauri::async_runtime::spawn_blocking(move || {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            scan_library_sync(Some(&app_progress), root_for_scan)
        }))
        .unwrap_or_else(|_| {
            Err(
                "Crash pendant l'analyse (souvent un titre avec accents). Relance Relire — le bug a été corrigé."
                    .into(),
            )
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn enrich_local_genres(
    app: AppHandle,
    root: String,
    tracks: Vec<Track>,
) -> Result<ScanResult, String> {
    let _ = crate::knowledge::reclassify_and_save(&app);
    let root_canon = security::ensure_library_access(&app, &root)?;
    let mut kept = 0usize;
    let mut skipped = 0usize;
    let mut updated: Vec<Track> = Vec::with_capacity(tracks.len());

    for track in tracks {
        let path = Path::new(&track.path);
        let ok = is_within(&root_canon, path) && validate_audio_file(path).is_ok();
        if ok {
            updated.push(apply_placement(track, None));
            kept += 1;
        } else {
            // Ne jamais faire disparaître un titre du plan : on le conserve tel quel.
            updated.push(track);
            skipped += 1;
        }
    }
    if kept == 0 {
        return Err("Aucun titre audio valide à enrichir (fichiers refusés ou hors dossier).".into());
    }
    let _ = skipped;

    // Propagation artiste : si 1+ titres d'un artiste sont classés, étendre aux autres
    let propagated = propagate_by_artist(&mut updated);

    let mut sample_title: HashMap<String, String> = HashMap::new();
    let mut artist_keys: Vec<String> = Vec::new();

    for track in &updated {
        if track.genre != UNKNOWN_GENRE {
            continue;
        }
        let Some(raw) = track.artist.as_deref() else {
            continue;
        };
        let title = track
            .title
            .as_ref()
            .map(|t| clean_search_title(t))
            .filter(|t| !t.is_empty());
        // « DRYMK,AMØUR » → tenter chaque nom (sinon iTunes rate le combo).
        for cand in artist_candidates(raw) {
            let artist = normalize_artist(&cand);
            if artist.is_empty() {
                continue;
            }
            let key = artist.to_ascii_lowercase();
            if let Some(t) = title.as_ref() {
                sample_title.entry(key.clone()).or_insert_with(|| t.clone());
            }
            if !artist_keys
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&artist))
            {
                artist_keys.push(artist);
            }
        }
    }

    let queries: Vec<(String, Option<String>)> = artist_keys
        .into_iter()
        .map(|artist| {
            let title = sample_title
                .get(&artist.to_ascii_lowercase())
                .cloned();
            (artist, title)
        })
        .collect();

    // retry_misses : un 1er « Deviner » a souvent mis "" en cache pour des artistes
    // présents dans le dico mais encore « À classer » (ex. DRYMK).
    let cache = lookup_artists_ex(&app, queries, true).await;
    let mut looked_up_count = propagated;
    let mut learned: Vec<(String, String, String)> = Vec::new();

    for track in &mut updated {
        if track.genre != UNKNOWN_GENRE {
            continue;
        }
        let Some(raw) = track.artist.as_deref() else {
            continue;
        };
        let mut hit: Option<String> = None;
        let mut hit_name: Option<String> = None;
        for cand in artist_candidates(raw) {
            let name = normalize_artist(&cand);
            let key = name.to_ascii_lowercase();
            if let Some(genre) = cache.get(&key) {
                if !genre.is_empty() {
                    hit = Some(genre.clone());
                    hit_name = Some(name);
                    break;
                }
            }
        }
        let Some(genre) = hit else {
            continue;
        };
        let before = track.genre.clone();
        *track = apply_placement(track.clone(), Some(genre.as_str()));
        if track.genre != before && track.genre != UNKNOWN_GENRE {
            looked_up_count += 1;
            if let Some(name) = hit_name {
                let p = resolve_placement(Some(genre.as_str()), None, "track.mp3", Some(&name));
                if let (Some(parent), Some(sub)) = (
                    p.segments.first().cloned(),
                    p.segments.last().cloned(),
                ) {
                    if parent != "Sans genre" {
                        learned.push((name, parent, sub));
                    }
                }
            }
        }
    }

    // 2e passe propagation après iTunes
    looked_up_count += propagate_by_artist(&mut updated);

    // Remonte les genres trouvés dans le dictionnaire (artistes « connus mais vides »).
    if !learned.is_empty() {
        let _ = crate::knowledge::learn_placements(&app, &learned);
    }

    Ok(group_tracks(
        root_canon.to_string_lossy().into_owned(),
        updated,
        looked_up_count,
    ))
}

#[tauri::command]
pub async fn organize_local_library(
    app: AppHandle,
    root: String,
    destination: String,
    mode: OrganizeMode,
    rename_mode: Option<RenameMode>,
    tracks: Vec<OrganizeTrack>,
) -> Result<OrganizeResult, String> {
    {
        let state = app.state::<crate::db::DbState>();
        let uid = crate::session_guard::read_session_user(&state)?
            .ok_or_else(|| "Aucune session active.".to_string())?;
        crate::session_guard::require_unlocked(&app, &uid)?;
    }
    let root_canon = security::ensure_library_access(&app, &root)?;
    let dest_canon = prepare_organize_destination(&app, &destination)?;
    let root_str = root_canon.to_string_lossy().into_owned();
    let dest_str = dest_canon.to_string_lossy().into_owned();
    let rename_mode = rename_mode.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        organize_library_sync(OrganizeRequest {
            root: root_str,
            destination: dest_str,
            mode,
            rename_mode,
            tracks,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Crée le dossier de destination s’il n’existe pas encore, puis l’autorise.
fn prepare_organize_destination(app: &AppHandle, destination: &str) -> Result<PathBuf, String> {
    let dest = PathBuf::from(destination);
    if security::is_sensitive_path(&dest) {
        return Err("Ce dossier système ou sensible ne peut pas être utiliséé.".into());
    }
    if !dest.exists() {
        let parent = dest
            .parent()
            .ok_or_else(|| "Chemin de destination invalide.".to_string())?;
        // Autoriser le parent, créer le dossier, puis autoriser la destination.
        security::ensure_library_access(app, &parent.to_string_lossy())?;
        fs::create_dir_all(&dest).map_err(|e| format!("Impossible de créer le dossier : {e}"))?;
    }
    security::ensure_library_access(app, destination)
}

#[tauri::command]
pub fn load_track_cover(path: String) -> Option<String> {
    use base64::Engine;
    use lofty::picture::MimeType;

    let file_path = Path::new(&path);
    if !security::is_under_allowed_root(file_path) {
        return None;
    }
    if validate_audio_file(file_path).is_err() {
        return None;
    }

    let options = ParseOptions::new()
        .read_cover_art(true)
        .read_properties(false);

    let tagged = Probe::open(&path).ok()?
        .guess_file_type()
        .ok()?
        .options(options)
        .read()
        .ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let pic = tag.pictures().first()?;
    if !cover_data_allowed(pic.data()) {
        return None;
    }
    let data = pic.data();
    let mime = match pic.mime_type() {
        Some(MimeType::Jpeg) => "image/jpeg",
        Some(MimeType::Png) => "image/png",
        Some(MimeType::Gif) => "image/gif",
        Some(MimeType::Bmp) => "image/bmp",
        Some(MimeType::Tiff) => "image/tiff",
        _ => {
            if data.starts_with(&[0xff, 0xd8, 0xff]) {
                "image/jpeg"
            } else if data.starts_with(b"\x89PNG") {
                "image/png"
            } else if data.starts_with(b"GIF8") {
                "image/gif"
            } else if data.starts_with(b"BM") {
                "image/bmp"
            } else if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
                "image/webp"
            } else {
                return None;
            }
        }
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(data);
    Some(format!("data:{mime};base64,{b64}"))
}

fn emit_scan_progress(
    app: Option<&AppHandle>,
    phase: &str,
    done: usize,
    total: usize,
    label: &str,
    file_name: Option<String>,
) {
    let Some(app) = app else {
        return;
    };
    let _ = app.emit(
        "local-scan-progress",
        ScanProgress {
            phase: phase.into(),
            done,
            total,
            label: label.into(),
            file_name,
        },
    );
}

fn scan_library_sync(app: Option<&AppHandle>, root: String) -> Result<ScanResult, String> {
    let root_path = security::canonicalize_dir(Path::new(&root))?;
    let root = root_path.to_string_lossy().into_owned();

    emit_scan_progress(
        app,
        "list",
        0,
        0,
        "Parcours du dossier — on repère les titres audio…",
        None,
    );

    let mut audio_paths: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(&root_path)
        .follow_links(false)
        .max_depth(MAX_WALK_DEPTH)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.into_path();
        // Sidecars macOS (`._*.mp3`) : skip avant d’ouvrir le fichier.
        if security::is_junk_sidecar_name(&path) {
            continue;
        }
        if validate_audio_file(&path).is_err() {
            continue;
        }
        audio_paths.push(path);
        if audio_paths.len() >= MAX_SCAN_FILES {
            break;
        }
    }

    let total = audio_paths.len();
    let list_label = if total == 0 {
        "Aucun titre audio valide trouvé (extensions + contenu vérifiés)…".to_string()
    } else {
        format!(
            "{total} titre{} valide{} — lecture des tags…",
            if total > 1 { "s" } else { "" },
            if total > 1 { "s" } else { "" }
        )
    };
    emit_scan_progress(app, "list", 0, total, &list_label, None);

    let mut tracks = Vec::with_capacity(total);

    for (index, path) in audio_paths.iter().enumerate() {
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "fichier".into());

        let done = index + 1;
        if done == 1 || done == total || done % 4 == 0 {
            emit_scan_progress(
                app,
                "tags",
                done,
                total,
                &format!("Lecture des tags — {done} / {total}"),
                Some(file_name.clone()),
            );
        }

        let meta = read_track_meta(path, &file_name, &root_path);
        tracks.push(meta);
    }

    emit_scan_progress(
        app,
        "classify",
        total,
        total,
        "Classement local des genres (mots-clés + Spotify)…",
        None,
    );

    // Auto local : keywords + propagation (sans réseau)
    let mut tracks: Vec<Track> = tracks
        .into_iter()
        .map(|t| apply_placement(t, None))
        .collect();
    let _ = propagate_by_artist(&mut tracks);

    emit_scan_progress(
        app,
        "group",
        total,
        total,
        "Construction du plan par dossiers / genres…",
        None,
    );

    Ok(group_tracks(root, tracks, 0))
}

fn group_tracks(root: String, tracks: Vec<Track>, looked_up_count: usize) -> ScanResult {
    let file_count = tracks.len();
    let unread_count = tracks
        .iter()
        .filter(|track| track.genre == UNREADABLE_GENRE)
        .count();
    let unknown_count = tracks
        .iter()
        .filter(|track| track.genre == UNKNOWN_GENRE)
        .count();
    let sorted = file_count.saturating_sub(unknown_count).saturating_sub(unread_count);
    let sorted_percent = if file_count == 0 {
        0
    } else {
        ((sorted * 100) / file_count) as u32
    };

    let mut groups: BTreeMap<String, GenreGroup> = BTreeMap::new();
    for track in tracks {
        let key = track.folder.to_ascii_lowercase();
        let group = groups.entry(key).or_insert_with(|| GenreGroup {
            genre: track.genre.clone(),
            folder: track.folder.clone(),
            tracks: Vec::new(),
        });
        group.tracks.push(Track {
            genre: group.genre.clone(),
            folder: group.folder.clone(),
            ..track
        });
    }

    let mut groups: Vec<GenreGroup> = groups.into_values().collect();
    groups.sort_by(|a, b| b.tracks.len().cmp(&a.tracks.len()).then(a.genre.cmp(&b.genre)));

    ScanResult {
        root,
        file_count,
        unread_count,
        unknown_count,
        looked_up_count,
        sorted_percent,
        groups,
    }
}

fn organize_library_sync(request: OrganizeRequest) -> Result<OrganizeResult, String> {
    let root_canon = security::canonicalize_dir(Path::new(&request.root))?;
    let dest_canon = security::canonicalize_dir(Path::new(&request.destination))?;
    let destination_display = dest_canon.to_string_lossy().into_owned();

    let mut copied = 0;
    let mut moved = 0;
    let mut skipped = 0;
    let mut errors = Vec::new();

    for track in request.tracks {
        if errors.len() >= 80 {
            errors.push("Trop d'erreurs, organisation interrompue.".into());
            break;
        }

        let source = PathBuf::from(&track.path);
        if !is_within(&root_canon, &source) {
            if source.is_file() {
                errors.push(format!(
                    "Fichier hors dossier source : {}",
                    track.file_name_or_path()
                ));
            } else {
                errors.push(format!(
                    "Fichier introuvable (déjà déplacé ?) : {}",
                    track.file_name_or_path()
                ));
            }
            continue;
        }
        if let Err(reason) = validate_audio_file(&source) {
            errors.push(format!(
                "{} : refusé ({})",
                track.file_name_or_path(),
                reason.as_str()
            ));
            continue;
        }
        if !source.is_file() {
            errors.push(format!("Fichier introuvable : {}", track.file_name_or_path()));
            continue;
        }

        let relative = sanitize_folder_path(&track.folder);
        if !is_safe_relative(&relative) {
            errors.push(format!("Chemin dossier invalide : {}", track.folder));
            continue;
        }
        let dest_dir = dest_canon.join(&relative);
        if security::is_sensitive_path(&dest_dir) {
            errors.push(format!("Destination sensible refusée : {}", track.folder));
            continue;
        }
        let folder_display = relative.to_string_lossy().into_owned();
        if let Err(e) = fs::create_dir_all(&dest_dir) {
            errors.push(format!("Impossible de créer « {folder_display} » : {e}"));
            continue;
        }

        let file_name = match resolve_output_file_name(&source, &track, request.rename_mode) {
            Some(name) => name,
            None => {
                errors.push(format!("Nom de fichier invalide : {}", track.path));
                continue;
            }
        };
        let intended = dest_dir.join(&file_name);
        if paths_equal(&source, &intended) {
            skipped += 1;
            continue;
        }

        let dest = unique_dest(&dest_dir, Path::new(&file_name));
        match request.mode {
            OrganizeMode::Copy => match fs::copy(&source, &dest) {
                Ok(_) => copied += 1,
                Err(e) => errors.push(format!("{} : {e}", display_name(&source))),
            },
            OrganizeMode::Move => match move_file(&source, &dest) {
                Ok(_) => moved += 1,
                Err(e) => errors.push(format!("{} : {e}", display_name(&source))),
            },
        }
    }

    Ok(OrganizeResult {
        copied,
        moved,
        skipped,
        errors,
        destination: destination_display,
    })
}

impl OrganizeTrack {
    fn file_name_or_path(&self) -> String {
        Path::new(&self.path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.path.clone())
    }
}

enum TagRead {
    Unreadable,
    Ok {
        title: Option<String>,
        artist: Option<String>,
        album: Option<String>,
        year: Option<String>,
        genre: Option<String>,
        bpm: Option<u32>,
        musical_key: Option<String>,
        duration_secs: Option<u32>,
        bitrate_kbps: Option<u32>,
    },
}

fn read_track_meta(path: &Path, file_name: &str, root: &Path) -> Track {
    let from_name = parse_meta_from_filename(file_name);

    match read_tags(path) {
        TagRead::Unreadable => {
            // Lofty a échoué : on classifie quand même via le nom de fichier
            // (préfixes `_`, `._` déjà filtrés côté scan pour les vrais sidecars).
            track_from_partial(path, file_name, root, from_name.title, from_name.artist, None)
        }
        TagRead::Ok {
            title,
            artist,
            album,
            year,
            genre,
            bpm,
            musical_key,
            duration_secs,
            bitrate_kbps,
        } => {
            let title = nonempty_opt(title).or(from_name.title);
            let artist = nonempty_opt(artist).or(from_name.artist);
            // On ignore volontairement les sous-dossiers existants (tri manuel
            // souvent imprécis) : seul le tag genre + titre/artiste comptent.
            let base = genre.as_deref().and_then(primary_genre);
            let placement = resolve_placement(
                base.as_deref(),
                title.as_deref(),
                file_name,
                artist.as_deref(),
            );
            let folder = placement.folder();
            let bpm = bpm.or_else(|| {
                parse_bpm_from_text(&format!(
                    "{} {}",
                    title.as_deref().unwrap_or(""),
                    file_name
                ))
            });
            Track {
                path: path.to_string_lossy().into_owned(),
                file_name: file_name.to_string(),
                title,
                artist,
                album,
                year,
                genre: placement.label,
                folder,
                duration_secs,
                bpm,
                musical_key,
                bitrate_kbps,
            }
        }
    }
}

fn nonempty_opt(value: Option<String>) -> Option<String> {
    value.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

fn track_from_partial(
    path: &Path,
    file_name: &str,
    _root: &Path,
    title: Option<String>,
    artist: Option<String>,
    duration_secs: Option<u32>,
) -> Track {
    let placement = resolve_placement(
        None,
        title.as_deref(),
        file_name,
        artist.as_deref(),
    );
    let folder = placement.folder();
    Track {
        path: path.to_string_lossy().into_owned(),
        file_name: file_name.to_string(),
        title,
        artist,
        album: None,
        year: None,
        genre: placement.label,
        folder,
        duration_secs,
        bpm: parse_bpm_from_text(file_name),
        musical_key: None,
        bitrate_kbps: None,
    }
}

struct NameMeta {
    title: Option<String>,
    artist: Option<String>,
}

/// Déduit titre / artiste depuis le nom de fichier, en gérant les préfixes junk.
fn parse_meta_from_filename(file_name: &str) -> NameMeta {
    let stem = Path::new(file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.to_string());

    let cleaned = strip_leading_track_number(&strip_junk_filename_prefix(&stem));
    let cleaned = cleaned
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    if cleaned.is_empty() {
        return NameMeta {
            title: None,
            artist: None,
        };
    }

    if let Some((artist, title)) = split_artist_dash_title(&cleaned) {
        return NameMeta {
            title: Some(title),
            artist: Some(artist),
        };
    }
    if let Some((title, artist)) = split_title_by_artist(&cleaned) {
        return NameMeta {
            title: Some(title),
            artist: Some(artist),
        };
    }

    NameMeta {
        title: Some(cleaned),
        artist: None,
    }
}

/// Enlève `._`, points / underscores / tirets / espaces en tête (répétés).
fn strip_junk_filename_prefix(input: &str) -> String {
    let mut s = input.trim();
    // Variantes AppleDouble / copies foireuses encore présentes dans le stem.
    while let Some(rest) = s.strip_prefix("._") {
        s = rest.trim_start();
    }
    while let Some(rest) = s.strip_prefix("./") {
        s = rest.trim_start();
    }

    let chars: Vec<char> = s.chars().collect();
    let mut i = 0usize;
    while i < chars.len()
        && matches!(
            chars[i],
            '.' | '_' | '-' | '–' | '—' | ' ' | '\t' | '\u{00a0}'
        )
    {
        i += 1;
    }
    if i == 0 {
        return s.to_string();
    }
    if i >= chars.len() {
        // Tout était du junk — garde l’original trimé plutôt que vide.
        return s.to_string();
    }
    chars[i..].iter().collect::<String>()
}

/// `Artiste - Titre` (premier séparateur ` - ` / ` – ` / ` — `).
fn split_artist_dash_title(input: &str) -> Option<(String, String)> {
    for sep in [" - ", " – ", " — ", " -- "] {
        if let Some((left, right)) = input.split_once(sep) {
            let artist = left.trim();
            let title = right.trim();
            if artist.is_empty() || title.is_empty() {
                continue;
            }
            // Évite de prendre un préfixe genre `[Hard] - Title` comme artiste.
            if artist.starts_with('[') && artist.ends_with(']') {
                continue;
            }
            if artist.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            return Some((artist.to_string(), title.to_string()));
        }
    }
    None
}

/// `Titre by Artiste` / `Titre par Artiste`.
fn split_title_by_artist(input: &str) -> Option<(String, String)> {
    let lower = input.to_ascii_lowercase();
    for marker in [" by ", " par ", " ft. ", " ft ", " feat. ", " feat "] {
        if let Some(idx) = lower.rfind(marker) {
            let title = input[..idx].trim();
            let artist = input[idx + marker.len()..].trim();
            if title.is_empty() || artist.is_empty() {
                continue;
            }
            // ft/feat en milieu de titre d’artiste collab → on garde le split.
            return Some((title.to_string(), artist.to_string()));
        }
    }
    None
}

fn read_tags(path: &Path) -> TagRead {
    let options = ParseOptions::new()
        .read_properties(true)
        .read_cover_art(false);

    let tagged = match Probe::open(path) {
        Ok(probe) => match probe.guess_file_type() {
            Ok(probe) => match probe.options(options).read() {
                Ok(file) => file,
                Err(_) => return TagRead::Unreadable,
            },
            Err(_) => return TagRead::Unreadable,
        },
        Err(_) => return TagRead::Unreadable,
    };

    let props = tagged.properties();
    let duration_secs = {
        let secs = props.duration().as_secs();
        if secs > 0 {
            Some(secs as u32)
        } else {
            None
        }
    };
    let bitrate_kbps = props.audio_bitrate().or_else(|| props.overall_bitrate());

    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return TagRead::Ok {
            title: None,
            artist: None,
            album: None,
            year: None,
            genre: None,
            bpm: None,
            musical_key: None,
            duration_secs,
            bitrate_kbps,
        };
    };

    let year = tag
        .get_string(&ItemKey::RecordingDate)
        .map(|s| s.chars().take(4).collect::<String>())
        .or_else(|| {
            tag.get_string(&ItemKey::Year)
                .map(|s| s.chars().take(4).collect())
        });

    let bpm = tag
        .get_string(&ItemKey::Bpm)
        .and_then(|s| s.split_whitespace().next()?.parse().ok());

    let musical_key = tag
        .get_string(&ItemKey::InitialKey)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    TagRead::Ok {
        title: tag.title().map(|s| s.to_string()),
        artist: tag
            .artist()
            .map(|s| s.to_string())
            .or_else(|| tag.get_string(&ItemKey::AlbumArtist).map(str::to_string)),
        album: tag.album().map(|s| s.to_string()),
        year,
        genre: tag.genre().map(|s| s.to_string()),
        bpm,
        musical_key,
        duration_secs,
        bitrate_kbps,
    }
}

fn parse_bpm_from_text(text: &str) -> Option<u32> {
    let lower = text.to_ascii_lowercase();
    // Cherche "bpm" uniquement sur des frontières UTF-8 valides
    let mut search_from = 0usize;
    while let Some(rel) = lower[search_from..].find("bpm") {
        let i = search_from + rel;
        // chiffres avant
        let before = &lower[..i];
        let digits_before: String = before
            .chars()
            .rev()
            .skip_while(|c| c.is_whitespace() || *c == ':' || *c == '=')
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        if let Ok(n) = digits_before.parse::<u32>() {
            if (60..=220).contains(&n) {
                return Some(n);
            }
        }
        // chiffres après
        let after = &lower[i + 3..];
        let digits_after: String = after
            .chars()
            .skip_while(|c| c.is_whitespace() || *c == ':' || *c == '=')
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(n) = digits_after.parse::<u32>() {
            if (60..=220).contains(&n) {
                return Some(n);
            }
        }
        search_from = i + 3;
        if search_from >= lower.len() {
            break;
        }
        // avancer au prochain char boundary si besoin
        while search_from < lower.len() && !lower.is_char_boundary(search_from) {
            search_from += 1;
        }
    }
    None
}

fn apply_placement(mut track: Track, online_genre: Option<&str>) -> Track {
    if track.genre == UNREADABLE_GENRE {
        return track;
    }

    let base = online_genre
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let g = track.genre.as_str();
            if g == UNKNOWN_GENRE {
                None
            } else if g.contains('·') {
                g.split('·').next().map(str::trim).filter(|s| !s.is_empty())
            } else {
                Some(g)
            }
        });

    let placement = resolve_placement(
        base,
        track.title.as_deref(),
        &track.file_name,
        track.artist.as_deref(),
    );
    if placement.label != "Sans genre" || track.genre == UNKNOWN_GENRE {
        let folder = placement.folder();
        track.genre = placement.label;
        track.folder = folder;
    }
    track
}

/// Si un artiste a déjà des titres classés, applique le dossier majoritaire aux inconnus.
fn propagate_by_artist(tracks: &mut [Track]) -> usize {
    let mut votes: HashMap<String, HashMap<String, (String, usize)>> = HashMap::new();

    for track in tracks.iter() {
        if track.genre == UNKNOWN_GENRE || track.genre == UNREADABLE_GENRE {
            continue;
        }
        let Some(artist) = track.artist.as_deref().map(normalize_artist) else {
            continue;
        };
        if artist.is_empty() {
            continue;
        }
        let key = artist.to_ascii_lowercase();
        let entry = votes.entry(key).or_default();
        let slot = entry
            .entry(track.folder.to_ascii_lowercase())
            .or_insert_with(|| (track.folder.clone(), 0));
        slot.0 = track.folder.clone();
        // garder aussi le label genre via un hack: store "folder\0genre" — better separate
        slot.1 += 1;
    }

    // Also keep genre label map
    let mut genre_for_folder: HashMap<String, String> = HashMap::new();
    for track in tracks.iter() {
        if track.genre == UNKNOWN_GENRE || track.genre == UNREADABLE_GENRE {
            continue;
        }
        genre_for_folder
            .entry(track.folder.to_ascii_lowercase())
            .or_insert_with(|| track.genre.clone());
    }

    let mut changed = 0usize;
    for track in tracks.iter_mut() {
        if track.genre != UNKNOWN_GENRE {
            continue;
        }
        let Some(artist) = track.artist.as_deref().map(normalize_artist) else {
            continue;
        };
        let key = artist.to_ascii_lowercase();
        let Some(map) = votes.get(&key) else {
            continue;
        };
        let Some((_, (folder, count))) = map.iter().max_by_key(|(_, (_, c))| *c) else {
            continue;
        };
        if *count < 1 {
            continue;
        }
        track.folder = folder.clone();
        track.genre = genre_for_folder
            .get(&folder.to_ascii_lowercase())
            .cloned()
            .unwrap_or_else(|| folder.clone());
        changed += 1;
    }
    changed
}

fn clean_search_title(title: &str) -> String {
    let mut t = title.to_string();
    for junk in [
        "(official video)",
        "(official audio)",
        "(lyrics)",
        "(lyric video)",
        "(visualizer)",
        "(hd)",
        "(hq)",
        "[official video]",
        "[official audio]",
    ] {
        loop {
            let lower = t.to_ascii_lowercase();
            let Some(idx) = lower.find(junk) else {
                break;
            };
            let end = idx + junk.len();
            if !t.is_char_boundary(idx) || !t.is_char_boundary(end) {
                break;
            }
            t = format!("{}{}", &t[..idx], &t[end..]);
        }
    }
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Enlève les préfixes type `01`, `01.`, `01 -`, `(01)`, `[16]`.
fn strip_leading_track_number(input: &str) -> String {
    let s = input.trim();
    if s.is_empty() {
        return String::new();
    }

    let chars: Vec<char> = s.chars().collect();
    let mut i = 0usize;

    let open = chars.first().copied();
    let has_bracket = matches!(open, Some('(') | Some('[') | Some('{'));
    if has_bracket {
        i = 1;
    }

    let digit_start = i;
    while i < chars.len() && chars[i].is_ascii_digit() {
        i += 1;
    }
    let digit_count = i - digit_start;
    if digit_count == 0 || digit_count > 3 {
        return s.to_string();
    }

    if has_bracket {
        if i >= chars.len() || !matches!(chars[i], ')' | ']' | '}') {
            return s.to_string();
        }
        i += 1;
    }

    let mut stripped_sep = false;
    while i < chars.len()
        && matches!(
            chars[i],
            '.' | '-' | '_' | '–' | '—' | ' ' | '\t' | ':'
        )
    {
        stripped_sep = true;
        i += 1;
    }

    // Exige un séparateur (ou une parenthèse fermée) pour éviter de casser des titres
    // qui commencent vraiment par un chiffre (« 1999 », « 2pac »…).
    if !has_bracket && !stripped_sep {
        return s.to_string();
    }

    if i >= chars.len() {
        return s.to_string();
    }

    chars[i..].iter().collect::<String>().trim().to_string()
}

fn stem_from_source(source: &Path) -> String {
    source
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Sans titre".into())
}

fn clean_display_title(title: Option<&str>, source: &Path) -> String {
    let raw = title
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| stem_from_source(source));
    let cleaned = strip_leading_track_number(&clean_search_title(&strip_junk_filename_prefix(
        &raw,
    )));
    let cleaned = cleaned
        .trim_matches(|c: char| c == '.' || c.is_whitespace())
        .to_string();
    if cleaned.is_empty() {
        strip_leading_track_number(&strip_junk_filename_prefix(&stem_from_source(source)))
            .trim_matches(|c: char| c == '.' || c.is_whitespace())
            .to_string()
    } else {
        cleaned
    }
}

fn clean_display_artist(artist: Option<&str>) -> String {
    artist
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_default()
}

fn resolve_output_file_name(
    source: &Path,
    track: &OrganizeTrack,
    mode: RenameMode,
) -> Option<std::ffi::OsString> {
    let original = source.file_name()?.to_os_string();
    if mode == RenameMode::Keep {
        return Some(original);
    }

    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "mp3".into());

    let title = clean_display_title(track.title.as_deref(), source);
    let stem = match mode {
        RenameMode::Keep => unreachable!(),
        RenameMode::Title => title,
        RenameMode::ArtistTitle => {
            let artist = clean_display_artist(track.artist.as_deref());
            if artist.is_empty() {
                title
            } else {
                format!("{artist} - {title}")
            }
        }
    };

    let safe = sanitize_segment(&stem);
    if safe.is_empty() {
        return Some(original);
    }
    Some(format!("{safe}.{ext}").into())
}

fn primary_genre(raw: &str) -> Option<String> {
    raw.split(['/', ';', ',', '|'])
        .map(str::trim)
        .find(|part| !part.is_empty())
        .map(ToString::to_string)
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (dunce::canonicalize(a), dunce::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn unique_dest(dir: &Path, file_name: &Path) -> PathBuf {
    let dest = dir.join(file_name);
    if !dest.exists() {
        return dest;
    }

    let stem = file_name
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "fichier".into());
    let ext = file_name.extension().map(|e| e.to_string_lossy().into_owned());

    for i in 2..10_000 {
        let name = match &ext {
            Some(ext) => format!("{stem} ({i}).{ext}"),
            None => format!("{stem} ({i})"),
        };
        let dest = dir.join(name);
        if !dest.exists() {
            return dest;
        }
    }

    dir.join(file_name)
}

fn move_file(source: &Path, dest: &Path) -> std::io::Result<()> {
    match fs::rename(source, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source, dest)?;
            fs::remove_file(source)?;
            Ok(())
        }
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::genre_taxonomy::sanitize_segment;

    #[test]
    fn primary_genre_takes_first() {
        assert_eq!(primary_genre("Rock / Alternative"), Some("Rock".into()));
        assert_eq!(primary_genre("  ;  Jazz"), Some("Jazz".into()));
        assert_eq!(primary_genre("   "), None);
    }

    #[test]
    fn sanitize_strips_windows_chars() {
        assert_eq!(sanitize_segment("Rock: \"Best\"?"), "Rock Best");
        assert_eq!(sanitize_segment("CON"), "_CON");
        assert_eq!(sanitize_segment("..."), "");
    }

    #[test]
    fn strip_track_numbers() {
        assert_eq!(strip_leading_track_number("01 Title"), "Title");
        assert_eq!(strip_leading_track_number("16 .RAW Spleen"), "RAW Spleen");
        assert_eq!(strip_leading_track_number("01 - Shadow"), "Shadow");
        assert_eq!(strip_leading_track_number("01. Shadow"), "Shadow");
        assert_eq!(strip_leading_track_number("(01) Shadow"), "Shadow");
        assert_eq!(strip_leading_track_number("[16] Track"), "Track");
        assert_eq!(strip_leading_track_number("1999"), "1999");
        assert_eq!(strip_leading_track_number("2pac"), "2pac");
    }

    #[test]
    fn strip_junk_prefixes() {
        assert_eq!(
            strip_junk_filename_prefix("__________ Diggy Diggy Hole"),
            "Diggy Diggy Hole"
        );
        assert_eq!(strip_junk_filename_prefix("_JUMP"), "JUMP");
        assert_eq!(strip_junk_filename_prefix("._All In This"), "All In This");
        assert_eq!(strip_junk_filename_prefix("... --- Title"), "Title");
        assert_eq!(strip_junk_filename_prefix("Normal Title"), "Normal Title");
    }

    #[test]
    fn parse_filename_artist_title_and_junk() {
        let m = parse_meta_from_filename("._KNÄF - Skreechzer [SYT006].mp3");
        assert_eq!(m.artist.as_deref(), Some("KNÄF"));
        assert_eq!(m.title.as_deref(), Some("Skreechzer [SYT006]"));

        let m = parse_meta_from_filename("__________ Diggy Diggy Hole.mp3");
        assert_eq!(m.artist, None);
        assert_eq!(m.title.as_deref(), Some("Diggy Diggy Hole"));

        let m = parse_meta_from_filename("._[Hard] _LES KASSOS REMIX_ by DARKTEK.mp3");
        assert_eq!(m.artist.as_deref(), Some("DARKTEK"));
        assert!(m.title.as_deref().unwrap_or("").contains("LES KASSOS"));

        let m = parse_meta_from_filename("01 - Shadow.mp3");
        assert_eq!(m.title.as_deref(), Some("Shadow"));
    }

    #[test]
    fn rename_artist_title() {
        let source = Path::new(r"C:\lib\16 .RAW Spleen.mp3");
        let track = OrganizeTrack {
            path: source.to_string_lossy().into_owned(),
            folder: "Hip-Hop".into(),
            title: Some(".RAW Spleen".into()),
            artist: Some("Jazzy Bazz, Laylow".into()),
        };
        let name = resolve_output_file_name(source, &track, RenameMode::ArtistTitle).unwrap();
        assert_eq!(
            name.to_string_lossy(),
            "Jazzy Bazz, Laylow - RAW Spleen.mp3"
        );
    }

    #[test]
    fn rename_from_filename_when_no_tags() {
        let source = Path::new(r"C:\lib\01 - Shadow.mp3");
        let track = OrganizeTrack {
            path: source.to_string_lossy().into_owned(),
            folder: "Rap".into(),
            title: None,
            artist: None,
        };
        let name = resolve_output_file_name(source, &track, RenameMode::Title).unwrap();
        assert_eq!(name.to_string_lossy(), "Shadow.mp3");
    }

    #[test]
    #[ignore = "diagnostic local — dossier de test optionnel"]
    fn dump_test_library_classification() {
        let root = r"C:\Users\eliot\Music\test";
        if !std::path::Path::new(root).is_dir() {
            return;
        }
        let scan = scan_library_sync(None, root.to_string()).expect("scan");
        println!(
            "files={} sorted={} unknown={} unread={} folders={}",
            scan.file_count,
            scan.sorted_percent,
            scan.unknown_count,
            scan.unread_count,
            scan.groups.len()
        );
        for group in &scan.groups {
            println!("\n== {} ({}) ==", group.folder, group.tracks.len());
            for track in &group.tracks {
                println!(
                    "  {}\n    artist={:?} title={:?} tag_folder={}",
                    track.file_name, track.artist, track.title, track.folder
                );
            }
        }
    }
}
