//! Classement local : genres + sous-genres à partir des titres / noms de fichiers.
//! Les convertisseurs YouTube n'écrivent presque jamais le tag Genre, mais le
//! titre contient souvent « Acid », « Techno », « Hardstyle », etc.

use std::path::{Component, PathBuf};

/// Placement final : libellé affiché + chemin relatif de dossier (segments).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    pub label: String,
    pub segments: Vec<String>,
}

impl Placement {
    pub fn folder(&self) -> String {
        self.segments.join("\\")
    }

    pub fn from_flat(label: &str) -> Self {
        Self {
            label: label.to_string(),
            segments: vec![label.to_string()],
        }
    }
}

/// Règles : mots-clés (dans titre / fichier) → (parent, sous-genre).
/// Ordre = priorité (plus spécifique en premier).
const KEYWORD_RULES: &[(&[&str], &str, &str)] = &[
    // Hard / rave
    (&["frenchcore"], "Électronique", "Frenchcore"),
    (&["hardstyle"], "Électronique", "Hardstyle"),
    (&["hardcore", "gabber", "uptempo"], "Électronique", "Hardcore"),
    (&["hardtechno", "hard techno"], "Électronique", "Hardtechno"),
    (&["schranz"], "Électronique", "Schranz"),
    // Techno family
    (&["acid techno"], "Électronique", "Acid"),
    (&["acid"], "Électronique", "Acid"),
    (&["melodic techno"], "Électronique", "Melodic Techno"),
    (&["industrial techno"], "Électronique", "Industrial"),
    (&["minimal techno"], "Électronique", "Minimal"),
    (&["techno"], "Électronique", "Techno"),
    // House / dance
    (&["tech house", "tech-house"], "Électronique", "Tech House"),
    (&["deep house"], "Électronique", "Deep House"),
    (&["progressive house"], "Électronique", "Progressive House"),
    (&["afro house"], "Électronique", "Afro House"),
    (&["bass house"], "Électronique", "Bass House"),
    (&["future house"], "Électronique", "Future House"),
    (&["electro house"], "Électronique", "Electro House"),
    (&["slap house", "slaphouse"], "Électronique", "Slap House"),
    (&["organic house"], "Électronique", "Organic House"),
    (&["funky house"], "Électronique", "Funky House"),
    (&["disco house"], "Électronique", "Disco"),
    (&["house"], "Électronique", "House"),
    (&["uk garage", "ukg"], "Électronique", "UK Garage"),
    (&["garage"], "Électronique", "Garage"),
    (&["disco"], "Électronique", "Disco"),
    (&["dance"], "Électronique", "Dance"),
    // Bass music
    (&["drum and bass", "drum & bass", "dnb", "d&b", "jungle"], "Électronique", "Drum and Bass"),
    (&["dubstep"], "Électronique", "Dubstep"),
    (&["riddim"], "Électronique", "Riddim"),
    (&["drumstep"], "Électronique", "Drumstep"),
    (&["breakbeat", "breaks"], "Électronique", "Breakbeat"),
    (&["bassline"], "Électronique", "Bassline"),
    // Trance / ambient
    (&["psytrance", "psy trance", "psychedelic trance"], "Électronique", "Psytrance"),
    (&["trance"], "Électronique", "Trance"),
    (&["ambient"], "Électronique", "Ambient"),
    (&["downtempo"], "Électronique", "Downtempo"),
    (&["idm"], "Électronique", "IDM"),
    (&["synthwave", "retrowave"], "Électronique", "Synthwave"),
    (&["electro"], "Électronique", "Electro"),
    (&["edm"], "Électronique", "EDM"),
    (&["rave"], "Électronique", "Rave"),
    // Scène FR / free
    (&["hardtek", "hard tek"], "Électronique", "Hardtek"),
    (&["tekno", "techno hardcore tribe"], "Électronique", "Tekno"),
    (&["tribe"], "Électronique", "Tribe"),
    (&["mental"], "Électronique", "Mental"),
    (&["speedcore", "terrorcore", "terror"], "Électronique", "Speedcore"),
    (&["makina"], "Électronique", "Makina"),
    (&["jumpstyle", "jump style"], "Électronique", "Jumpstyle"),
    (&["hands up", "handsup"], "Électronique", "Hands Up"),
    (&["eurodance", "euro dance"], "Électronique", "Eurodance"),
    (&["nightcore"], "Électronique", "Nightcore"),
    (&["melbourne bounce"], "Électronique", "Bounce"),
    (&["bounce"], "Électronique", "Bounce"),
    (&["big room", "bigroom"], "Électronique", "Big Room"),
    (&["nu disco", "nu-disco", "nudisco"], "Électronique", "Nu-Disco"),
    (&["jersey club"], "Électronique", "Jersey Club"),
    (&["amapiano"], "Électronique", "Amapiano"),
    (&["gqom"], "Électronique", "Gqom"),
    (&["baile funk", "funk carioca", "brazilian funk"], "Électronique", "Baile Funk"),
    (&["moombahton"], "Électronique", "Moombahton"),
    (&["future bass"], "Électronique", "Future Bass"),
    (&["colour bass", "color bass"], "Électronique", "Colour Bass"),
    (&["midtempo"], "Électronique", "Midtempo"),
    (&["tearout"], "Électronique", "Dubstep"),
    (&["brostep"], "Électronique", "Dubstep"),
    (&["neurofunk"], "Électronique", "Drum and Bass"),
    (&["liquid funk", "liquid dnb"], "Électronique", "Drum and Bass"),
    (&["jump up", "jumpup"], "Électronique", "Drum and Bass"),
    (&["darkstep"], "Électronique", "Drum and Bass"),
    (&["hard bass", "hardbass", "pumping"], "Électronique", "Hard Bass"),
    (&["phonk house"], "Électronique", "Phonk"),
    (&["lofi", "lo-fi", "lo fi", "chillhop"], "Électronique", "Lofi"),
    (&["vaporwave"], "Électronique", "Vaporwave"),
    (&["darksynth"], "Électronique", "Synthwave"),
    (&["chillwave"], "Électronique", "Synthwave"),
    (&["wave"], "Électronique", "Wave"),
    // Hip-hop family
    (&["afro trap", "afrotrap"], "Hip-Hop", "Afro Trap"),
    (&["rap drill", "drill fr"], "Hip-Hop", "Drill"),
    (&["lofi rap", "lo-fi rap"], "Hip-Hop", "Rap"),
    (&["trap bass", "bass trap"], "Électronique", "Trap Bass"),
    (&["phonk"], "Hip-Hop", "Phonk"),
    (&["drill"], "Hip-Hop", "Drill"),
    (&["trap"], "Hip-Hop", "Trap"),
    (&["boom bap", "boombap"], "Hip-Hop", "Boom Bap"),
    (&["cloud rap", "cloudrap"], "Hip-Hop", "Cloud Rap"),
    (&["rage"], "Hip-Hop", "Rage"),
    (&["pluggnb", "plugg"], "Hip-Hop", "Plugg"),
    (&["grime"], "Hip-Hop", "Grime"),
    (&["rap fr", "rap francais", "rap français"], "Hip-Hop", "Rap FR"),
    (&["rap"], "Hip-Hop", "Rap"),
    (&["hip hop", "hip-hop", "hiphop"], "Hip-Hop", "Hip-Hop"),
    (&["r&b", "rnb", "r and b"], "R&B", "R&B"),
    // Other
    (&["reggae", "dancehall"], "Reggae", "Reggae"),
    (&["afrobeats", "afrobeat"], "Afro", "Afrobeats"),
    (&["reggaeton"], "Latin", "Reggaeton"),
    (&["latin", "latino"], "Latin", "Latin"),
    (&["metalcore"], "Rock", "Metalcore"),
    (&["nu metal", "numetal"], "Rock", "Nu Metal"),
    (&["post punk", "post-punk"], "Rock", "Post-Punk"),
    (&["shoegaze"], "Rock", "Shoegaze"),
    (&["emo"], "Rock", "Emo"),
    (&["metal"], "Rock", "Metal"),
    (&["punk"], "Rock", "Punk"),
    (&["indie"], "Rock", "Indie"),
    (&["rock"], "Rock", "Rock"),
    (&["hyperpop"], "Pop", "Hyperpop"),
    (&["kpop", "k-pop"], "Pop", "K-Pop"),
    (&["jpop", "j-pop"], "Pop", "J-Pop"),
    (&["pop urbaine", "pop-urbaine"], "Pop", "Pop urbaine"),
    (&["pop"], "Pop", "Pop"),
    (&["bebop", "be-bop"], "Jazz", "Jazz"),
    (&["nu jazz", "nujazz"], "Jazz", "Jazz"),
    (&["bossa nova", "bossanova"], "Jazz", "Bossa Nova"),
    (&["jazz"], "Jazz", "Jazz"),
    (&["classical", "classique", "opera", "opéra"], "Classique", "Classique"),
    (&["gospel"], "Soul", "Gospel"),
    (&["soul"], "Soul", "Soul"),
    (&["funk"], "Funk", "Funk"),
    (&["blues"], "Blues", "Blues"),
    (&["country"], "Country", "Country"),
    (&["folk"], "Folk", "Folk"),
    (&["rai", "raï"], "Maghreb", "Raï"),
    (&["chaabi"], "Maghreb", "Chaabi"),
    (&["zouk"], "Afro", "Zouk"),
    (&["kizomba"], "Afro", "Kizomba"),
    (&["compas"], "Afro", "Compas"),
    (&["salsa"], "Latin", "Salsa"),
    (&["bachata"], "Latin", "Bachata"),
    (&["cumbia"], "Latin", "Cumbia"),
];

