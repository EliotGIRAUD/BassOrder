use crate::error::{ApiError, ApiResult};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &str) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode=WAL;
            PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS accounts (
              id TEXT PRIMARY KEY NOT NULL,
              email TEXT NOT NULL UNIQUE,
              password_hash TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS oauth_identities (
              provider TEXT NOT NULL,
              subject TEXT NOT NULL,
              account_id TEXT NOT NULL,
              PRIMARY KEY (provider, subject),
              FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS refresh_tokens (
              id TEXT PRIMARY KEY NOT NULL,
              account_id TEXT NOT NULL,
              token_hash TEXT NOT NULL UNIQUE,
              expires_at INTEGER NOT NULL,
              revoked INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS knowledge_mirrors (
              account_id TEXT NOT NULL,
              profile_id TEXT NOT NULL,
              version INTEGER NOT NULL DEFAULT 1,
              synced_at TEXT,
              display_name TEXT,
              liked_count INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (account_id, profile_id),
              FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS knowledge_mirror_artists (
              account_id TEXT NOT NULL,
              profile_id TEXT NOT NULL,
              artist_key TEXT NOT NULL,
              name TEXT NOT NULL,
              spotify_id TEXT NOT NULL DEFAULT '',
              likes INTEGER NOT NULL DEFAULT 0,
              raw_genres TEXT NOT NULL DEFAULT '[]',
              parent TEXT NOT NULL DEFAULT '',
              sub TEXT NOT NULL DEFAULT '',
              updated_at TEXT NOT NULL,
              PRIMARY KEY (account_id, profile_id, artist_key),
              FOREIGN KEY (account_id, profile_id)
                REFERENCES knowledge_mirrors(account_id, profile_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_kma_artist
              ON knowledge_mirror_artists(artist_key);
            CREATE INDEX IF NOT EXISTS idx_kma_parent
              ON knowledge_mirror_artists(parent);
            "#,
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn with<T>(&self, f: impl FnOnce(&Connection) -> ApiResult<T>) -> ApiResult<T> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| ApiError::Internal("db lock".into()))?;
        f(&guard)
    }

    pub fn create_account(&self, id: &str, email: &str, password_hash: Option<&str>) -> ApiResult<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?1,?2,?3,?4)",
                params![id, email, password_hash, chrono_now()],
            )
            .map_err(|e| {
                // Message volontairement générique (anti-énumération d’emails).
                if e.to_string().contains("UNIQUE") {
                    ApiError::BadRequest("Impossible de créer ce compte.".into())
                } else {
                    ApiError::Internal(e.to_string())
                }
            })?;
            Ok(())
        })
    }

    pub fn find_by_email(&self, email: &str) -> ApiResult<Option<AccountRow>> {
        self.with(|conn| {
            conn.query_row(
                "SELECT id, email, password_hash, created_at FROM accounts WHERE email = ?1",
                [email],
                |row| {
                    Ok(AccountRow {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        password_hash: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|e| ApiError::Internal(e.to_string()))
        })
    }

    pub fn find_by_id(&self, id: &str) -> ApiResult<Option<AccountRow>> {
        self.with(|conn| {
            conn.query_row(
                "SELECT id, email, password_hash, created_at FROM accounts WHERE id = ?1",
                [id],
                |row| {
                    Ok(AccountRow {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        password_hash: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|e| ApiError::Internal(e.to_string()))
        })
    }

    pub fn store_refresh(&self, id: &str, account_id: &str, token_hash: &str, expires_at: i64) -> ApiResult<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO refresh_tokens (id, account_id, token_hash, expires_at, revoked)
                 VALUES (?1,?2,?3,?4,0)",
                params![id, account_id, token_hash, expires_at],
            )
            .map_err(|e| ApiError::Internal(e.to_string()))?;
            Ok(())
        })
    }

    pub fn take_refresh(&self, token_hash: &str) -> ApiResult<Option<RefreshRow>> {
        self.with(|conn| {
            let row = conn
                .query_row(
                    "SELECT id, account_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = ?1",
                    [token_hash],
                    |row| {
                        Ok(RefreshRow {
                            id: row.get(0)?,
                            account_id: row.get(1)?,
                            expires_at: row.get(2)?,
                            revoked: row.get::<_, i64>(3)? != 0,
                        })
                    },
                )
                .optional()
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            if let Some(ref r) = row {
                conn.execute(
                    "UPDATE refresh_tokens SET revoked = 1 WHERE id = ?1",
                    [&r.id],
                )
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            }
            Ok(row)
        })
    }

    pub fn revoke_refresh_hash(&self, token_hash: &str) -> ApiResult<()> {
        self.with(|conn| {
            conn.execute(
                "UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?1",
                [token_hash],
            )
            .map_err(|e| ApiError::Internal(e.to_string()))?;
            Ok(())
        })
    }

    /// Révoque tous les refresh tokens d’un compte (déconnexion globale / reuse detection).
    pub fn revoke_all_refresh_for_account(&self, account_id: &str) -> ApiResult<u64> {
        self.with(|conn| {
            let n = conn
                .execute(
                    "UPDATE refresh_tokens SET revoked = 1
                     WHERE account_id = ?1 AND revoked = 0",
                    [account_id],
                )
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            Ok(n as u64)
        })
    }

    pub fn upsert_oauth(
        &self,
        provider: &str,
        subject: &str,
        account_id: &str,
    ) -> ApiResult<()> {
        self.with(|conn| {
            conn.execute(
                "INSERT INTO oauth_identities (provider, subject, account_id) VALUES (?1,?2,?3)
                 ON CONFLICT(provider, subject) DO UPDATE SET account_id = excluded.account_id",
                params![provider, subject, account_id],
            )
            .map_err(|e| ApiError::Internal(e.to_string()))?;
            Ok(())
        })
    }

    pub fn find_oauth(&self, provider: &str, subject: &str) -> ApiResult<Option<String>> {
        self.with(|conn| {
            conn.query_row(
                "SELECT account_id FROM oauth_identities WHERE provider = ?1 AND subject = ?2",
                params![provider, subject],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| ApiError::Internal(e.to_string()))
        })
    }

    /// Remplace le miroir knowledge d’un compte pour un profil Spotify.
    /// Ne conserve que les artistes avec `parent` non vide.
    pub fn put_knowledge_mirror(
        &self,
        account_id: &str,
        profile_id: &str,
        version: i64,
        synced_at: Option<&str>,
        display_name: Option<&str>,
        liked_count: i64,
        artists: &[MirrorArtistRow],
    ) -> ApiResult<usize> {
        self.with(|conn| {
            let now = chrono_now();
            let tx = conn
                .unchecked_transaction()
                .map_err(|e| ApiError::Internal(e.to_string()))?;

            tx.execute(
                "INSERT INTO knowledge_mirrors (
                    account_id, profile_id, version, synced_at, display_name, liked_count, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(account_id, profile_id) DO UPDATE SET
                   version = excluded.version,
                   synced_at = excluded.synced_at,
                   display_name = excluded.display_name,
                   liked_count = excluded.liked_count,
                   updated_at = excluded.updated_at",
                params![
                    account_id,
                    profile_id,
                    version,
                    synced_at,
                    display_name,
                    liked_count,
                    now
                ],
            )
            .map_err(|e| ApiError::Internal(e.to_string()))?;

            tx.execute(
                "DELETE FROM knowledge_mirror_artists
                 WHERE account_id = ?1 AND profile_id = ?2",
                params![account_id, profile_id],
            )
            .map_err(|e| ApiError::Internal(e.to_string()))?;

            let mut inserted = 0usize;
            {
                let mut stmt = tx
                    .prepare(
                        "INSERT INTO knowledge_mirror_artists (
                            account_id, profile_id, artist_key, name, spotify_id,
                            likes, raw_genres, parent, sub, updated_at
                         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                    )
                    .map_err(|e| ApiError::Internal(e.to_string()))?;
                for a in artists {
                    if a.parent.trim().is_empty() {
                        continue;
                    }
                    let raw = if a.raw_genres.trim().is_empty() {
                        "[]"
                    } else {
                        a.raw_genres.as_str()
                    };
                    stmt.execute(params![
                        account_id,
                        profile_id,
                        a.artist_key,
                        a.name,
                        a.spotify_id,
                        a.likes,
                        raw,
                        a.parent,
                        a.sub,
                        now
                    ])
                    .map_err(|e| ApiError::Internal(e.to_string()))?;
                    inserted += 1;
                }
            }

            tx.commit()
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            Ok(inserted)
        })
    }

    pub fn get_knowledge_mirror(
        &self,
        account_id: &str,
        profile_id: &str,
    ) -> ApiResult<Option<MirrorBundle>> {
        self.with(|conn| {
            let meta = conn
                .query_row(
                    "SELECT version, synced_at, display_name, liked_count, updated_at
                     FROM knowledge_mirrors
                     WHERE account_id = ?1 AND profile_id = ?2",
                    params![account_id, profile_id],
                    |row| {
                        Ok(MirrorMeta {
                            version: row.get(0)?,
                            synced_at: row.get(1)?,
                            display_name: row.get(2)?,
                            liked_count: row.get(3)?,
                            updated_at: row.get(4)?,
                        })
                    },
                )
                .optional()
                .map_err(|e| ApiError::Internal(e.to_string()))?;

            let Some(meta) = meta else {
                return Ok(None);
            };

            let mut stmt = conn
                .prepare(
                    "SELECT artist_key, name, spotify_id, likes, raw_genres, parent, sub
                     FROM knowledge_mirror_artists
                     WHERE account_id = ?1 AND profile_id = ?2",
                )
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let rows = stmt
                .query_map(params![account_id, profile_id], |row| {
                    Ok(MirrorArtistRow {
                        artist_key: row.get(0)?,
                        name: row.get(1)?,
                        spotify_id: row.get(2)?,
                        likes: row.get(3)?,
                        raw_genres: row.get(4)?,
                        parent: row.get(5)?,
                        sub: row.get(6)?,
                    })
                })
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            let artists = rows
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            Ok(Some(MirrorBundle { meta, artists }))
        })
    }

    /// Consensus pool : (parent, sub) majoritaire par artiste, tie-break SUM(min(likes, cap)).
    /// `min_votes` : quorum anti-Sybil (défaut 2 côté AppState).
    pub fn knowledge_pool(
        &self,
        keys: Option<&[String]>,
        limit: i64,
        min_votes: i64,
        likes_cap: i64,
    ) -> ApiResult<Vec<PoolEntryRow>> {
        let min_votes = min_votes.max(1);
        let likes_cap = likes_cap.clamp(1, 10_000);
        self.with(|conn| {
            let sql = if keys.map(|k| !k.is_empty()).unwrap_or(false) {
                let placeholders = keys
                    .unwrap()
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(",");
                // Params: keys…, likes_cap, min_votes, limit
                let n_keys = keys.unwrap().len();
                format!(
                    "WITH tallies AS (
                       SELECT artist_key, parent, sub,
                              COUNT(DISTINCT account_id) AS votes,
                              SUM(MIN(likes, ?{cap})) AS weight
                       FROM knowledge_mirror_artists
                       WHERE parent != '' AND artist_key IN ({placeholders})
                       GROUP BY artist_key, parent, sub
                       HAVING votes >= ?{min}
                     ),
                     ranked AS (
                       SELECT artist_key, parent, sub, votes, weight,
                              ROW_NUMBER() OVER (
                                PARTITION BY artist_key
                                ORDER BY votes DESC, weight DESC
                              ) AS rn
                       FROM tallies
                     )
                     SELECT artist_key, parent, sub, votes, weight
                     FROM ranked WHERE rn = 1
                     LIMIT ?{lim}",
                    placeholders = placeholders,
                    cap = n_keys + 1,
                    min = n_keys + 2,
                    lim = n_keys + 3,
                )
            } else {
                // Params: likes_cap, min_votes, limit
                "WITH tallies AS (
                       SELECT artist_key, parent, sub,
                              COUNT(DISTINCT account_id) AS votes,
                              SUM(MIN(likes, ?1)) AS weight
                       FROM knowledge_mirror_artists
                       WHERE parent != ''
                       GROUP BY artist_key, parent, sub
                       HAVING votes >= ?2
                     ),
                     ranked AS (
                       SELECT artist_key, parent, sub, votes, weight,
                              ROW_NUMBER() OVER (
                                PARTITION BY artist_key
                                ORDER BY votes DESC, weight DESC
                              ) AS rn
                       FROM tallies
                     )
                     SELECT artist_key, parent, sub, votes, weight
                     FROM ranked WHERE rn = 1
                     ORDER BY votes DESC, weight DESC
                     LIMIT ?3"
                    .to_string()
            };

            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| ApiError::Internal(e.to_string()))?;

            let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<PoolEntryRow> {
                Ok(PoolEntryRow {
                    artist_key: row.get(0)?,
                    parent: row.get(1)?,
                    sub: row.get(2)?,
                    votes: row.get(3)?,
                    weight: row.get(4)?,
                })
            };

            let rows = if let Some(keys) = keys.filter(|k| !k.is_empty()) {
                let mut params: Vec<Box<dyn rusqlite::ToSql>> = keys
                    .iter()
                    .map(|k| Box::new(k.clone()) as Box<dyn rusqlite::ToSql>)
                    .collect();
                params.push(Box::new(likes_cap));
                params.push(Box::new(min_votes));
                params.push(Box::new(limit));
                let param_refs: Vec<&dyn rusqlite::ToSql> =
                    params.iter().map(|p| p.as_ref()).collect();
                stmt.query_map(param_refs.as_slice(), map_row)
                    .map_err(|e| ApiError::Internal(e.to_string()))?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| ApiError::Internal(e.to_string()))?
            } else {
                stmt.query_map(params![likes_cap, min_votes, limit], map_row)
                    .map_err(|e| ApiError::Internal(e.to_string()))?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| ApiError::Internal(e.to_string()))?
            };
            Ok(rows)
        })
    }
}

#[derive(Clone)]
pub struct MirrorMeta {
    pub version: i64,
    pub synced_at: Option<String>,
    pub display_name: Option<String>,
    pub liked_count: i64,
    pub updated_at: String,
}

#[derive(Clone)]
pub struct MirrorArtistRow {
    pub artist_key: String,
    pub name: String,
    pub spotify_id: String,
    pub likes: i64,
    pub raw_genres: String,
    pub parent: String,
    pub sub: String,
}

pub struct MirrorBundle {
    pub meta: MirrorMeta,
    pub artists: Vec<MirrorArtistRow>,
}

#[derive(Clone)]
pub struct PoolEntryRow {
    pub artist_key: String,
    pub parent: String,
    pub sub: String,
    pub votes: i64,
    pub weight: i64,
}

#[derive(Clone)]
pub struct AccountRow {
    pub id: String,
    pub email: String,
    pub password_hash: Option<String>,
    pub created_at: String,
}

pub struct RefreshRow {
    pub id: String,
    pub account_id: String,
    pub expires_at: i64,
    pub revoked: bool,
}

fn chrono_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
