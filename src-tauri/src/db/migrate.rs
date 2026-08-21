//! Import one-shot des JSON disque (knowledge, auth, genre-cache) vers SQLite.

use crate::db::{meta_get, meta_set};
use crate::knowledge::Knowledge;
use crate::profile_store;
use rusqlite::Connection;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};

#[derive(Deserialize, Default)]
struct DiskGenreCache {
    artists: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyAuthJson {
    client_id: String,
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    display_name: Option<String>,
    avatar_url: Option<String>,
}

/// Importe fichiers app_data déjà présents. Idempotent si `disk_imported_v1` est posé.
pub fn import_disk_legacy(app: &AppHandle, conn: &Connection) -> Result<bool, String> {
    if meta_get(conn, "disk_imported_v1")?.as_deref() == Some("1") {
        return Ok(false);
    }

    import_genre_cache(app, conn)?;
    import_knowledge_and_auth(app, conn)?;

    meta_set(conn, "disk_imported_v1", "1")?;
    Ok(true)
}

fn import_genre_cache(app: &AppHandle, conn: &Connection) -> Result<(), String> {
    let Some(dir) = app.path().app_data_dir().ok() else {
        return Ok(());
    };
    let path = dir.join("genre-cache.json");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Ok(());
    };
    let cache: DiskGenreCache = serde_json::from_str(&raw).unwrap_or_default();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO genre_cache (artist_key, genre) VALUES (?1, ?2)
                 ON CONFLICT(artist_key) DO UPDATE SET genre = excluded.genre",
            )
            .map_err(|e| e.to_string())?;
        for (key, genre) in &cache.artists {
            stmt.execute(rusqlite::params![key, genre])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    let bak = dir.join("genre-cache.json.bak");
    let _ = std::fs::rename(&path, &bak);
    Ok(())
}

fn import_knowledge_and_auth(app: &AppHandle, conn: &Connection) -> Result<(), String> {
    let Some(dir) = app.path().app_data_dir().ok() else {
        return Ok(());
    };

    // Fichier global legacy
    try_import_knowledge_file(
        conn,
        &dir.join("knowledge.json"),
        "legacy",
    )?;
    try_import_auth_file(conn, &dir.join("spotify-auth.json"), "legacy")?;

    // Par profil
    let knowledge_dir = dir.join("knowledge");
    if let Ok(entries) = std::fs::read_dir(&knowledge_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            try_import_knowledge_file(conn, &path, stem)?;
            let bak = path.with_extension("json.bak");
            let _ = std::fs::rename(&path, &bak);
        }
    }

    let auth_dir = dir.join("spotify-auth");
    if let Ok(entries) = std::fs::read_dir(&auth_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            try_import_auth_file(conn, &path, stem)?;
            let bak = path.with_extension("json.bak");
            let _ = std::fs::rename(&path, &bak);
        }
    }

    // Marqueur profil actif
    if let Some(id) = profile_store::active_profile_id() {
        let _ = conn.execute(
            "UPDATE spotify_profiles SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END",
            [&id],
        );
    }

    Ok(())
}

fn try_import_knowledge_file(
    conn: &Connection,
    path: &std::path::Path,
    profile_id: &str,
) -> Result<(), String> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Ok(());
    };
    let Ok(knowledge) = serde_json::from_str::<Knowledge>(&raw) else {
        return Ok(());
    };
    save_knowledge_to_conn(conn, profile_id, &knowledge)?;
    if path.file_name().and_then(|n| n.to_str()) == Some("knowledge.json") {
        let bak = path.with_extension("json.bak");
        let _ = std::fs::rename(path, bak);
    }
    Ok(())
}

