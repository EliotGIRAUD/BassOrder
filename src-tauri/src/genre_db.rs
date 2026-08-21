//! Base locale artistes → (parent, sous-genre).
//! Complète tags ID3, mots-clés titre, et iTunes — ne les remplace pas.

use crate::genre_taxonomy::Placement;

/// alias (minuscules, sans accents) → parent, sous-genre.
/// Les alias courts (jul, pnl…) sont matchés en mots entiers.
const ARTISTS: &[(&[&str], &str, &str)] = &[
    // Rap FR
    (&["vald", "agde"], "Hip-Hop", "Rap FR"),
    (&["ninho"], "Hip-Hop", "Rap FR"),
    (&["damso"], "Hip-Hop", "Rap FR"),
    (&["booba"], "Hip-Hop", "Rap FR"),
    (&["jul"], "Hip-Hop", "Rap FR"),
    (&["niska"], "Hip-Hop", "Rap FR"),
    (&["gazo"], "Hip-Hop", "Drill"),
    (&["sdm"], "Hip-Hop", "Rap FR"),
    (&["werenoi"], "Hip-Hop", "Rap FR"),
    (&["plk"], "Hip-Hop", "Rap FR"),
    (&["nekfeu", "s-crew", "s crew"], "Hip-Hop", "Rap FR"),
    (&["orelsan"], "Hip-Hop", "Rap FR"),
    (&["pnl"], "Hip-Hop", "Rap FR"),
    (&["sch"], "Hip-Hop", "Rap FR"),
    (&["dinos"], "Hip-Hop", "Rap FR"),
    (&["laylow"], "Hip-Hop", "Rap FR"),
    (&["freeze corleone", "freeze"], "Hip-Hop", "Rap FR"),
    (&["kaaris"], "Hip-Hop", "Rap FR"),
    (&["maes"], "Hip-Hop", "Rap FR"),
    (&["leto"], "Hip-Hop", "Rap FR"),
    (&["tiakola"], "Hip-Hop", "Rap FR"),
    (&["koba la d", "koba lad"], "Hip-Hop", "Rap FR"),
    (&["zola"], "Hip-Hop", "Rap FR"),
    (&["uzi"], "Hip-Hop", "Rap FR"),
    (&["josman"], "Hip-Hop", "Rap FR"),
    (&["timal"], "Hip-Hop", "Rap FR"),
    (&["hamza"], "Hip-Hop", "Rap FR"),
    (&["romeo elvis", "roméo elvis"], "Hip-Hop", "Rap FR"),
    (&["alpha wann"], "Hip-Hop", "Rap FR"),
    (&["lorenzo"], "Hip-Hop", "Rap FR"),
    (&["bigflo et oli", "bigflo & oli"], "Hip-Hop", "Rap FR"),
    (&["rohff"], "Hip-Hop", "Rap FR"),
    (&["la fouine"], "Hip-Hop", "Rap FR"),
    (&["sinik"], "Hip-Hop", "Rap FR"),
    (&["soolking"], "Hip-Hop", "Rap FR"),
    (&["niro"], "Hip-Hop", "Rap FR"),
    (&["kalash criminel"], "Hip-Hop", "Rap FR"),
    (&["kalash"], "Hip-Hop", "Rap FR"),
    (&["ashe 22", "ashe22"], "Hip-Hop", "Rap FR"),
    (&["winnterzuko"], "Hip-Hop", "Rap FR"),
    (&["capitaine roshi", "roshi"], "Hip-Hop", "Rap FR"),
    (&["2zer", "2zer washington"], "Hip-Hop", "Rap FR"),
    (&["shay"], "Hip-Hop", "Rap FR"),
    (&["alkpote"], "Hip-Hop", "Rap FR"),
    (&["columbine"], "Hip-Hop", "Rap FR"),
    (&["nepal", "népal"], "Hip-Hop", "Rap FR"),
    (&["chill bump"], "Hip-Hop", "Rap FR"),
    (&["mister v", "misterv"], "Hip-Hop", "Rap FR"),
    (&["lujipeka", "lujji"], "Hip-Hop", "Rap FR"),
    (&["lomepal"], "Hip-Hop", "Rap FR"),
    (&["zuukou mayzie", "zuukou"], "Hip-Hop", "Rap FR"),
    (&["ateyaba"], "Hip-Hop", "Rap FR"),
    (&["sadek"], "Hip-Hop", "Rap FR"),
    (&["kekra"], "Hip-Hop", "Rap FR"),
    (&["guizmo"], "Hip-Hop", "Rap FR"),
    (&["hugsy"], "Hip-Hop", "Rap FR"),
    (&["medine", "médine"], "Hip-Hop", "Rap FR"),
    (&["kery james"], "Hip-Hop", "Rap FR"),
    (&["oxmo puccino"], "Hip-Hop", "Rap FR"),
    (&["iam"], "Hip-Hop", "Rap FR"),
    (&["terror reid"], "Hip-Hop", "Rap"),
    (&["city morgue"], "Hip-Hop", "Rap"),
    (&["zillakami"], "Hip-Hop", "Rap"),
    (&["sosmula"], "Hip-Hop", "Rap"),
    (&["ghostemane"], "Hip-Hop", "Rap"),
    (&["scarlxrd"], "Hip-Hop", "Rage"),
    (&["afroman"], "Hip-Hop", "Rap"),
    (&["macky gee"], "Électronique", "Drum and Bass"),
    (&["protokseed"], "Électronique", "Hardtek"),
    (&["le wanski", "wanski"], "Électronique", "Hardtek"),
    (&["farfacid"], "Électronique", "Hardtek"),
    (&["stakowicz"], "Électronique", "Hardtek"),
    (&["ekinokx"], "Électronique", "Hardtek"),
    (&["bruyant"], "Électronique", "Hardtek"),
    (&["codex", "cødex"], "Électronique", "Hardtek"),
    (&["nujabes"], "Électronique", "Lofi"),
    (&["chase and status", "chase & status"], "Électronique", "Drum and Bass"),
    (&["cesco"], "Électronique", "Drum and Bass"),
    (&["poltergust"], "Électronique", "Hardstyle"),
    (&["dadju"], "R&B", "R&B"),
    (&["gims", "maitre gims", "maître gims"], "Pop", "Pop urbaine"),
    (&["aya nakamura"], "Pop", "Pop urbaine"),
    (&["drake"], "Hip-Hop", "Rap"),
    (&["kendrick lamar", "kendrick"], "Hip-Hop", "Rap"),
    (&["j cole", "j. cole"], "Hip-Hop", "Rap"),
    (&["travis scott"], "Hip-Hop", "Trap"),
    (&["future"], "Hip-Hop", "Trap"),
    (&["metro boomin"], "Hip-Hop", "Trap"),
    (&["21 savage"], "Hip-Hop", "Trap"),
    (&["playboi carti", "carti"], "Hip-Hop", "Rage"),
    (&["ken carson"], "Hip-Hop", "Rage"),
    (&["destroy lonely"], "Hip-Hop", "Rage"),
    (&["yeat"], "Hip-Hop", "Rage"),
    (&["lil uzi vert"], "Hip-Hop", "Trap"),
    (&["young thug"], "Hip-Hop", "Trap"),
    (&["gunna"], "Hip-Hop", "Trap"),
    (&["lil baby"], "Hip-Hop", "Trap"),
    (&["pop smoke"], "Hip-Hop", "Drill"),
    (&["central cee"], "Hip-Hop", "Drill"),
    (&["stormzy"], "Hip-Hop", "Grime"),
    (&["skepta"], "Hip-Hop", "Grime"),
    (&["dizzee rascal"], "Hip-Hop", "Grime"),
    (&["tyler the creator"], "Hip-Hop", "Rap"),
    (&["kanye west", "kanye", "ye"], "Hip-Hop", "Rap"),
    (&["eminem"], "Hip-Hop", "Rap"),
    (&["nas"], "Hip-Hop", "Boom Bap"),
    (&["mf doom"], "Hip-Hop", "Boom Bap"),
    (&["jay-z", "jay z"], "Hip-Hop", "Rap"),
    (&["nicki minaj"], "Hip-Hop", "Rap"),
    (&["cardi b"], "Hip-Hop", "Rap"),
    (&["migos"], "Hip-Hop", "Trap"),
    (&["offset"], "Hip-Hop", "Trap"),
    (&["don toliver"], "Hip-Hop", "Trap"),
    (&["juice wrld", "juice wrlrd"], "Hip-Hop", "Rap"),
    (&["xxx tentacion", "xxxtentacion"], "Hip-Hop", "Rap"),
    (&["lil peep"], "Hip-Hop", "Rap"),
    (&["chief keef"], "Hip-Hop", "Drill"),
    (&["lil durk"], "Hip-Hop", "Drill"),
    (&["ice spice"], "Hip-Hop", "Drill"),
    // Phonk / bass rap
    (&["kordhell"], "Hip-Hop", "Phonk"),
    (&["playa phonk"], "Hip-Hop", "Phonk"),
    (&["dvrst"], "Hip-Hop", "Phonk"),
    (&["moondeity"], "Hip-Hop", "Phonk"),
    (&["kaito shoma"], "Hip-Hop", "Phonk"),
    (&["vladimir cauchemar"], "Électronique", "Electro"),
    (&["yg pablo"], "Hip-Hop", "Rap FR"),
    (&["hooligan chase"], "Hip-Hop", "Rap"),
    (&["alleycvt"], "Électronique", "Dubstep"),
    (&["reaper"], "Électronique", "Dubstep"),
    (&["calivania"], "Électronique", "Dubstep"),
    (&["skone", "sköne"], "Électronique", "Hardtek"),
    (&["knof", "knøf", "knäf", "knaef"], "Électronique", "Hardtek"),
    (&["vortek's", "vorteks"], "Électronique", "Hardtek"),
    (&["teksa"], "Électronique", "Hardtek"),
    (&["spice up!"], "Électronique", "Hardtek"),
    (&["k motionz"], "Électronique", "Drum and Bass"),
    (&["comma dee"], "Électronique", "Drum and Bass"),
    (&["inner circle"], "Reggae", "Reggae"),
    (&["chanceko"], "Hip-Hop", "Rap FR"),
    (&["vibe chemistry"], "Électronique", "Drum and Bass"),
    (&["pete & bas", "pete and bas"], "Hip-Hop", "Grime"),
    (&["jaykae"], "Hip-Hop", "Grime"),
    (&["p money"], "Hip-Hop", "Grime"),
    (&["savage toddy"], "Hip-Hop", "Rap FR"),
    (&["luv resval"], "Hip-Hop", "Rap FR"),
    (&["slap house mafia"], "Électronique", "Slap House"),
    (&["dksh"], "Électronique", "Slap House"),
    (&["expulze"], "Électronique", "Hardcore"),
    (&["narfos"], "Électronique", "Hardcore"),
    (&["madcon"], "Hip-Hop", "Rap"),
    (&["aluna"], "Électronique", "House"),
    (&["di-meh", "di meh"], "Hip-Hop", "Rap FR"),
    (&["rihanna"], "Pop", "Pop"),
    (&["redzed"], "Hip-Hop", "Phonk"),
    (&["dnmo"], "Électronique", "Dubstep"),
    (&["kader diaby", "kader diaby 4real"], "Hip-Hop", "Rap FR"),
    (&["green day"], "Rock", "Punk"),
    (&["wilkinson"], "Électronique", "Drum and Bass"),
    (&["mefjus"], "Électronique", "Drum and Bass"),
    (&["rich the kid"], "Hip-Hop", "Trap"),
    (&["rim'k", "rim k", "rimk"], "Hip-Hop", "Rap FR"),
    (&["asdek"], "Électronique", "Electro"),
    (&["hannibass"], "Électronique", "Hard Bass"),
    (&["hgm"], "Électronique", "Hard Bass"),
    (&["casual"], "Électronique", "Minimal"),
    (&["creeds"], "Électronique", "Hardtechno"),
    (&["young dolph"], "Hip-Hop", "Trap"),
    (&["jumpstreet"], "Électronique", "Drum and Bass"),
    (&["el desperado"], "Électronique", "Hard Bass"),
    (&["matzic"], "Électronique", "Hardstyle"),
    (&["shortround", "short round"], "Électronique", "Bass House"),
    (&["cjdj"], "Électronique", "Bass House"),
    (&["rabteu"], "Électronique", "Hardtek"),
    (&["captaine roshi", "captain roshi"], "Hip-Hop", "Rap FR"),
    (&["songer"], "Hip-Hop", "Grime"),
    (&["mr traumatik"], "Hip-Hop", "Grime"),
    (&["bbygirl"], "Hip-Hop", "Rap"),
    (&["daej phantom"], "Hip-Hop", "Rap FR"),
    (&["wolfy lights"], "Électronique", "Dubstep"),
    (&["emily makis"], "Électronique", "Drum and Bass"),
    (&["radikal moodz"], "Électronique", "Drum and Bass"),
    (&["lauff"], "Électronique", "Slap House"),
    // Électro FR / filter
    (&["daft punk"], "Électronique", "House"),
    (&["justice"], "Électronique", "Electro"),
    (&["cassius"], "Électronique", "House"),
    (&["mr oizo"], "Électronique", "Electro"),
    (&["kavinsky"], "Électronique", "Synthwave"),
    (&["gesaffelstein"], "Électronique", "Techno"),
    (&["madeon"], "Électronique", "EDM"),
    (&["m83"], "Électronique", "Synthwave"),
    (&["the blaze"], "Électronique", "Organic House"),
    (&["c2c"], "Électronique", "Electro"),
    (&["breakbot"], "Électronique", "Nu-Disco"),
    (&["busy p"], "Électronique", "Electro"),
    // Club / house / techno
    (&["fisher"], "Électronique", "Tech House"),
    (&["chris lake"], "Électronique", "Tech House"),
    (&["john summit"], "Électronique", "Tech House"),
    (&["disclosure"], "Électronique", "House"),
    (&["duke dumont"], "Électronique", "House"),
    (&["kaytranada"], "Électronique", "House"),
    (&["fred again", "fred again.."], "Électronique", "UK Garage"),
    (&["overmono"], "Électronique", "UK Garage"),
    (&["bicep"], "Électronique", "Techno"),
    (&["four tet"], "Électronique", "IDM"),
    (&["floating points"], "Électronique", "IDM"),
    (&["amelie lens"], "Électronique", "Techno"),
    (&["charlotte de witte"], "Électronique", "Techno"),
    (&["nina kraviz"], "Électronique", "Techno"),
    (&["boris brejcha"], "Électronique", "Techno"),
    (&["solomun"], "Électronique", "Melodic Techno"),
    (&["anyma"], "Électronique", "Melodic Techno"),
    (&["tale of us"], "Électronique", "Melodic Techno"),
    (&["eric prydz", "pryda", "cirez d"], "Électronique", "Progressive House"),
    (&["deadmau5"], "Électronique", "Progressive House"),
    (&["calvin harris"], "Électronique", "Dance"),
    (&["david guetta"], "Électronique", "Dance"),
    (&["tiesto", "tiësto"], "Électronique", "Trance"),
    (&["armin van buuren"], "Électronique", "Trance"),
    (&["above and beyond"], "Électronique", "Trance"),
    (&["diplo"], "Électronique", "Dance"),
    (&["major lazer"], "Électronique", "Dance"),
    (&["swedish house mafia"], "Électronique", "Dance"),
    (&["avicii"], "Électronique", "EDM"),
    (&["marshmello"], "Électronique", "EDM"),
    (&["the chainsmokers"], "Électronique", "EDM"),
    (&["peggy gou"], "Électronique", "House"),
    (&["interplanetary criminal"], "Électronique", "UK Garage"),
    (&["skream"], "Électronique", "Dubstep"),
    (&["benga"], "Électronique", "Dubstep"),
    (&["burial"], "Électronique", "UK Garage"),
    (&["rusko"], "Électronique", "Dubstep"),
    // Bass / rave
    (&["skrillex"], "Électronique", "Dubstep"),
    (&["excision"], "Électronique", "Dubstep"),
    (&["zomboy"], "Électronique", "Dubstep"),
    (&["subtronics"], "Électronique", "Dubstep"),
    (&["ac slater"], "Électronique", "Bass House"),
    (&["joyryde"], "Électronique", "Bass House"),
    (&["eprom"], "Électronique", "Bass House"),
    (&["noisia"], "Électronique", "Drum and Bass"),
    (&["pendulum"], "Électronique", "Drum and Bass"),
    (&["sub focus"], "Électronique", "Drum and Bass"),
    (&["dimension"], "Électronique", "Drum and Bass"),
    (&["netsky"], "Électronique", "Drum and Bass"),
    (&["high contrast"], "Électronique", "Drum and Bass"),
    (&["goldie"], "Électronique", "Drum and Bass"),
    (&["ltj bukem"], "Électronique", "Drum and Bass"),
    (&["camo & krooked", "camo and krooked"], "Électronique", "Drum and Bass"),
    (&["delta heavy"], "Électronique", "Drum and Bass"),
    (&["culture shock"], "Électronique", "Drum and Bass"),
    (&["infected mushroom"], "Électronique", "Psytrance"),
    (&["headhunterz"], "Électronique", "Hardstyle"),
    (&["wildstylez"], "Électronique", "Hardstyle"),
    (&["da tweekaz"], "Électronique", "Hardstyle"),
    (&["noisecontrollers"], "Électronique", "Hardstyle"),
    (&["radical redemption"], "Électronique", "Hardcore"),
    (&["angerfist"], "Électronique", "Hardcore"),
    (&["dr peacock"], "Électronique", "Frenchcore"),
    (&["korsakoff"], "Électronique", "Hardcore"),
    (&["partyraiser"], "Électronique", "Hardcore"),
    (&["miss k8"], "Électronique", "Hardcore"),
    (&["mad dog"], "Électronique", "Hardcore"),
    (&["scooter"], "Électronique", "Hands Up"),
    (&["die atzen", "atzen", "frau bohm", "manni safe"], "Électronique", "Hands Up"),
    (&["cascada"], "Électronique", "Hands Up"),
    (&["special d"], "Électronique", "Hands Up"),
    (&["tune brothers"], "Électronique", "Hands Up"),
    // IDM / experimental
    (&["aphex twin"], "Électronique", "IDM"),
    (&["autechre"], "Électronique", "IDM"),
    (&["boards of canada"], "Électronique", "IDM"),
    (&["flying lotus"], "Électronique", "IDM"),
    (&["chemical brothers", "the chemical brothers"], "Électronique", "Electro"),
    (&["the prodigy", "prodigy"], "Électronique", "Rave"),
    (&["fatboy slim"], "Électronique", "Breakbeat"),
    (&["basement jaxx"], "Électronique", "House"),
    // Pop / rock
    (&["the weeknd"], "R&B", "R&B"),
    (&["bruno mars"], "Pop", "Pop"),
    (&["dua lipa"], "Pop", "Pop"),
    (&["billie eilish"], "Pop", "Pop"),
    (&["taylor swift"], "Pop", "Pop"),
    (&["ariana grande"], "Pop", "Pop"),
    (&["the beatles"], "Rock", "Rock"),
    (&["queen"], "Rock", "Rock"),
    (&["nirvana"], "Rock", "Rock"),
    (&["radiohead"], "Rock", "Indie"),
    (&["arctic monkeys"], "Rock", "Indie"),
    (&["metallica"], "Rock", "Metal"),
    (&["linkin park"], "Rock", "Nu Metal"),
    (&["system of a down"], "Rock", "Metal"),
    // Reggae / afro / latin
    (&["bob marley"], "Reggae", "Reggae"),
    (&["burna boy"], "Afro", "Afrobeats"),
    (&["wizkid"], "Afro", "Afrobeats"),
    (&["davido"], "Afro", "Afrobeats"),
    (&["temple"], "Afro", "Afrobeats"),
    (&["bad bunny"], "Latin", "Reggaeton"),
    (&["j balvin"], "Latin", "Reggaeton"),
    (&["shakira"], "Latin", "Latin"),
    (&["rosalia", "rosalía"], "Pop", "Pop"),
    // Jazz / soul
    (&["miles davis"], "Jazz", "Jazz"),
    (&["herbie hancock"], "Jazz", "Jazz"),
    (&["amy winehouse"], "Soul", "Soul"),
    (&["stevie wonder"], "Soul", "Soul"),
    (&["anderson paak", "anderson .paak"], "R&B", "R&B"),
];