/// Normalise un genre iTunes / tag vers un libellé stable pour `map_flat_to_nested`.
/// Les sous-genres précis (Techno, House…) sont conservés — on ne les écrase plus
/// en « Électronique » générique (sinon tout tombait dans Electro).
pub fn normalize_base_genre(raw: &str) -> String {
    let lower = crate::genre_db::norm(raw);
    match lower.as_str() {
        // Génériques électro uniquement
        "electronic" | "electronica" | "electronique" => "Électronique".into(),
        "dance" | "club" | "edm" => "Dance".into(),
        // Sous-genres électro : garder le nom pour le nest correct
        "techno" => "Techno".into(),
        "house" => "House".into(),
        "trance" => "Trance".into(),
        "disco" => "Disco".into(),
        "garage" | "uk garage" | "ukg" => "Garage".into(),
        "dubstep" => "Dubstep".into(),
        "drum and bass" | "drum & bass" | "dnb" | "d&b" | "jungle" => "Drum and Bass".into(),
        "ambient" | "new age" | "newage" => "Ambient".into(),
        "hip hop/rap" | "hip-hop/rap" | "hip hop" | "hiphop" | "rap" => "Hip-Hop".into(),
        "french hip hop" | "french hip-hop" | "rap francais" | "rap français" => "Rap FR".into(),
        "french pop" | "variete" | "variété" => "Variété FR".into(),
        "r&b/soul" | "r&b" | "rnb" => "R&B".into(),
        "soul" | "soul & funk" | "soul and funk" => "Soul".into(),
        "alternative" | "indie" | "indie rock" | "alternative rock" => "Indie".into(),
        "hard rock" => "Rock".into(),
        "metal" | "heavy metal" => "Metal".into(),
        "punk" => "Punk".into(),
        "soundtrack" | "bandes originales" | "musique de film" | "score" | "films/games" => {
            "Bandes originales".into()
        }
        "k-pop" | "kpop" => "K-Pop".into(),
        "j-pop" | "jpop" => "J-Pop".into(),
        "pop" | "synth-pop" | "synthpop" => "Pop".into(),
        "reggaeton" => "Reggaeton".into(),
        "latin" | "latino" | "salsa" | "tropical" => "Latin".into(),
        "afrobeats" | "afrobeat" => "Afrobeats".into(),
        "afro" | "african" => "Afro".into(),
        "reggae" | "dancehall" | "ska" => "Reggae".into(),
        "jazz" | "vocal jazz" | "smooth jazz" => "Jazz".into(),
        "classical" | "classique" | "opera" | "opéra" => "Classique".into(),
        "country" | "americana" => "Country".into(),
        "blues" => "Blues".into(),
        "folk" | "singer/songwriter" | "singer songwriter" => "Folk".into(),
        "funk" => "Funk".into(),
        "gospel" | "christian" | "worship" => "Gospel".into(),
        "world" | "international" | "world music" => "World".into(),
        "comedy" | "spoken word" => "Autres".into(),
        "children's music" | "children" | "kids" => "Autres".into(),
        other if other.is_empty() => raw.trim().to_string(),
        _ => {
            let t = raw.trim();
            if t.chars().next().is_some_and(|c| c.is_lowercase()) {
                let mut c = t.chars();
                match c.next() {
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                    None => t.to_string(),
                }
            } else {
                t.to_string()
            }
        }
    }
}

