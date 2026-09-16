//! Narrow native commands keep the database and exports off the UI thread.
use crate::history_db::{Bucket, DeletedTranscript, HistoryDb};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct HistoryState(pub Mutex<()>);
fn now() -> i64 {
    crate::now_epoch_ms() as i64
}
fn access<T>(
    app: &tauri::AppHandle,
    state: &HistoryState,
    work: impl FnOnce(&mut HistoryDb) -> crate::history_db::Result<T>,
) -> Result<T, String> {
    let _lock = state
        .0
        .lock()
        .map_err(|_| "History is temporarily unavailable".to_string())?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut db = HistoryDb::open(&dir).map_err(|e| e.to_string())?;
    db.prune(now()).map_err(|e| e.to_string())?;
    work(&mut db).map_err(|e| e.to_string())
}
#[tauri::command(async)]
pub fn history_snapshot(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
) -> Result<Value, String> {
    access(&app, &state, |db| db.snapshot())
}
#[tauri::command(async)]
pub fn history_query(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    query: String,
    offset: i64,
    limit: i64,
) -> Result<Value, String> {
    access(&app, &state, |db| db.query(&query, offset, limit))
}
#[tauri::command(async)]
pub fn history_get(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    id: String,
) -> Result<Option<Value>, String> {
    access(&app, &state, |db| db.get(&id))
}
#[tauri::command(async)]
pub fn history_save(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    record: Value,
) -> Result<(), String> {
    access(&app, &state, |db| db.save(&record, now()))
}
#[tauri::command(async)]
pub fn history_patch(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    id: String,
    patch: Value,
) -> Result<(), String> {
    access(&app, &state, |db| db.patch(&id, &patch))
}
#[tauri::command(async)]
pub fn history_delete(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    id: String,
) -> Result<Option<DeletedTranscript>, String> {
    access(&app, &state, |db| db.delete(&id))
}
#[tauri::command(async)]
pub fn history_restore(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    deleted: DeletedTranscript,
) -> Result<(), String> {
    access(&app, &state, |db| db.restore(&deleted, now()))
}
#[tauri::command(async)]
pub fn history_clear(app: tauri::AppHandle, state: State<'_, HistoryState>) -> Result<(), String> {
    access(&app, &state, |db| db.clear())
}
#[tauri::command(async)]
pub fn history_retention_preview(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    days: i64,
) -> Result<i64, String> {
    access(&app, &state, |db| db.retention_preview(days, now()))
}
#[tauri::command(async)]
pub fn history_set_retention(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    days: i64,
) -> Result<(), String> {
    access(&app, &state, |db| db.set_retention(days, now()))
}
#[tauri::command(async)]
pub fn history_usage_summary(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    start: i64,
    end: i64,
) -> Result<Value, String> {
    access(&app, &state, |db| db.usage_summary(start, end))
}
#[tauri::command(async)]
pub fn history_usage(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    start: i64,
    end: i64,
    buckets: Vec<Bucket>,
) -> Result<Value, String> {
    if buckets.len() > 2400 {
        return Err("The requested chart has too many intervals".into());
    }
    access(&app, &state, |db| db.usage(start, end, &buckets))
}
#[tauri::command(async)]
pub fn history_corrections(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    id: String,
) -> Result<Vec<Value>, String> {
    access(&app, &state, |db| db.corrections(&id))
}
#[tauri::command(async)]
pub fn history_add_correction(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
    record: Value,
) -> Result<(), String> {
    access(&app, &state, |db| db.add_correction(&record))
}
#[tauri::command(async)]
pub fn history_export(
    app: tauri::AppHandle,
    state: State<'_, HistoryState>,
) -> Result<Option<Value>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Export transcription history")
        .set_file_name("Linty-history.json")
        .add_filter("JSON archive", &["json"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let parent = path
        .parent()
        .ok_or("Choose an export folder")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if parent.starts_with(data.canonicalize().map_err(|e| e.to_string())?) {
        return Err("Choose an export location outside Linty's application data folder".into());
    }
    access(&app, &state, |db| {
        Ok(Some(
            serde_json::json!({"count":db.export(&path,now())?,"path":path.to_string_lossy()}),
        ))
    })
}