fn try_import_auth_file(
    conn: &Connection,
    path: &std::path::Path,
    profile_id: &str,
) -> Result<(), String> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Ok(());
    };
    let Ok(auth) = serde_json::from_str::<SpotifyAuthJson>(&raw) else {
        return Ok(());
    };

    // Crée un profil minimal si absent (user_id = '')
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM spotify_profiles WHERE id = ?1",
            [profile_id],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if !exists {
        let access = crate::secret_box::seal(&auth.access_token)?;
        let refresh = crate::secret_box::seal(&auth.refresh_token)?;
        conn.execute(
            "INSERT INTO spotify_profiles (
                id, user_id, name, client_id, created_at, last_used_at,
                display_name, avatar_url, access_token, refresh_token, expires_at, is_active
             ) VALUES (?1, '', 'Spotify', ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
            rusqlite::params![
                profile_id,
                auth.client_id,
                chrono_now_ms(),
                auth.display_name,
                auth.avatar_url,
                access,
                refresh,
                auth.expires_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let access = crate::secret_box::seal(&auth.access_token)?;
        let refresh = crate::secret_box::seal(&auth.refresh_token)?;
        conn.execute(
            "UPDATE spotify_profiles SET
                client_id = ?2,
                access_token = ?3,
                refresh_token = ?4,
                expires_at = ?5,
                display_name = COALESCE(?6, display_name),
                avatar_url = COALESCE(?7, avatar_url)
             WHERE id = ?1",
            rusqlite::params![
                profile_id,
                auth.client_id,
                access,
                refresh,
                auth.expires_at,
                auth.display_name,
                auth.avatar_url,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    if path.file_name().and_then(|n| n.to_str()) == Some("spotify-auth.json") {
        let bak = path.with_extension("json.bak");
        let _ = std::fs::rename(path, bak);
    }
    Ok(())
}

pub fn save_knowledge_to_conn(
    conn: &Connection,
    profile_id: &str,
    knowledge: &Knowledge,
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO knowledge_meta (profile_id, version, synced_at, display_name, liked_count)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(profile_id) DO UPDATE SET
           version = excluded.version,
           synced_at = excluded.synced_at,
           display_name = excluded.display_name,
           liked_count = excluded.liked_count",
        rusqlite::params![
            profile_id,
            knowledge.version as i64,
            knowledge.synced_at,
            knowledge.display_name,
            knowledge.liked_count as i64,
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM knowledge_artists WHERE profile_id = ?1",
        [profile_id],
    )
    .map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO knowledge_artists (
                    profile_id, artist_key, name, spotify_id, likes, raw_genres, parent, sub
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .map_err(|e| e.to_string())?;
        for (key, artist) in &knowledge.artists {
            let raw = serde_json::to_string(&artist.raw_genres).unwrap_or_else(|_| "[]".into());
            stmt.execute(rusqlite::params![
                profile_id,
                key,
                artist.name,
                artist.spotify_id,
                artist.likes as i64,
                raw,
                artist.parent,
                artist.sub,
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_knowledge_from_conn(
    conn: &Connection,
    profile_id: &str,
) -> Result<Knowledge, String> {
    use crate::knowledge::KnowledgeArtist;
    use std::collections::HashMap;

    let meta = conn
        .query_row(
            "SELECT version, synced_at, display_name, liked_count
             FROM knowledge_meta WHERE profile_id = ?1",
            [profile_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .ok();

    let mut artists: HashMap<String, KnowledgeArtist> = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT artist_key, name, spotify_id, likes, raw_genres, parent, sub
             FROM knowledge_artists WHERE profile_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([profile_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (key, name, spotify_id, likes, raw, parent, sub) = row.map_err(|e| e.to_string())?;
        let raw_genres: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
        artists.insert(
            key,
            KnowledgeArtist {
                name,
                spotify_id,
                likes: likes as u32,
                raw_genres,
                parent,
                sub,
            },
        );
    }

    Ok(match meta {
        Some((version, synced_at, display_name, liked_count)) => Knowledge {
            version: version as u32,
            synced_at,
            display_name,
            liked_count: liked_count as usize,
            artists,
        },
        None => Knowledge {
            version: 1,
            synced_at: None,
            display_name: None,
            liked_count: 0,
            artists,
        },
    })
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Fusionne les profils dupliqués (même Client ID) et rattache auth/knowledge « legacy ».
pub fn heal_spotify_profiles(conn: &Connection) -> Result<(), String> {
    if meta_get(conn, "spotify_profiles_healed_v1")?.as_deref() == Some("1") {
        // Toujours dédupliquer (peut revenir après un bug front) — léger.
    }

    merge_duplicate_client_ids(conn)?;
    absorb_legacy_into_best(conn)?;

    meta_set(conn, "spotify_profiles_healed_v1", "1")?;
    Ok(())
}

fn merge_duplicate_client_ids(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT client_id FROM spotify_profiles
             WHERE client_id IS NOT NULL AND length(trim(client_id)) > 0 AND id != 'legacy'
             GROUP BY lower(trim(client_id))
             HAVING COUNT(*) > 1",
        )
        .map_err(|e| e.to_string())?;
    let client_ids: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    for client_id in client_ids {
        let mut stmt = conn
            .prepare(
                "SELECT id,
                        CASE WHEN refresh_token IS NOT NULL AND length(refresh_token) > 0 THEN 1 ELSE 0 END,
                        COALESCE(liked_count, 0),
                        COALESCE(created_at, 0)
                 FROM spotify_profiles
                 WHERE lower(trim(client_id)) = lower(trim(?1)) AND id != 'legacy'
                 ORDER BY
                   CASE WHEN refresh_token IS NOT NULL AND length(refresh_token) > 0 THEN 0 ELSE 1 END,
                   COALESCE(liked_count, 0) DESC,
                   COALESCE(created_at, 0) ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, i64, i64, i64)> = stmt
            .query_map([&client_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);

        let Some((keeper, _, _, _)) = rows.first() else {
            continue;
        };
        let keeper = keeper.clone();
        for (loser, has_refresh, liked, _) in rows.into_iter().skip(1) {
            // Récupère tokens du loser si le keeper n’en a pas
            if has_refresh > 0 {
                let keeper_has: i64 = conn
                    .query_row(
                        "SELECT CASE WHEN refresh_token IS NOT NULL AND length(refresh_token) > 0 THEN 1 ELSE 0 END
                         FROM spotify_profiles WHERE id = ?1",
                        [&keeper],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);
                if keeper_has == 0 {
                    let _ = conn.execute(
                        "UPDATE spotify_profiles SET
                           access_token = (SELECT access_token FROM spotify_profiles WHERE id = ?2),
                           refresh_token = (SELECT refresh_token FROM spotify_profiles WHERE id = ?2),
                           expires_at = (SELECT expires_at FROM spotify_profiles WHERE id = ?2),
                           display_name = COALESCE(display_name, (SELECT display_name FROM spotify_profiles WHERE id = ?2)),
                           avatar_url = COALESCE(avatar_url, (SELECT avatar_url FROM spotify_profiles WHERE id = ?2))
                         WHERE id = ?1",
                        rusqlite::params![keeper, loser],
                    );
                }
            }
            // Knowledge : déplace si keeper vide
            let keeper_artists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM knowledge_artists WHERE profile_id = ?1",
                    [&keeper],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            if keeper_artists == 0 {
                let _ = conn.execute(
                    "UPDATE knowledge_artists SET profile_id = ?1 WHERE profile_id = ?2",
                    rusqlite::params![keeper, loser],
                );
                let _ = conn.execute(
                    "INSERT INTO knowledge_meta (profile_id, version, synced_at, display_name, liked_count)
                     SELECT ?1, version, synced_at, display_name, liked_count FROM knowledge_meta WHERE profile_id = ?2
                     ON CONFLICT(profile_id) DO UPDATE SET
                       synced_at = COALESCE(excluded.synced_at, knowledge_meta.synced_at),
                       display_name = COALESCE(excluded.display_name, knowledge_meta.display_name),
                       liked_count = MAX(excluded.liked_count, knowledge_meta.liked_count)",
                    rusqlite::params![keeper, loser],
                );
            }
            if liked > 0 {
                let _ = conn.execute(
                    "UPDATE spotify_profiles SET
                       liked_count = MAX(liked_count, ?2),
                       artist_count = MAX(artist_count, (SELECT artist_count FROM spotify_profiles WHERE id = ?3)),
                       group_count = MAX(group_count, (SELECT group_count FROM spotify_profiles WHERE id = ?3)),
                       last_synced_at = COALESCE(last_synced_at, (SELECT last_synced_at FROM spotify_profiles WHERE id = ?3))
                     WHERE id = ?1",
                    rusqlite::params![keeper, liked, loser],
                );
            }
            let _ = conn.execute(
                "UPDATE spotify_imports SET profile_id = ?1 WHERE profile_id = ?2",
                rusqlite::params![keeper, loser],
            );
            let _ = conn.execute("DELETE FROM knowledge_artists WHERE profile_id = ?1", [&loser]);
            let _ = conn.execute("DELETE FROM knowledge_meta WHERE profile_id = ?1", [&loser]);
            let _ = conn.execute("DELETE FROM spotify_profiles WHERE id = ?1", [&loser]);
        }
        let _ = conn.execute(
            "UPDATE spotify_profiles SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END
             WHERE lower(trim(client_id)) = lower(trim(?2))",
            rusqlite::params![keeper, client_id],
        );
    }
    Ok(())
}

fn absorb_legacy_into_best(conn: &Connection) -> Result<(), String> {
    let legacy_has_auth: bool = conn
        .query_row(
            "SELECT CASE WHEN refresh_token IS NOT NULL AND length(refresh_token) > 0 THEN 1 ELSE 0 END
             FROM spotify_profiles WHERE id = 'legacy'",
            [],
            |row| row.get::<_, i64>(0).map(|v| v > 0),
        )
        .unwrap_or(false);
    let legacy_artists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM knowledge_artists WHERE profile_id = 'legacy'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if !legacy_has_auth && legacy_artists == 0 {
        return Ok(());
    }

    let target: Option<String> = conn
        .query_row(
            "SELECT id FROM spotify_profiles
             WHERE id != 'legacy'
             ORDER BY
               CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
               COALESCE(liked_count, 0) DESC,
               last_used_at DESC
             LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    let Some(target) = target else {
        return Ok(());
    };

    if legacy_has_auth {
        let target_has: i64 = conn
            .query_row(
                "SELECT CASE WHEN refresh_token IS NOT NULL AND length(refresh_token) > 0 THEN 1 ELSE 0 END
                 FROM spotify_profiles WHERE id = ?1",
                [&target],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if target_has == 0 {
            let _ = conn.execute(
                "UPDATE spotify_profiles SET
                   access_token = (SELECT access_token FROM spotify_profiles WHERE id = 'legacy'),
                   refresh_token = (SELECT refresh_token FROM spotify_profiles WHERE id = 'legacy'),
                   expires_at = (SELECT expires_at FROM spotify_profiles WHERE id = 'legacy'),
                   client_id = CASE WHEN length(trim(client_id)) > 0 THEN client_id
                     ELSE (SELECT client_id FROM spotify_profiles WHERE id = 'legacy') END,
                   display_name = COALESCE(display_name, (SELECT display_name FROM spotify_profiles WHERE id = 'legacy')),
                   avatar_url = COALESCE(avatar_url, (SELECT avatar_url FROM spotify_profiles WHERE id = 'legacy'))
                 WHERE id = ?1",
                [&target],
            );
        }
    }

    if legacy_artists > 0 {
        let target_artists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM knowledge_artists WHERE profile_id = ?1",
                [&target],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if target_artists == 0 {
            let _ = conn.execute(
                "UPDATE knowledge_artists SET profile_id = ?1 WHERE profile_id = 'legacy'",
                [&target],
            );
            let _ = conn.execute(
                "INSERT INTO knowledge_meta (profile_id, version, synced_at, display_name, liked_count)
                 SELECT ?1, version, synced_at, display_name, liked_count FROM knowledge_meta WHERE profile_id = 'legacy'
                 ON CONFLICT(profile_id) DO UPDATE SET
                   synced_at = COALESCE(excluded.synced_at, knowledge_meta.synced_at),
                   display_name = COALESCE(excluded.display_name, knowledge_meta.display_name),
                   liked_count = MAX(excluded.liked_count, knowledge_meta.liked_count)",
                [&target],
            );
        }
    }

    let _ = conn.execute("DELETE FROM knowledge_artists WHERE profile_id = 'legacy'", []);
    let _ = conn.execute("DELETE FROM knowledge_meta WHERE profile_id = 'legacy'", []);
    let _ = conn.execute("DELETE FROM spotify_profiles WHERE id = 'legacy'", []);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE spotify_profiles (
               id TEXT PRIMARY KEY,
               user_id TEXT NOT NULL DEFAULT '',
               name TEXT NOT NULL,
               client_id TEXT NOT NULL,
               created_at INTEGER,
               last_used_at INTEGER,
               display_name TEXT,
               avatar_url TEXT,
               last_synced_at INTEGER,
               liked_count INTEGER DEFAULT 0,
               artist_count INTEGER DEFAULT 0,
               group_count INTEGER DEFAULT 0,
               access_token TEXT,
               refresh_token TEXT,
               expires_at INTEGER,
               is_active INTEGER DEFAULT 0
             );
             CREATE TABLE knowledge_meta (
               profile_id TEXT PRIMARY KEY,
               version INTEGER,
               synced_at TEXT,
               display_name TEXT,
               liked_count INTEGER
             );
             CREATE TABLE knowledge_artists (
               profile_id TEXT NOT NULL,
               artist_key TEXT NOT NULL,
               name TEXT,
               spotify_id TEXT,
               likes INTEGER,
               raw_genres TEXT,
               parent TEXT,
               sub TEXT,
               PRIMARY KEY (profile_id, artist_key)
             );
             CREATE TABLE spotify_imports (
               id TEXT PRIMARY KEY,
               profile_id TEXT
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn heal_merges_duplicate_client_ids_keeping_tokens() {
        let conn = setup();
        conn.execute(
            "INSERT INTO spotify_profiles (id, user_id, name, client_id, created_at, last_used_at, liked_count, refresh_token, is_active)
             VALUES ('old', 'u1', 'Mr Anderson', 'abc', 1, 1, 2530, 'refresh-secret', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO spotify_profiles (id, user_id, name, client_id, created_at, last_used_at, liked_count, refresh_token, is_active)
             VALUES ('new', 'u1', 'Mr Anderson', 'abc', 2, 2, 0, NULL, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO knowledge_artists (profile_id, artist_key, name, likes, raw_genres, parent, sub)
             VALUES ('old', 'a1', 'Artist', 3, '[]', 'Electronic', 'Techno')",
            [],
        )
        .unwrap();

        heal_spotify_profiles(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM spotify_profiles", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let (id, refresh, liked): (String, Option<String>, i64) = conn
            .query_row(
                "SELECT id, refresh_token, liked_count FROM spotify_profiles",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(id, "old");
        assert_eq!(refresh.as_deref(), Some("refresh-secret"));
        assert_eq!(liked, 2530);
        let artists: i64 = conn
            .query_row("SELECT COUNT(*) FROM knowledge_artists WHERE profile_id = 'old'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(artists, 1);
    }
}