/// Détecte un sous-genre depuis titre + nom de fichier.
pub fn detect_keyword_placement(haystack: &str) -> Option<Placement> {
    // Priorité aux segments entre () ou [] — souvent le style sur YouTube
    for chunk in extract_bracket_chunks(haystack) {
        if let Some(p) = match_keywords(&chunk) {
            return Some(p);
        }
    }
    match_keywords(haystack)
}

fn extract_bracket_chunks(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut depth = 0i32;
    let mut opener = ' ';
    for c in s.chars() {
        if depth == 0 && (c == '(' || c == '[') {
            depth = 1;
            opener = c;
            buf.clear();
            continue;
        }
        if depth > 0 {
            let closer = if opener == '(' { ')' } else { ']' };
            if c == opener {
                depth += 1;
            } else if c == closer {
                depth -= 1;
                if depth == 0 && !buf.trim().is_empty() {
                    out.push(buf.clone());
                    buf.clear();
                }
                continue;
            }
            if depth > 0 {
                buf.push(c);
            }
        }
    }
    out
}

fn match_keywords(haystack: &str) -> Option<Placement> {
    let text = format!(" {} ", normalize_haystack(haystack));
    for (keys, parent, sub) in KEYWORD_RULES {
        if keys.iter().any(|k| {
            let key = normalize_haystack(k);
            if key.is_empty() {
                return false;
            }
            text.contains(&format!(" {key} "))
        }) {
            return Some(Placement {
                label: format!("{parent} · {sub}"),
                segments: vec![(*parent).to_string(), (*sub).to_string()],
            });
        }
    }
    None
}

/// Convertit les genres Spotify (souvent « french hip hop », « drum and bass »)
/// vers le même schéma de dossiers que le local.
pub fn placement_from_spotify_genres(genres: &[String]) -> Option<Placement> {
    if genres.is_empty() {
        return None;
    }
    let mut best: Option<(usize, Placement)> = None;
    for g in genres {
        if let Some(p) = map_spotify_label(g) {
            let score = specificity_score(&p);
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, p));
            }
        }
    }
    if best.is_some() {
        return best.map(|(_, p)| p);
    }
    for g in genres {
        if let Some(p) = detect_keyword_placement(g) {
            return Some(p);
        }
    }
    detect_keyword_placement(&genres.join(" "))
}

