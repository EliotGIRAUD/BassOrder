use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbChanged {
    pub entity: String,
    pub action: String,
    pub id: Option<String>,
}

pub fn emit_db_changed(app: &AppHandle, entity: &str, action: &str, id: Option<&str>) {
    let _ = app.emit(
        "db-changed",
        DbChanged {
            entity: entity.to_string(),
            action: action.to_string(),
            id: id.map(|s| s.to_string()),
        },
    );
}
