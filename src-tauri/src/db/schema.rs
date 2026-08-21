use rusqlite::Connection;

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS prefs (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS spotify_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  last_synced_at INTEGER,
  liked_count INTEGER NOT NULL DEFAULT 0,
  artist_count INTEGER NOT NULL DEFAULT 0,
  group_count INTEGER NOT NULL DEFAULT 0,
  access_token TEXT,
  refresh_token TEXT,
  expires_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS knowledge_meta (
  profile_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT,
  display_name TEXT,
  liked_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS knowledge_artists (
  profile_id TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  name TEXT NOT NULL,
  spotify_id TEXT NOT NULL DEFAULT '',
  likes INTEGER NOT NULL DEFAULT 0,
  raw_genres TEXT NOT NULL DEFAULT '[]',
  parent TEXT NOT NULL DEFAULT '',
  sub TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (profile_id, artist_key)
);

CREATE TABLE IF NOT EXISTS library_scans (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  root TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  selected_folder TEXT,
  mode TEXT NOT NULL DEFAULT 'copy',
  file_count INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  unknown_count INTEGER NOT NULL DEFAULT 0,
  looked_up_count INTEGER NOT NULL DEFAULT 0,
  sorted_percent REAL NOT NULL DEFAULT 0,
  group_count INTEGER NOT NULL DEFAULT 0,
  folder_count INTEGER NOT NULL DEFAULT 0,
  duration_secs REAL NOT NULL DEFAULT 0,
  top_genres TEXT NOT NULL DEFAULT '[]',
  detection_log TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  title TEXT,
  artist TEXT,
  album TEXT,
  year TEXT,
  genre TEXT NOT NULL,
  folder TEXT NOT NULL,
  duration_secs REAL,
  bpm REAL,
  musical_key TEXT,
  bitrate_kbps INTEGER,
  FOREIGN KEY (scan_id) REFERENCES library_scans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spotify_imports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_name TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  saved_at INTEGER NOT NULL,
  synced_at TEXT,
  liked_count INTEGER NOT NULL DEFAULT 0,
  artist_count INTEGER NOT NULL DEFAULT 0,
  classified_artists INTEGER NOT NULL DEFAULT 0,
  group_count INTEGER NOT NULL DEFAULT 0,
  top_genres TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS genre_cache (
  artist_key TEXT PRIMARY KEY NOT NULL,
  genre TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_scan_genre ON tracks(scan_id, genre);
CREATE INDEX IF NOT EXISTS idx_knowledge_artists_parent ON knowledge_artists(profile_id, parent);
CREATE INDEX IF NOT EXISTS idx_library_scans_user ON library_scans(user_id, saved_at);
CREATE INDEX IF NOT EXISTS idx_spotify_profiles_user ON spotify_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_spotify_imports_user ON spotify_imports(user_id, saved_at);
"#;

pub fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if version < 1 {
        conn.execute_batch(SCHEMA_V1)
            .map_err(|e| format!("schema v1: {e}"))?;
        conn.pragma_update(None, "user_version", 1)
            .map_err(|e| e.to_string())?;
    }

    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if version < 2 {
        // Bases déjà créées en v1 : ajoute avatar_url sans casser les lignes.
        let has_avatar: bool = conn
            .prepare("PRAGMA table_info(users)")
            .and_then(|mut stmt| {
                let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
                for col in cols {
                    if col? == "avatar_url" {
                        return Ok(true);
                    }
                }
                Ok(false)
            })
            .unwrap_or(false);
        if !has_avatar {
            conn.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT", [])
                .map_err(|e| format!("schema v2 avatar_url: {e}"))?;
        }
        conn.pragma_update(None, "user_version", 2)
            .map_err(|e| e.to_string())?;
    }

    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if version < 3 {
        let has_pw: bool = column_exists(conn, "users", "password_hash")?;
        if !has_pw {
            conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT", [])
                .map_err(|e| format!("schema v3 password_hash: {e}"))?;
        }
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS favorites (
              id TEXT PRIMARY KEY NOT NULL,
              user_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              ref_key TEXT NOT NULL,
              title TEXT NOT NULL,
              meta_json TEXT NOT NULL DEFAULT '{}',
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              UNIQUE(user_id, kind, ref_key)
            );
            CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, updated_at);
            CREATE TABLE IF NOT EXISTS account_presets (
              id TEXT PRIMARY KEY NOT NULL,
              user_id TEXT NOT NULL,
              name TEXT NOT NULL,
              prefs_json TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cloud_link (
              user_id TEXT PRIMARY KEY NOT NULL,
              account_id TEXT,
              email TEXT,
              access_token TEXT,
              refresh_token TEXT,
              expires_at INTEGER,
              api_base_url TEXT,
              last_sync_at INTEGER,
              linked_at INTEGER
            );
            "#,
        )
        .map_err(|e| format!("schema v3 tables: {e}"))?;
        conn.pragma_update(None, "user_version", 3)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    for col in cols {
        if col.map_err(|e| e.to_string())? == column {
            return Ok(true);
        }
    }
    Ok(false)
}