fn specificity_score(p: &Placement) -> usize {
    let sub = p.segments.last().map(String::as_str).unwrap_or("");
    match sub {
        "Rap FR" | "Hardtek" | "Frenchcore" | "Drill" | "Drum and Bass" | "Dubstep"
        | "Hardstyle" | "Hardtechno" | "Tech House" | "Bass House" | "Phonk" | "Grime" => 30,
        "Rap" | "Trap" | "Techno" | "House" | "Electro" | "Rave" => 15,
        _ => 10 + sub.len().min(20),
    }
}

fn map_spotify_label(g: &str) -> Option<Placement> {
    let n = crate::genre_db::norm(g);
    if n.is_empty() {
        return None;
    }

    // Rap FR / scène francophone
    if n.contains("french hip")
        || n.contains("rap franc")
        || n.contains("cloud rap franc")
        || n.contains("rap conscient")
        || n.contains("rap marseille")
        || n.contains("rap lyon")
        || n.contains("rap belge")
        || n.contains("belgian hip")
        || n.contains("swiss hip")
        || n.contains("quebec")
        || n.contains("drill franc")
        || n.contains("french drill")
        || n.contains("trap franc")
        || n.contains("french trap")
        || n == "pop urbaine"
        || n.contains("pop urbaine")
    {
        if n.contains("drill") {
            return Some(crate::genre_db::nested("Hip-Hop", "Drill"));
        }
        if n.contains("pop urbaine") {
            return Some(crate::genre_db::nested("Pop", "Pop urbaine"));
        }
        if n.contains("trap") {
            return Some(crate::genre_db::nested("Hip-Hop", "Trap"));
        }
        return Some(crate::genre_db::nested("Hip-Hop", "Rap FR"));
    }

    let (parent, sub) = if n.contains("uk drill") || n == "drill" || n.contains("brooklyn drill") {
        ("Hip-Hop", "Drill")
    } else if n.contains("grime") {
        ("Hip-Hop", "Grime")
    } else if n.contains("phonk") {
        ("Hip-Hop", "Phonk")
    } else if n.contains("cloud rap") {
        ("Hip-Hop", "Cloud Rap")
    } else if n.contains("boom bap") || n.contains("boombap") {
        ("Hip-Hop", "Boom Bap")
    } else if n.contains("rage") && n.contains("rap") {
        ("Hip-Hop", "Rage")
    } else if n.contains("trap") && !n.contains("bass") {
        ("Hip-Hop", "Trap")
    } else if n.contains("hip hop") || n.contains("hiphop") || n == "rap" || n.contains("gangster rap")
        || n.contains("alternative hip") || n.contains("underground hip") || n.contains("hardcore hip")
        || n.contains("east coast hip") || n.contains("west coast hip") || n.contains("southern hip")
    {
        ("Hip-Hop", "Rap")
    } else if n.contains("r&b") || n.contains("rnb") || n.contains("contemporary r") {
        ("R&B", "R&B")
    } else if n.contains("frenchcore") {
        ("Électronique", "Frenchcore")
    } else if n.contains("hardtek") || n.contains("hard tek") || n.contains("tribe") && n.contains("tek") {
        ("Électronique", "Hardtek")
    } else if n.contains("hardstyle") {
        ("Électronique", "Hardstyle")
    } else if n.contains("hardcore techno") || n.contains("gabber") || n.contains("uptempo") {
        ("Électronique", "Hardcore")
    } else if n.contains("hard techno") || n.contains("hardtechno") || n.contains("schranz") {
        ("Électronique", "Hardtechno")
    } else if n.contains("drum and bass")
        || n.contains("drum & bass")
        || n.contains("liquid funk")
        || n.contains("neurofunk")
        || n.contains("jump up")
        || n.contains("jungle")
        || n.split_whitespace().any(|w| w == "dnb" || w == "d&b")
    {
        ("Électronique", "Drum and Bass")
    } else if n.contains("dubstep") || n.contains("riddim") || n.contains("brostep") || n.contains("tearout")
    {
        ("Électronique", "Dubstep")
    } else if n.contains("bass house") {
        ("Électronique", "Bass House")
    } else if n.contains("tech house") {
        ("Électronique", "Tech House")
    } else if n.contains("deep house") {
        ("Électronique", "Deep House")
    } else if n.contains("progressive house") {
        ("Électronique", "Progressive House")
    } else if n.contains("afro house") {
        ("Électronique", "Afro House")
    } else if n.contains("slap house") {
        ("Électronique", "Slap House")
    } else if n.contains("electro house") {
        ("Électronique", "Electro House")
    } else if n.contains("future house") {
        ("Électronique", "Future House")
    } else if n.contains("uk garage") || n.contains("speed garage") || n == "ukg" {
        ("Électronique", "UK Garage")
    } else if n.contains("melodic techno") {
        ("Électronique", "Melodic Techno")
    } else if n.contains("minimal techno") || n == "minimal" {
        ("Électronique", "Minimal")
    } else if n.contains("acid techno") || n == "acid" || n.contains("acid house") {
        ("Électronique", "Acid")
    } else if n.contains("industrial techno") {
        ("Électronique", "Industrial")
    } else if n.contains("techno") {
        ("Électronique", "Techno")
    } else if n.contains("trance") || n.contains("psytrance") {
        if n.contains("psy") {
            ("Électronique", "Psytrance")
        } else {
            ("Électronique", "Trance")
        }
    } else if n.contains("hard bass") || n.contains("hardbass") {
        ("Électronique", "Hard Bass")
    } else if n.contains("hands up") || n.contains("handsup") || n.contains("eurodance") {
        ("Électronique", "Hands Up")
    } else if n.contains("synthwave") || n.contains("retrowave") || n.contains("outrun") {
        ("Électronique", "Synthwave")
    } else if n.contains("future bass") {
        ("Électronique", "Future Bass")
    } else if n.contains("breakbeat") || n.contains("breaks") {
        ("Électronique", "Breakbeat")
    } else if n.contains("idm") || n.contains("intelligent dance") {
        ("Électronique", "IDM")
    } else if n.contains("edm") || n.contains("big room") || n.contains("mainstage") {
        ("Électronique", "EDM")
    } else if n.contains("house") {
        ("Électronique", "House")
    } else if n.contains("electro") || n.contains("filter house") {
        ("Électronique", "Electro")
    } else if n.contains("electronic") || n.contains("electronica") || n.contains("dance") {
        ("Électronique", "Électronique")
    } else if n.contains("afrobeats") || n.contains("afrobeat") {
        ("Afro", "Afrobeats")
    } else if n.contains("reggaeton") {
        ("Latin", "Reggaeton")
    } else if n.contains("reggae") || n.contains("dancehall") {
        ("Reggae", "Reggae")
    } else if n.contains("metalcore") {
        ("Rock", "Metalcore")
    } else if n.contains("nu metal") {
        ("Rock", "Nu Metal")
    } else if n.contains("metal") {
        ("Rock", "Metal")
    } else if n.contains("punk") {
        ("Rock", "Punk")
    } else if n.contains("indie rock") || n.contains("indie") {
        ("Rock", "Indie")
    } else if n.contains("rock") || n.contains("alternative") {
        ("Rock", "Rock")
    } else if n.contains("k-pop") || n.contains("kpop") {
        ("Pop", "K-Pop")
    } else if n.contains("hyperpop") {
        ("Pop", "Hyperpop")
    } else if n.contains("pop") {
        ("Pop", "Pop")
    } else if n.contains("jazz") {
        ("Jazz", "Jazz")
    } else if n.contains("soul") {
        ("Soul", "Soul")
    } else if n.contains("funk") {
        ("Funk", "Funk")
    } else if n.contains("blues") {
        ("Blues", "Blues")
    } else if n.contains("classical") || n.contains("opera") {
        ("Classique", "Classique")
    } else if n.contains("ambient") {
        ("Électronique", "Ambient")
    } else if n.contains("lo-fi") || n.contains("lofi") || n.contains("chillhop") {
        ("Électronique", "Lofi")
    } else {
        return None;
    };

    Some(crate::genre_db::nested(parent, sub))
}