pub fn nested(parent: &str, sub: &str) -> Placement {
    if parent.eq_ignore_ascii_case(sub) {
        return Placement::from_flat(parent);
    }
    Placement {
        label: format!("{parent} · {sub}"),
        segments: vec![parent.to_string(), sub.to_string()],
    }
}

pub fn placement_for_artist(artist: Option<&str>) -> Option<Placement> {
    let raw = artist?.trim();
    if raw.is_empty() {
        return None;
    }
    crate::knowledge::placement_for(raw).or_else(|| placement_builtin(Some(raw)))
}

/// Dictionnaire interne seulement (sans la base Spotify).
pub fn placement_builtin(artist: Option<&str>) -> Option<Placement> {
    let raw = artist?.trim();
    if raw.is_empty() {
        return None;
    }
    let mut best: Option<(usize, Placement)> = None;
    for cand in artist_candidates(raw) {
        let key = norm(&cand);
        if key.is_empty() {
            continue;
        }
        if let Some(p) = lookup_in(&key) {
            let score = key.len();
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, p));
            }
        }
    }
    best.map(|(_, p)| p)
}

/// Cherche un artiste connu dans titre / fichier (dumps YouTube « Vald - … »).
pub fn placement_for_text(haystack: &str) -> Option<Placement> {
    if let Some(p) = crate::knowledge::placement_in_text(haystack) {
        return Some(p);
    }
    let text = format!(" {} ", norm(haystack));
    let mut best: Option<(usize, Placement)> = None;
    for (aliases, parent, sub) in ARTISTS {
        for alias in *aliases {
            let key = norm(alias);
            if key.is_empty() || is_generic_token(&key) {
                continue;
            }
            let needle = format!(" {key} ");
            if text.contains(&needle) {
                let score = key.len();
                if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                    best = Some((score, nested(parent, sub)));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

pub(crate) fn is_generic_token(key: &str) -> bool {
    matches!(
        key,
        "future"
            | "justice"
            | "offset"
            | "queen"
            | "dimension"
            | "fisher"
            | "freeze"
            | "burial"
            | "goldie"
            | "prodigy"
            | "uzi"
            | "ye"
            | "nas"
            | "jul"
            | "sch"
            | "plk"
            | "pnl"
            | "sdm"
            | "maes"
            | "leto"
            | "shay"
            | "hamza"
            | "kalash"
            | "gazo"
            | "roshi"
            | "atzen"
            | "temple"
            | "wave"
            | "casual"
            | "flow"
            | "reaper"
            | "iam"
            | "cesco"
            | "wanski"
            | "bruyant"
            | "codex"
    )
}

fn lookup_in(normalized_artist: &str) -> Option<Placement> {
    let padded = format!(" {normalized_artist} ");
    let mut best: Option<(usize, Placement)> = None;
    for (aliases, parent, sub) in ARTISTS {
        for alias in *aliases {
            let key = norm(alias);
            if key.is_empty() {
                continue;
            }
            if normalized_artist == key || padded.contains(&format!(" {key} ")) {
                let score = key.len();
                if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                    best = Some((score, nested(parent, sub)));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

/// Tous les noms exploitables d'un tag artiste (virgules, feat, ft…).
pub(crate) fn artist_candidates(raw: &str) -> Vec<String> {
    let mut name = raw.trim().to_string();
    for suffix in [" - Topic", " - topic", " Official", " Officiel", " VEVO", " Vevo"] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            name = stripped.trim().to_string();
        }
    }
    let mut out = vec![name.clone()];
    for part in name.split([',', ';', '/', '|']) {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        out.push(p.to_string());
        let lower = p.to_ascii_lowercase();
        for marker in [" feat. ", " feat ", " ft. ", " ft ", " featuring ", " with "] {
            if let Some(idx) = lower.find(marker) {
                let left = p[..idx].trim();
                let right = p[idx + marker.len()..].trim();
                if !left.is_empty() {
                    out.push(left.to_string());
                }
                if !right.is_empty() {
                    out.push(right.to_string());
                }
            }
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.len()));
    out.dedup();
    out
}

pub fn norm(s: &str) -> String {
    s.to_lowercase()
        .replace('é', "e")
        .replace('è', "e")
        .replace('ê', "e")
        .replace('ë', "e")
        .replace('à', "a")
        .replace('â', "a")
        .replace('ä', "a")
        .replace('ù', "u")
        .replace('û', "u")
        .replace('ü', "u")
        .replace('ô', "o")
        .replace('ö', "o")
        .replace('ø', "o")
        .replace('î', "i")
        .replace('ï', "i")
        .replace('ç', "c")
        .replace('ñ', "n")
        .replace('&', " and ")
        .replace(',', " ")
        .replace(';', " ")
        .replace('/', " ")
        .replace('|', " ")
        .replace('+', " ")
        .replace('-', " ")
        .replace('_', " ")
        .replace('.', " ")
        .replace('\'', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vald_is_rap_fr() {
        let p = placement_for_artist(Some("Vald")).unwrap();
        assert_eq!(p.segments, vec!["Hip-Hop".to_string(), "Rap FR".to_string()]);
    }

    #[test]
    fn atzen_in_title() {
        let p = placement_for_text("BALLERN - Die Atzen").unwrap();
        assert_eq!(p.segments.last().unwrap(), "Hands Up");
    }

    #[test]
    fn ignores_missing() {
        assert!(placement_for_artist(None).is_none());
        assert!(placement_for_artist(Some("")).is_none());
    }

    #[test]
    fn comma_separated_artists() {
        let p = placement_for_artist(Some("Chris Lake,Aluna")).unwrap();
        assert_eq!(p.segments.last().unwrap(), "Tech House");
    }

    #[test]
    fn feat_and_typo_roshi() {
        let p = placement_for_artist(Some("Vladimir Cauchemar,Roshi")).unwrap();
        assert_eq!(p.segments[0], "Électronique");
        let t = placement_for_text("01 Avenue - feat. Captaine Roshi");
        assert!(t.is_some());
    }

    #[test]
    fn die_atzen_tag() {
        let p = placement_for_artist(Some("Die Atzen")).unwrap();
        assert_eq!(p.segments.last().unwrap(), "Hands Up");
    }

    #[test]
    fn camo_and_krooked_kept() {
        let p = placement_for_artist(Some("The Prodigy,Mefjus,Camo & Krooked")).unwrap();
        assert_eq!(p.segments.last().unwrap(), "Drum and Bass");
    }

    #[test]
    fn knaef_umlaut_matches_hardtek() {
        let p = placement_for_artist(Some("KNÄF")).unwrap();
        assert_eq!(p.segments.last().unwrap(), "Hardtek");
    }

    #[test]
    fn alkpote_is_rap_fr() {
        let p = placement_builtin(Some("Alkpote")).unwrap();
        assert_eq!(p.segments.last().unwrap(), "Rap FR");
    }

    #[test]
    fn columbine_is_rap_fr() {
        let p = placement_builtin(Some("Columbine")).unwrap();
        assert_eq!(p.segments.last().unwrap(), "Rap FR");
    }
}
