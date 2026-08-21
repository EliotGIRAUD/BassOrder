mod cloud_knowledge;
mod db;
mod genre_db;
mod genre_lookup;
mod genre_taxonomy;
mod knowledge;
mod local;
mod local_auth;
mod profile_store;
mod secret_box;
mod security;
mod session_guard;
mod spotify;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app data: {e}"))?;
            std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
            secret_box::init(&app_data).expect("secret_box init");

            let db_state = db::open(app.handle()).expect("sqlite init");
            app.manage(db_state);
            app.manage(session_guard::SessionGate::new());
            {
                let handle = app.handle().clone();
                let state = app.state::<db::DbState>();
                let _ = db::with_conn(&state, |conn| {
                    db::import_disk_legacy(&handle, conn)?;
                    db::migrate_seal_tokens(conn)?;
                    db::heal_spotify_profiles(conn)?;
                    Ok(())
                });
            }
            profile_store::restore_active(app.handle());
            knowledge::load(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            local::scan_local_library,
            local::enrich_local_genres,
            local::organize_local_library,
            local::load_track_cover,
            local::ensure_library_access,
            knowledge::knowledge_dump,
            knowledge::activate_spotify_profile,
            knowledge::active_spotify_profile,
            knowledge::knowledge_group_artists,
            cloud_knowledge::knowledge_cloud_sync,
            spotify::spotify_status,
            spotify::spotify_status_summary,
            spotify::spotify_resume_session,
            spotify::spotify_connect,
            spotify::spotify_sync_likes,
            spotify::spotify_enrich_knowledge,
            spotify::spotify_disconnect,
            db::db_get_path,
            db::db_reveal_path,
            db::db_list_users,
            db::db_upsert_user,
            db::db_delete_user,
            db::db_get_session,
            db::db_set_session,
            db::db_get_prefs,
            db::db_set_prefs,
            db::db_list_spotify_profiles,
            db::db_upsert_spotify_profile,
            db::db_delete_spotify_profile,
            db::db_set_active_spotify_profile,
            db::db_list_scans,
            db::db_get_scan,
            db::db_save_scan,
            db::db_set_active_scan,
            db::db_delete_scan,
            db::db_list_spotify_imports,
            db::db_upsert_spotify_import,
            db::db_set_active_spotify_import,
            db::db_migrate_legacy,
            db::db_list_favorites,
            db::db_upsert_favorite,
            db::db_delete_favorite,
            db::db_list_account_presets,
            db::db_upsert_account_preset,
            db::db_delete_account_preset,
            db::db_get_cloud_link,
            db::db_set_cloud_link,
            db::db_clear_cloud_link,
            local_auth::local_auth_status,
            local_auth::local_auth_set_password,
            local_auth::local_auth_clear_password,
            local_auth::local_auth_verify,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