/// Combine tag / iTunes / artiste connu / mots-clés titre → dossier.
pub fn resolve_placement(
    base: Option<&str>,
    title: Option<&str>,
    file_name: &str,
    artist: Option<&str>,
) -> Placement {
    let file_stem = file_name
        .trim_end_matches(".mp3")
        .trim_end_matches(".flac")
        .trim_end_matches(".wav")
        .trim_end_matches(".m4a")
        .trim_end_matches(".ogg")
        .trim_end_matches(".opus");
    let title_hay = format!("{} {file_stem}", title.unwrap_or(""));
    let keyword = detect_keyword_placement(&title_hay);
    let from_artist = crate::genre_db::placement_for_artist(artist)
        .or_else(|| crate::genre_db::placement_for_text(&title_hay))
        .or_else(|| artist.and_then(|a| crate::genre_db::placement_for_text(a)));

    let base_norm = base
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_base_genre);

    // Noms maison (anciens dossiers manuels, tags fantaisistes) : on ne les
    // reprend pas comme chemin. Seulement la taxonomie BassOrder / mots-clés.
    let base_placement = base_norm.as_ref().and_then(|b| {
        map_flat_to_nested(b).or_else(|| detect_keyword_placement(b))
    });

    let keyword = keyword.filter(|kw| {
        from_artist.is_none() || keyword_is_decisive(&title_hay, kw)
    });

    match (base_placement, keyword, from_artist) {
        (Some(base), Some(kw), _) => merge_placements(base, kw),
        (None, Some(kw), _) => kw,
        (Some(base), None, Some(art)) => merge_placements(base, art),
        (None, None, Some(art)) => art,
        (Some(base), None, None) => base,
        (None, None, None) => Placement::from_flat("Sans genre"),
    }
}

/// Un mot-clé titre écrase un artiste connu seulement s’il est précis
/// (hardstyle, DnB…) ou collé entre () / [] façon tag YouTube.
fn keyword_is_decisive(haystack: &str, kw: &Placement) -> bool {
    for chunk in extract_bracket_chunks(haystack) {
        if match_keywords(&chunk).as_ref() == Some(kw) {
            return true;
        }
    }
    let sub = kw.segments.last().map(String::as_str).unwrap_or("");
    matches!(
        sub,
        "Frenchcore"
            | "Hardstyle"
            | "Hardcore"
            | "Hardtechno"
            | "Schranz"
            | "Acid"
            | "Melodic Techno"
            | "Industrial"
            | "Drum and Bass"
            | "Dubstep"
            | "Riddim"
            | "Drumstep"
            | "Psytrance"
            | "Hardtek"
            | "Tekno"
            | "Tribe"
            | "Speedcore"
            | "Jumpstyle"
            | "Tech House"
            | "Bass House"
            | "Slap House"
            | "UK Garage"
            | "Hard Bass"
            | "Future Bass"
            | "Colour Bass"
            | "Trap Bass"
            | "Phonk"
            | "Neurofunk"
            | "Jersey Club"
            | "Amapiano"
    )
}

fn merge_placements(base: Placement, kw: Placement) -> Placement {
    let parent = base
        .segments
        .first()
        .cloned()
        .unwrap_or_else(|| base.label.clone());
    let kw_parent = kw.segments.first().map(String::as_str).unwrap_or("");

    if parents_compatible(&parent, kw_parent) {
        let sub = kw
            .segments
            .last()
            .cloned()
            .unwrap_or_else(|| parent.clone());
        if sub.eq_ignore_ascii_case(parent.as_str()) {
            Placement {
                label: parent.clone(),
                segments: vec![parent],
            }
        } else {
            Placement {
                label: format!("{parent} · {sub}"),
                segments: vec![parent, sub],
            }
        }
    } else {
        kw
    }
}

fn map_flat_to_nested(base: &str) -> Option<Placement> {
    let lower = crate::genre_db::norm(base);
    let (parent, sub) = match lower.as_str() {
        "techno" => ("Électronique", "Techno"),
        "house" => ("Électronique", "House"),
        "trance" => ("Électronique", "Trance"),
        "dance" | "club" | "edm" => ("Électronique", "Dance"),
        "disco" => ("Électronique", "Disco"),
        "garage" | "uk garage" | "ukg" => ("Électronique", "Garage"),
        "dubstep" => ("Électronique", "Dubstep"),
        "drum and bass" | "drum & bass" | "dnb" | "d&b" | "jungle" => {
            ("Électronique", "Drum and Bass")
        }
        "ambient" => ("Électronique", "Ambient"),
        // Générique électro → dossier parent (pas « Electro » qui est un sous-genre)
        "electro" => ("Électronique", "Electro"),
        "electronique" | "electronic" | "electronica" => ("Électronique", "Électronique"),
        "hip-hop/rap" | "hip hop/rap" | "hip-hop" | "hip hop" | "rap" => ("Hip-Hop", "Rap"),
        "rap fr" | "french hip hop" | "french hip-hop" | "rap francais" | "rap français" => {
            ("Hip-Hop", "Rap FR")
        }
        "french pop" | "variete" | "variété" | "variety" => ("Pop", "Variété FR"),
        "r&b" | "rnb" => ("R&B", "R&B"),
        "soul" | "soul & funk" | "soul and funk" => ("Soul", "Soul"),
        "funk" => ("Funk", "Funk"),
        "gospel" => ("Soul", "Gospel"),
        "k-pop" | "kpop" => ("Pop", "K-Pop"),
        "j-pop" | "jpop" => ("Pop", "J-Pop"),
        "reggaeton" => ("Latin", "Reggaeton"),
        "latin" | "latino" => ("Latin", "Latin"),
        "afrobeats" | "afrobeat" => ("Afro", "Afrobeats"),
        "afro" => ("Afro", "Afro"),
        "metal" | "heavy metal" => ("Rock", "Metal"),
        "punk" => ("Rock", "Punk"),
        "indie" | "alternative" | "indie rock" | "alternative rock" => ("Rock", "Indie"),
        "jazz" => ("Jazz", "Jazz"),
        "classical" | "classique" => ("Classique", "Classique"),
        "reggae" => ("Reggae", "Reggae"),
        "blues" => ("Blues", "Blues"),
        "country" => ("Country", "Country"),
        "folk" => ("Folk", "Folk"),
        "pop" => ("Pop", "Pop"),
        "rock" => ("Rock", "Rock"),
        "world" => ("World", "World"),
        "bandes originales" | "soundtrack" | "films/games" => {
            ("Bandes originales", "Bandes originales")
        }
        "autres" => ("Autres", "Autres"),
        _ => return None,
    };
    Some(crate::genre_db::nested(parent, sub))
}

fn parents_compatible(base: &str, kw_parent: &str) -> bool {
    let b = crate::genre_db::norm(base);
    let k = crate::genre_db::norm(kw_parent);
    if b == k {
        return true;
    }
    // Tag plat (Techno, House…) compatible avec parent Électronique
    let electro_subs = [
        "techno",
        "house",
        "trance",
        "disco",
        "garage",
        "dance",
        "club",
        "edm",
        "dubstep",
        "drum and bass",
        "ambient",
        "electro",
        "electronique",
        "electronic",
        "electronica",
    ];
    if k.contains("lectronique") && electro_subs.iter().any(|x| b == *x || b.contains(x)) {
        return true;
    }
    if (b.contains("hip") || b == "rap" || b == "rap fr") && k.contains("hip") {
        return true;
    }
    if (b.contains("r and b") || b.contains("soul") || b == "rnb" || b == "funk" || b == "gospel")
        && (k.contains("r and b") || k.contains("soul") || k.contains("funk") || k == "rnb")
    {
        return true;
    }
    if b.contains("pop") && k.contains("pop") {
        return true;
    }
    if (b.contains("rock") || b == "metal" || b == "punk" || b == "indie" || b == "alternative")
        && k.contains("rock")
    {
        return true;
    }
    if (b.contains("latin") || b == "reggaeton") && k.contains("latin") {
        return true;
    }
    if (b.contains("afro") || b == "afrobeats" || b == "afrobeat") && k.contains("afro") {
        return true;
    }
    if (b.contains("bande") || b.contains("soundtrack")) && (k.contains("bande") || k.contains("soundtrack"))
    {
        return true;
    }
    false
}

fn normalize_haystack(s: &str) -> String {
    s.to_lowercase()
        .replace('é', "e")
        .replace('è', "e")
        .replace('ê', "e")
        .replace('à', "a")
        .replace('ù', "u")
        .replace('ç', "c")
        .replace('ä', "a")
        .replace('ö', "o")
        .replace('ü', "u")
        .replace('-', " ")
        .replace('_', " ")
}

/// Sanitize chaque segment d'un chemin de dossier (autorise les sous-dossiers).
pub fn sanitize_folder_path(path: &str) -> PathBuf {
    let mut out = PathBuf::new();
    for raw in path.split(['/', '\\']) {
        let seg = sanitize_segment(raw);
        if seg.is_empty() || seg == "." || seg == ".." {
            continue;
        }
        out.push(seg);
    }
    if out.as_os_str().is_empty() {
        out.push("Sans genre");
    }
    out
}

pub fn sanitize_segment(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if c.is_control() => ' ',
            _ => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let mut trimmed = cleaned.trim_matches('.').trim().to_string();
    if trimmed.chars().count() > 80 {
        trimmed = trimmed.chars().take(80).collect::<String>();
        trimmed = trimmed.trim().trim_matches('.').to_string();
    }
    if trimmed.is_empty() {
        return String::new();
    }

    match trimmed.to_ascii_uppercase().as_str() {
        "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6"
        | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6"
        | "LPT7" | "LPT8" | "LPT9" => format!("_{trimmed}"),
        _ => trimmed,
    }
}

/// Vérifie qu'un chemin relatif ne sort pas du root (pas de `..`).
pub fn is_safe_relative(path: &std::path::Path) -> bool {
    path.components().all(|c| matches!(c, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acid_from_title() {
        let p = detect_keyword_placement("Acid Dream").unwrap();
        assert_eq!(p.segments, vec!["Électronique".to_string(), "Acid".to_string()]);
    }

    #[test]
    fn artist_db_classifies_vald() {
        let p = resolve_placement(None, Some("Dragon"), "dragon.mp3", Some("Vald"));
        assert_eq!(p.segments[0], "Hip-Hop");
        assert_eq!(p.segments.last().unwrap(), "Rap FR");
    }

    #[test]
    fn keyword_beats_artist() {
        let p = resolve_placement(
            None,
            Some("Vald - Acid Techno Mix"),
            "mix.mp3",
            Some("Vald"),
        );
        assert_eq!(p.segments.last().unwrap(), "Acid");
    }

    #[test]
    fn known_artist_beats_weak_title_keyword() {
        let p = resolve_placement(
            None,
            Some("Slap The Bassline - Original Mix"),
            "01 Slap The Bassline - Original Mix.mp3",
            Some("Creeds"),
        );
        assert_eq!(p.segments.last().unwrap(), "Hardtechno");
    }

    #[test]
    fn bracket_trap_bass_is_electronic() {
        let p = resolve_placement(
            None,
            Some("Tokyo Drift (trap bass )"),
            "01 Tokyo Drift (trap bass ).mp3",
            Some("Trap Remix Guys"),
        );
        assert_eq!(p.segments[0], "Électronique");
        assert_eq!(p.segments.last().unwrap(), "Trap Bass");
    }

    #[test]
    fn slap_house_mafia_not_plain_house() {
        let p = resolve_placement(
            None,
            Some("Balenciaga - Remix"),
            "01 Balenciaga - Remix.mp3",
            Some("SLAP HOUSE MAFIA,DKSH,FLOW"),
        );
        assert_eq!(p.segments.last().unwrap(), "Slap House");
    }

    #[test]
    fn knaef_unicode_artist() {
        let p = resolve_placement(None, Some("BREKDÄWN"), "01 BREKDÄWN.mp3", Some("KNÄF"));
        assert_eq!(p.segments.last().unwrap(), "Hardtek");
    }

    #[test]
    fn techno_nested_over_itunes_electronic() {
        let p = resolve_placement(
            Some("Electronic"),
            Some("(It Goes Like) Nanana - Techno"),
            "01 Nanana - Techno.mp3",
            None,
        );
        assert_eq!(p.segments[0], "Électronique");
        assert_eq!(p.segments.last().unwrap(), "Techno");
    }

    #[test]
    fn ignores_homemade_folder_genre_names() {
        let p = resolve_placement(
            Some("ELECTRONIQUEMENT CHELOU"),
            Some("Night Drive (Electro Mix)"),
            "01 Night Drive (Electro Mix).mp3",
            None,
        );
        assert_eq!(p.segments[0], "Électronique");
        assert_eq!(p.segments.last().unwrap(), "Electro");
        assert!(!p.folder().to_ascii_lowercase().contains("chelou"));
    }

    #[test]
    fn unknown_homemade_tag_without_hint_is_sans_genre() {
        let p = resolve_placement(
            Some("ELECTRONIQUEMENT CHELOU"),
            Some("Untitled Track"),
            "01 Untitled Track.mp3",
            None,
        );
        assert_eq!(p.label, "Sans genre");
    }

    #[test]
    fn path_sanitize_nested() {
        let p = sanitize_folder_path("Électronique/Acid");
        assert_eq!(p, PathBuf::from("Électronique").join("Acid"));
    }

    #[test]
    fn spotify_french_hip_hop() {
        let p = placement_from_spotify_genres(&["french hip hop".into(), "pop".into()]).unwrap();
        assert_eq!(p.segments.last().unwrap(), "Rap FR");
    }

    #[test]
    fn spotify_dnb() {
        let p = placement_from_spotify_genres(&["drum and bass".into(), "uk dnb".into()]).unwrap();
        assert_eq!(p.segments.last().unwrap(), "Drum and Bass");
    }

    #[test]
    fn spotify_generic_hip_hop() {
        let p = placement_from_spotify_genres(&["hip hop".into(), "rap".into()]).unwrap();
        assert_eq!(p.segments[0], "Hip-Hop");
    }

    #[test]
    fn spotify_hardstyle() {
        let p = placement_from_spotify_genres(&["hardstyle".into()]).unwrap();
        assert_eq!(p.segments.last().unwrap(), "Hardstyle");
    }

    #[test]
    fn tag_techno_stays_techno_not_electro() {
        let p = resolve_placement(Some("Techno"), Some("Untitled"), "01.mp3", None);
        assert_eq!(p.segments, vec!["Électronique".to_string(), "Techno".to_string()]);
    }

    #[test]
    fn tag_electronic_generic_not_electro_subgenre() {
        let p = resolve_placement(Some("Electronic"), None, "track.mp3", None);
        // Parent seul (pas le sous-genre « Electro »)
        assert_eq!(p.segments, vec!["Électronique".to_string()]);
        assert_ne!(p.segments.last().map(String::as_str), Some("Electro"));
    }

    #[test]
    fn tag_house_nested() {
        let p = resolve_placement(Some("House"), None, "track.mp3", None);
        assert_eq!(p.segments, vec!["Électronique".to_string(), "House".to_string()]);
    }

    #[test]
    fn tag_metal_under_rock() {
        let p = resolve_placement(Some("Metal"), None, "track.mp3", None);
        assert_eq!(p.segments, vec!["Rock".to_string(), "Metal".to_string()]);
    }

    #[test]
    fn tag_indie_under_rock() {
        let p = resolve_placement(Some("Indie"), None, "track.mp3", None);
        assert_eq!(p.segments, vec!["Rock".to_string(), "Indie".to_string()]);
    }

    #[test]
    fn tag_soundtrack_bandes_originales() {
        let p = resolve_placement(Some("Soundtrack"), None, "track.mp3", None);
        assert_eq!(p.segments[0], "Bandes originales");
    }

    #[test]
    fn tag_soul_not_rnb_bucket() {
        let p = resolve_placement(Some("Soul"), None, "track.mp3", None);
        assert_eq!(p.segments, vec!["Soul".to_string()]);
        assert_ne!(p.segments[0], "R&B");
    }

    #[test]
    fn reggaeton_keyword_not_generic_latin() {
        let p = detect_keyword_placement("Bad Bunny Reggaeton Mix").unwrap();
        assert_eq!(p.segments.last().unwrap(), "Reggaeton");
    }

    #[test]
    fn techno_tag_plus_acid_keyword_stays_electronic_parent() {
        let p = resolve_placement(
            Some("Techno"),
            Some("Acid Dream"),
            "acid.mp3",
            None,
        );
        assert_eq!(p.segments[0], "Électronique");
        assert_eq!(p.segments.last().unwrap(), "Acid");
    }
}
