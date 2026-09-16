//! Indexed, local history. UI caches are never the authority for retained records.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::Path;

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub const DATABASE: &str = "linty-history.sqlite3";
const LEGACY: [(&str, &str); 2] = [
    ("linty-history.json", "transcripts"),
    ("linty-corrections.json", "corrections"),
];
pub struct HistoryDb {
    conn: Connection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub timestamp: i64,
    pub end: i64,
    pub label: String,
    pub full_label: String,
}
#[derive(Serialize, Deserialize)]
pub struct DeletedTranscript {
    pub transcript: Value,
    pub corrections: Vec<Value>,
    pub generation: i64,
}

fn required_str<'a>(record: &'a Value, key: &str) -> Result<&'a str> {
    record
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| key != "transcriptId" && key != "correctionId" || !s.is_empty())
        .ok_or_else(|| {
            format!(
                "History record has a missing or invalid {key}; the original file has been kept."
            )
            .into()
        })
}
fn timestamp(record: &Value) -> Result<i64> {
    record["timestamp"]
        .as_i64()
        .filter(|n| *n >= 0)
        .ok_or_else(|| "Invalid history timestamp; the original file has been kept.".into())
}
fn number(record: &Value, key: &str) -> f64 {
    record[key]
        .as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0)
        .unwrap_or(0.0)
}
fn put_transcript(conn: &Connection, original: &Value, replace: bool) -> Result<()> {
    let id = required_str(original, "transcriptId")?;
    let text = required_str(original, "finalText")?;
    let time = timestamp(original)?;
    let words = original["wordCount"]
        .as_i64()
        .filter(|n| *n >= 0)
        .unwrap_or_else(|| text.split_whitespace().count() as i64);
    let engine = if original["engine"] == "cloud" {
        "cloud"
    } else {
        "local"
    };
    let app_name = original["application"]["name"].as_str();
    let app_bundle = original["application"]["bundleId"]
        .as_str()
        .filter(|s| !s.is_empty());
    let search = format!(
        "{} {} {}",
        text,
        app_name.unwrap_or(""),
        app_bundle.unwrap_or("")
    )
    .to_lowercase();
    let mut record = original.clone();
    // Older versions omitted some metadata. Preserve original text and unknown fields.
    for (key, default) in [
        ("rawText", json!(text)),
        ("wordCount", json!(words)),
        ("durationSeconds", json!(0)),
        ("processingTimeMs", json!(0)),
        ("engine", json!(engine)),
        ("modelName", json!("")),
        ("corrected", json!(false)),
    ] {
        if record.get(key).is_none() {
            record[key] = default;
        }
    }
    let conflict = if replace {
        "DO UPDATE SET timestamp=excluded.timestamp,words=excluded.words,seconds=excluded.seconds,processing_ms=excluded.processing_ms,engine=excluded.engine,app_name=excluded.app_name,app_bundle=excluded.app_bundle,search_text=excluded.search_text,payload=excluded.payload"
    } else {
        "DO NOTHING"
    };
    conn.execute(&format!("INSERT INTO transcripts(id,timestamp,words,seconds,processing_ms,engine,app_name,app_bundle,search_text,payload) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) {conflict}"), params![id,time,words,number(original,"durationSeconds"),number(original,"processingTimeMs"),engine,app_name,app_bundle,search,serde_json::to_string(&record)?])?;
    Ok(())
}
fn put_correction(conn: &Connection, record: &Value) -> Result<()> {
    let count = if record["rewrite"] == true {
        1
    } else {
        record["pairs"].as_array().map_or(0, Vec::len)
    };
    conn.execute("INSERT INTO corrections(id,transcript_id,timestamp,changes,payload) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO NOTHING",params![required_str(record,"correctionId")?,required_str(record,"transcriptId")?,timestamp(record)?,count as i64,serde_json::to_string(record)?])?;
    Ok(())
}
fn payloads<P: rusqlite::Params>(conn: &Connection, sql: &str, params: P) -> Result<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, |row| row.get::<_, String>(0))?;
    rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}
fn bump(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE history_settings SET revision=revision+1 WHERE id=1",
        [],
    )?;
    Ok(())
}
fn valid_retention(days: i64) -> Result<()> {
    if [0, 30, 90, 365].contains(&days) {
        Ok(())
    } else {
        Err("Unsupported history retention period".into())
    }
}
fn cutoff(now: i64, days: i64) -> i64 {
    if days == 0 {
        0
    } else {
        now.saturating_sub(days * 86_400_000).max(0)
    }
}
fn erase_before(conn: &Connection, before: i64) -> Result<usize> {
    conn.execute("DELETE FROM corrections WHERE transcript_id IN (SELECT id FROM transcripts WHERE timestamp < ?1) OR timestamp < ?1", [before])?;
    Ok(conn.execute("DELETE FROM transcripts WHERE timestamp < ?1", [before])?)
}

impl HistoryDb {
    pub fn open(dir: &Path) -> Result<Self> {
        fs::create_dir_all(dir)?;
        let mut conn = Connection::open(dir.join(DATABASE))?;
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        conn.execute_batch("PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
            CREATE TABLE IF NOT EXISTS history_settings(id INTEGER PRIMARY KEY CHECK(id=1), retention_days INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, migrated INTEGER NOT NULL DEFAULT 0);
            INSERT OR IGNORE INTO history_settings(id) VALUES(1);
            CREATE TABLE IF NOT EXISTS transcripts(id TEXT PRIMARY KEY,timestamp INTEGER NOT NULL,words INTEGER NOT NULL,seconds REAL NOT NULL,processing_ms REAL NOT NULL,engine TEXT NOT NULL,app_name TEXT,app_bundle TEXT,search_text TEXT NOT NULL,payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS history_by_time ON transcripts(timestamp DESC,id DESC);
            CREATE TABLE IF NOT EXISTS corrections(id TEXT PRIMARY KEY,transcript_id TEXT NOT NULL,timestamp INTEGER NOT NULL,changes INTEGER NOT NULL,payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS corrections_by_transcript ON corrections(transcript_id);")?;
        let migrated: bool = conn.query_row(
            "SELECT migrated FROM history_settings WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        if !migrated {
            let tx = conn.transaction()?;
            for (file, key) in LEGACY {
                let path = dir.join(file);
                if !path.try_exists()? {
                    continue;
                }
                let saved: Value = serde_json::from_reader(fs::File::open(&path)?)?;
                // An empty plugin store is valid. Any malformed collection aborts the entire migration.
                if let Some(value) = saved.get(key) {
                    let records = value.as_array().ok_or(
                        "Invalid legacy history collection; original files have been kept",
                    )?;
                    let mut ids = std::collections::HashSet::new();
                    for record in records {
                        let id = required_str(
                            record,
                            if key == "transcripts" {
                                "transcriptId"
                            } else {
                                "correctionId"
                            },
                        )?;
                        if !ids.insert(id) {
                            return Err(
                                "Duplicate history IDs; original files have been kept".into()
                            );
                        }
                        if key == "transcripts" {
                            put_transcript(&tx, record, false)?;
                        } else {
                            put_correction(&tx, record)?;
                        }
                    }
                } else if !saved.is_object() {
                    return Err(
                        "Invalid legacy history store; original files have been kept".into(),
                    );
                }
            }
            tx.execute(
                "UPDATE history_settings SET migrated=1,revision=revision+1 WHERE id=1",
                [],
            )?;
            tx.commit()?;
        }
        // A committed migration is restart-safe. Never re-import deleted records from a leftover file.
        // Cleanup must succeed before mutations are allowed, so deletion also removes legacy copies.
        for (file, _) in LEGACY {
            let path = dir.join(file);
            if path.try_exists()? {
                fs::remove_file(path)?;
            }
        }
        Ok(Self { conn })
    }
    pub fn prune(&mut self, now: i64) -> Result<()> {
        let days = self.retention()?;
        if days == 0 {
            return Ok(());
        }
        let tx = self.conn.transaction()?;
        let before = tx.total_changes();
        erase_before(&tx, cutoff(now, days))?;
        if tx.total_changes() > before {
            bump(&tx)?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn retention(&self) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT retention_days FROM history_settings WHERE id=1",
            [],
            |r| r.get(0),
        )?)
    }
    pub fn snapshot(&self) -> Result<Value> {
        let (total, oldest, words): (i64, Option<i64>, i64) = self.conn.query_row(
            "SELECT COUNT(*),MIN(timestamp),COALESCE(SUM(words),0) FROM transcripts",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let (corrections,changes):(i64,i64)=self.conn.query_row("SELECT COUNT(*),COALESCE(SUM(c.changes),0) FROM corrections c JOIN transcripts t ON t.id=c.transcript_id",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
        let (retention, revision): (i64, i64) = self.conn.query_row(
            "SELECT retention_days,revision FROM history_settings WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok(
            json!({"recent":payloads(&self.conn,"SELECT payload FROM transcripts ORDER BY timestamp DESC,id DESC LIMIT 20",[])?,"total":total,"oldestTimestamp":oldest,"totalWords":words,"milestone":self.word_milestone(words)?,"correctionCount":corrections,"correctionRate":rate(changes,words),"retentionDays":retention,"revision":revision}),
        )
    }
    pub fn query(&self, query: &str, offset: i64, limit: i64) -> Result<Value> {
        let query = query.trim().to_lowercase();
        let total: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM transcripts WHERE instr(search_text,?1)>0",
            [&query],
            |r| r.get(0),
        )?;
        let records=payloads(&self.conn,"SELECT payload FROM transcripts WHERE instr(search_text,?1)>0 ORDER BY timestamp DESC,id DESC LIMIT ?2 OFFSET ?3",params![query,limit.clamp(1,100),offset.max(0)])?;
        Ok(json!({"records":records,"total":total}))
    }
    pub fn get(&self, id: &str) -> Result<Option<Value>> {
        let payload: Option<String> = self
            .conn
            .query_row("SELECT payload FROM transcripts WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()?;
        Ok(payload.map(|s| serde_json::from_str(&s)).transpose()?)
    }
    pub fn corrections(&self, id: &str) -> Result<Vec<Value>> {
        payloads(&self.conn,"SELECT payload FROM corrections WHERE transcript_id=?1 ORDER BY timestamp DESC,id DESC",[id])
    }
    pub fn save(&mut self, record: &Value, now: i64) -> Result<()> {
        if timestamp(record)? < cutoff(now, self.retention()?) {
            return Err("This transcription is outside your current retention period".into());
        }
        let tx = self.conn.transaction()?;
        put_transcript(&tx, record, true)?;
        bump(&tx)?;
        tx.commit()?;
        Ok(())
    }
    pub fn patch(&mut self, id: &str, patch: &Value) -> Result<()> {
        let mut record = self.get(id)?.ok_or("Transcription no longer exists")?;
        // History editing changes text only; dictated word count and timing remain accurate.
        record["finalText"] = json!(required_str(patch, "finalText")?);
        let tx = self.conn.transaction()?;
        put_transcript(&tx, &record, true)?;
        bump(&tx)?;
        tx.commit()?;
        Ok(())
    }
    pub fn add_correction(&mut self, record: &Value) -> Result<()> {
        if self.get(required_str(record, "transcriptId")?)?.is_none() {
            return Err("The transcription was deleted or expired".into());
        }
        let tx = self.conn.transaction()?;
        put_correction(&tx, record)?;
        bump(&tx)?;
        tx.commit()?;
        Ok(())
    }
    pub fn delete(&mut self, id: &str) -> Result<Option<DeletedTranscript>> {
        let Some(transcript) = self.get(id)? else {
            return Ok(None);
        };
        let corrections = self.corrections(id)?;
        let generation = self.conn.query_row(
            "SELECT generation FROM history_settings WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM corrections WHERE transcript_id=?1", [id])?;
        tx.execute("DELETE FROM transcripts WHERE id=?1", [id])?;
        bump(&tx)?;
        tx.commit()?;
        Ok(Some(DeletedTranscript {
            transcript,
            corrections,
            generation,
        }))
    }
    pub fn restore(&mut self, deleted: &DeletedTranscript, now: i64) -> Result<()> {
        let generation: i64 = self.conn.query_row(
            "SELECT generation FROM history_settings WHERE id=1",
            [],
            |r| r.get(0),
        )?;
        if generation != deleted.generation {
            return Err("History was cleared or its retention changed; this deletion can no longer be undone".into());
        }
        if timestamp(&deleted.transcript)? < cutoff(now, self.retention()?) {
            return Err("This transcription has expired under your retention setting".into());
        }
        let tx = self.conn.transaction()?;
        put_transcript(&tx, &deleted.transcript, false)?;
        for c in &deleted.corrections {
            put_correction(&tx, c)?;
        }
        bump(&tx)?;
        tx.commit()?;
        Ok(())
    }
    pub fn clear(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM corrections", [])?;
        tx.execute("DELETE FROM transcripts", [])?;
        tx.execute(
            "UPDATE history_settings SET generation=generation+1,revision=revision+1 WHERE id=1",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn retention_preview(&self, days: i64, now: i64) -> Result<i64> {
        valid_retention(days)?;
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM transcripts WHERE timestamp < ?1",
            [cutoff(now, days)],
            |r| r.get(0),
        )?)
    }
    pub fn set_retention(&mut self, days: i64, now: i64) -> Result<()> {
        valid_retention(days)?;
        let tx = self.conn.transaction()?;
        erase_before(&tx, cutoff(now, days))?;
        tx.execute("UPDATE history_settings SET retention_days=?1,generation=generation+1,revision=revision+1 WHERE id=1",[days])?;
        tx.commit()?;
        Ok(())
    }
    /// Shared aggregate query for the visible period and its comparison period.
    pub fn usage_summary(&self, start: i64, end: i64) -> Result<Value> {
        let (words, seconds, processing, sessions, local, active_days): (i64, f64, f64, i64, i64, i64) = self.conn.query_row(
            "SELECT COALESCE(SUM(words),0),COALESCE(SUM(seconds),0),COALESCE(SUM(processing_ms),0),COUNT(*),COALESCE(SUM(engine='local'),0),COUNT(DISTINCT date(timestamp/1000,'unixepoch','localtime')) FROM transcripts WHERE timestamp>=?1 AND timestamp<=?2",
            params![start,end], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?)))?;
        // Legacy records without complete timing must not create invented savings or pace.
        let (timed_words, timed_seconds, timed_processing, timed_sessions): (i64, f64, f64, i64) = self.conn.query_row(
            "SELECT COALESCE(SUM(words),0),COALESCE(SUM(seconds),0),COALESCE(SUM(processing_ms),0),COUNT(*) FROM transcripts WHERE timestamp>=?1 AND timestamp<=?2 AND words>0 AND seconds>0 AND processing_ms>0",
            params![start,end], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
        Ok(json!({
            "stats":{"words":words,"seconds":seconds,"sessions":sessions,"local":local,"avgProcessingSeconds":if sessions>0{processing/sessions as f64/1000.0}else{0.0},"wordsPerMinute":if seconds>0.0{(words as f64/seconds*60.0).round()}else{0.0},"localPercent":if sessions>0{(local as f64/sessions as f64*100.0).round()}else{0.0}},
            "timing":{"words":timed_words,"seconds":timed_seconds,"processingSeconds":timed_processing/1000.0,"sessions":timed_sessions,"missingSessions":sessions-timed_sessions},
            "activeDays":active_days
        }))
    }
    /// Recomputed from retained history, so deletion/retention also removes recognition.
    fn word_milestone(&self, total: i64) -> Result<Value> {
        let mut threshold = 0;
        let mut scale = 1000_i64;
        while scale <= total {
            for value in [
                Some(scale),
                scale.checked_mul(5).map(|n| n / 2),
                scale.checked_mul(5),
            ]
            .into_iter()
            .flatten()
            {
                if value <= total {
                    threshold = value;
                }
            }
            match scale.checked_mul(10) {
                Some(next) => scale = next,
                None => break,
            }
        }
        if threshold == 0 {
            return Ok(Value::Null);
        }
        let mut stmt = self
            .conn
            .prepare("SELECT timestamp,words FROM transcripts ORDER BY timestamp,id")?;
        let mut rows = stmt.query([])?;
        let mut words = 0;
        while let Some(row) = rows.next()? {
            words += row.get::<_, i64>(1)?;
            if words >= threshold {
                return Ok(json!({"words":threshold,"timestamp":row.get::<_,i64>(0)?}));
            }
        }
        Ok(Value::Null)
    }
    pub fn usage(&self, start: i64, end: i64, buckets: &[Bucket]) -> Result<Value> {
        let summary = self.usage_summary(start, end)?;
        let sessions = summary["stats"]["sessions"].as_i64().unwrap_or(0);
        let mut stmt=self.conn.prepare("SELECT CASE WHEN app_name IS NULL THEN 'unattributed' WHEN app_bundle IS NOT NULL THEN 'bundle:'||app_bundle ELSE 'name:'||app_name END AS app_id,MAX(app_name),MAX(app_bundle),SUM(words),SUM(seconds),COUNT(*),MAX(timestamp),SUM(processing_ms),SUM(engine='local') FROM transcripts WHERE timestamp>=?1 AND timestamp<=?2 GROUP BY app_id ORDER BY app_id")?;
        let apps=stmt.query_map(params![start,end],|r|{
            let name:Option<String>=r.get(1)?;
            Ok(json!({"id":r.get::<_,String>(0)?,"name":name.as_deref().unwrap_or("Unattributed"),"bundleId":r.get::<_,Option<String>>(2)?,"attributed":name.is_some(),"words":r.get::<_,i64>(3)?,"seconds":r.get::<_,f64>(4)?,"sessions":r.get::<_,i64>(5)?,"lastUsedAt":r.get::<_,i64>(6)?,"processingMs":r.get::<_,f64>(7)?,"local":r.get::<_,i64>(8)?}))
        })?.collect::<rusqlite::Result<Vec<_>>>()?;
        let mut timeline = Vec::new();
        for b in buckets {
            let (w,n):(i64,i64)=self.conn.query_row("SELECT COALESCE(SUM(words),0),COUNT(*) FROM transcripts WHERE timestamp>=?1 AND timestamp<?2 AND timestamp<=?3",params![b.timestamp.max(start),b.end,end],|r|Ok((r.get(0)?,r.get(1)?)))?;
            timeline.push(json!({"timestamp":b.timestamp,"label":b.label,"fullLabel":b.full_label,"words":w,"sessions":n}));
        }
        let mut engines = Vec::new();
        for engine in ["local", "cloud"] {
            let (n,w):(i64,i64)=self.conn.query_row("SELECT COUNT(*),COALESCE(SUM(words),0) FROM transcripts WHERE engine=?1 AND timestamp>=?2 AND timestamp<=?3",params![engine,start,end],|r|Ok((r.get(0)?,r.get(1)?)))?;
            let changes:i64=self.conn.query_row("SELECT COALESCE(SUM(c.changes),0) FROM corrections c JOIN transcripts t ON t.id=c.transcript_id WHERE t.engine=?1 AND t.timestamp>=?2 AND t.timestamp<=?3",params![engine,start,end],|r|r.get(0))?;
            engines.push(json!({"engine":engine,"sessions":n,"share":if sessions>0{Some((n as f64/sessions as f64*100.0).round())}else{None},"rate":rate(changes,w)}));
        }
        let recent=payloads(&self.conn,"SELECT payload FROM transcripts WHERE timestamp>=?1 AND timestamp<=?2 ORDER BY timestamp DESC,id DESC LIMIT 5",params![start,end])?;
        Ok(
            json!({"stats":summary["stats"],"timing":summary["timing"],"activeDays":summary["activeDays"],"applications":apps,"timeline":timeline,"recent":recent,"engines":engines}),
        )
    }
    pub fn export(&self, path: &Path, now: i64) -> Result<i64> {
        let parent = path.parent().ok_or("Invalid export location")?;
        let temp = parent.join(format!(".linty-export-{}-{}.tmp", std::process::id(), now));
        let result = (|| -> Result<i64> {
            let file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)?;
            let mut out = BufWriter::new(file);
            write!(
                out,
                "{{\"formatVersion\":1,\"exportedAt\":{now},\"transcripts\":["
            )?;
            let mut count = 0;
            for (index, table) in ["transcripts", "corrections"].iter().enumerate() {
                if index == 1 {
                    write!(out, "],\"corrections\":[")?;
                }
                let mut stmt = self.conn.prepare(&format!(
                    "SELECT payload FROM {table} ORDER BY timestamp DESC,id DESC"
                ))?;
                let mut rows = stmt.query([])?;
                let mut first = true;
                while let Some(row) = rows.next()? {
                    if !first {
                        out.write_all(b",")?;
                    }
                    first = false;
                    out.write_all(row.get::<_, String>(0)?.as_bytes())?;
                    if index == 0 {
                        count += 1;
                    }
                }
            }
            out.write_all(b"]}\n")?;
            out.flush()?;
            out.get_ref().sync_all()?;
            fs::rename(&temp, path)?;
            Ok(count)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
}
fn rate(changes: i64, words: i64) -> Option<f64> {
    if words > 0 {
        Some((changes as f64 / words as f64 * 1000.0).round() / 10.0)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "linty-history-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn record(id: usize, time: i64) -> Value {
        json!({"transcriptId":format!("t-{id:05}"),"timestamp":time,"finalText":format!("Private example {id}"),"rawText":"Original","wordCount":20,"durationSeconds":10,"processingTimeMs":1000,"engine":"local","modelName":"test","corrected":false,"application":{"name":"Éditeur","bundleId":"com.example.editor"},"futureField":{"keep":true}})
    }
    fn correction(id: usize, time: i64) -> Value {
        json!({"correctionId":format!("c-{id}"),"transcriptId":format!("t-{id:05}"),"timestamp":time,"rewrite":false,"pairs":[{"from":"exampel","to":"example","kind":"substitution"}]})
    }
    fn legacy(dir: &Path, records: Vec<Value>, corrections: Vec<Value>) {
        fs::write(
            dir.join(LEGACY[0].0),
            serde_json::to_vec(&json!({"transcripts":records})).unwrap(),
        )
        .unwrap();
        fs::write(
            dir.join(LEGACY[1].0),
            serde_json::to_vec(&json!({"corrections":corrections})).unwrap(),
        )
        .unwrap();
    }
    #[test]
    fn migration_preserves_more_than_500_and_is_idempotent() {
        let dir = Temp::new();
        let records = (0..1205).map(|i| record(i, i as i64 + 1)).collect();
        legacy(&dir.0, records, vec![correction(1, 2)]);
        {
            let db = HistoryDb::open(&dir.0).unwrap();
            let snapshot = db.snapshot().unwrap();
            assert_eq!(snapshot["total"], 1205);
            assert_eq!(snapshot["recent"].as_array().unwrap().len(), 20);
            assert_eq!(
                db.get("t-00001").unwrap().unwrap()["futureField"]["keep"],
                true
            );
            assert_eq!(db.corrections("t-00001").unwrap().len(), 1);
            assert_eq!(db.retention().unwrap(), 0);
        }
        assert!(!dir.0.join(LEGACY[0].0).exists());
        assert!(!dir.0.join(LEGACY[1].0).exists());
        let db = HistoryDb::open(&dir.0).unwrap();
        assert_eq!(db.snapshot().unwrap()["total"], 1205);
    }
    #[test]
    fn committed_migration_never_reimports_leftover_legacy_copies() {
        let dir = Temp::new();
        legacy(&dir.0, vec![record(1, 1)], vec![correction(1, 2)]);
        let mut db = HistoryDb::open(&dir.0).unwrap();
        db.delete("t-00001").unwrap();
        drop(db);
        // Simulate legacy copies left after the migration transaction committed.
        legacy(&dir.0, vec![record(1, 1)], vec![correction(1, 2)]);
        let db = HistoryDb::open(&dir.0).unwrap();
        assert_eq!(db.snapshot().unwrap()["total"], 0);
        assert!(db.corrections("t-00001").unwrap().is_empty());
        assert!(!dir.0.join(LEGACY[0].0).exists());
        assert!(!dir.0.join(LEGACY[1].0).exists());
    }
    #[test]
    fn oldest_record_format_receives_metadata_defaults_without_losing_text() {
        let dir = Temp::new();
        let original =
            json!({"transcriptId":"legacy","timestamp":1,"finalText":"Keep this.","unknown":42});
        legacy(&dir.0, vec![original.clone()], vec![]);
        let db = HistoryDb::open(&dir.0).unwrap();
        let migrated = db.get("legacy").unwrap().unwrap();
        for (key, value) in original.as_object().unwrap() {
            assert_eq!(&migrated[key], value);
        }
        assert_eq!(migrated["rawText"], "Keep this.");
        assert_eq!(migrated["wordCount"], 2);
        assert_eq!(migrated["engine"], "local");
        assert_eq!(db.snapshot().unwrap()["totalWords"], 2);
    }
    #[test]
    fn failed_migration_rolls_back_everything_and_keeps_originals() {
        let dir = Temp::new();
        legacy(
            &dir.0,
            vec![record(1, 1)],
            vec![json!({"correctionId":"bad"})],
        );
        assert!(HistoryDb::open(&dir.0).is_err());
        assert!(dir.0.join(LEGACY[0].0).exists());
        assert!(dir.0.join(LEGACY[1].0).exists());
        let conn = Connection::open(dir.0.join(DATABASE)).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM transcripts", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        fs::write(dir.0.join(LEGACY[1].0), r#"{"corrections":[]}"#).unwrap();
        assert_eq!(
            HistoryDb::open(&dir.0).unwrap().snapshot().unwrap()["total"],
            1
        );
    }
    #[test]
    fn malformed_or_duplicate_legacy_history_is_not_silently_discarded() {
        let dir = Temp::new();
        fs::write(dir.0.join(LEGACY[0].0), "{broken").unwrap();
        assert!(HistoryDb::open(&dir.0).is_err());
        assert_eq!(
            fs::read_to_string(dir.0.join(LEGACY[0].0)).unwrap(),
            "{broken"
        );
        legacy(&dir.0, vec![record(1, 1), record(1, 1)], vec![]);
        assert!(HistoryDb::open(&dir.0).is_err());
        assert!(dir.0.join(LEGACY[0].0).exists());
    }
    #[test]
    fn pagination_search_and_aggregates_cover_full_archive() {
        let dir = Temp::new();
        legacy(
            &dir.0,
            (0..1205).map(|i| record(i, 100)).collect(),
            vec![correction(1, 101)],
        );
        let db = HistoryDb::open(&dir.0).unwrap();
        let page1 = db.query("", 0, 50).unwrap();
        let page2 = db.query("", 50, 50).unwrap();
        assert_eq!(page1["total"], 1205);
        assert_eq!(page1["records"].as_array().unwrap().len(), 50);
        assert_eq!(page1["records"][49]["transcriptId"], "t-01155");
        assert_eq!(page2["records"][0]["transcriptId"], "t-01154");
        assert_eq!(db.query(" ÉDITEUR ", 0, 50).unwrap()["total"], 1205);
        assert_eq!(db.query("example 1204", 0, 50).unwrap()["total"], 1);
        assert_eq!(db.query("%", 0, 50).unwrap()["total"], 0);
        let usage = db
            .usage(
                0,
                200,
                &[Bucket {
                    timestamp: 0,
                    end: 201,
                    label: "Today".into(),
                    full_label: "Today".into(),
                }],
            )
            .unwrap();
        assert_eq!(usage["stats"]["words"], 24100);
        assert_eq!(usage["stats"]["sessions"], 1205);
        assert_eq!(usage["applications"][0]["words"], 24100);
        assert_eq!(usage["timeline"][0]["sessions"], 1205);
        assert_eq!(usage["recent"].as_array().unwrap().len(), 5);
        assert_eq!(db.usage(101, 200, &[]).unwrap()["stats"]["sessions"], 0);
    }
    #[test]
    fn deletion_undo_and_edits_preserve_other_records_and_statistics() {
        let dir = Temp::new();
        let mut db = HistoryDb::open(&dir.0).unwrap();
        db.save(&record(1, 100), 200).unwrap();
        db.add_correction(&correction(1, 101)).unwrap();
        let deleted = db.delete("t-00001").unwrap().unwrap();
        assert_eq!(db.snapshot().unwrap()["total"], 0);
        assert!(db.corrections("t-00001").unwrap().is_empty());
        db.save(&record(2, 102), 200).unwrap();
        db.restore(&deleted, 200).unwrap();
        db.restore(&deleted, 200).unwrap();
        assert_eq!(db.snapshot().unwrap()["total"], 2);
        assert_eq!(db.corrections("t-00001").unwrap().len(), 1);
        db.patch("t-00001", &json!({"finalText":"Entirely edited"}))
            .unwrap();
        assert_eq!(db.query("Entirely edited", 0, 50).unwrap()["total"], 1);
        assert_eq!(db.snapshot().unwrap()["totalWords"], 40);
        db.restore(&deleted, 200).unwrap();
        assert_eq!(
            db.get("t-00001").unwrap().unwrap()["finalText"],
            "Entirely edited"
        );
        db.clear().unwrap();
        assert!(db.restore(&deleted, 200).is_err());
        assert_eq!(db.snapshot().unwrap()["total"], 0);
    }
    #[test]
    fn retention_is_optional_persistent_and_prunes_related_corrections() {
        let dir = Temp::new();
        let now = 100 * 86_400_000;
        let mut db = HistoryDb::open(&dir.0).unwrap();
        db.save(&record(1, 1), now).unwrap();
        db.save(&record(2, now), now).unwrap();
        db.add_correction(&correction(1, 2)).unwrap();
        db.prune(now).unwrap();
        assert_eq!(db.snapshot().unwrap()["total"], 2);
        assert_eq!(db.retention_preview(30, now).unwrap(), 1);
        assert_eq!(db.retention_preview(0, now).unwrap(), 0);
        assert!(db.set_retention(3, now).is_err());
        db.set_retention(30, now).unwrap();
        assert_eq!(db.snapshot().unwrap()["total"], 1);
        assert!(db.corrections("t-00001").unwrap().is_empty());
        assert!(db.save(&record(1, 1), now).is_err());
        drop(db);
        let mut db = HistoryDb::open(&dir.0).unwrap();
        assert_eq!(db.retention().unwrap(), 30);
        db.prune(now + 31 * 86_400_000).unwrap();
        assert_eq!(db.snapshot().unwrap()["total"], 0);
    }
    #[test]
    fn payoff_summary_uses_only_complete_timing_and_counts_distinct_days() {
        let dir = Temp::new();
        let mut db = HistoryDb::open(&dir.0).unwrap();
        db.save(&record(1, 43_200_000), 300_000_000).unwrap();
        db.save(&record(2, 129_600_000), 300_000_000).unwrap();
        let mut legacy = record(3, 43_200_001);
        legacy["durationSeconds"] = json!(0);
        legacy["wordCount"] = json!(500);
        db.save(&legacy, 300_000_000).unwrap();
        db.save(&record(4, 400_000_000), 300_000_000).unwrap();
        let summary = db.usage_summary(0, 300_000_000).unwrap();
        assert_eq!(summary["stats"]["words"], 540);
        assert_eq!(summary["timing"]["words"], 40);
        assert_eq!(summary["timing"]["seconds"], 20.0);
        assert_eq!(summary["timing"]["processingSeconds"], 2.0);
        assert_eq!(summary["timing"]["missingSessions"], 1);
        assert_eq!(summary["activeDays"], 2);
        assert_eq!(
            db.usage(0, 300_000_000, &[]).unwrap()["timing"],
            summary["timing"]
        );
    }
    #[test]
    fn milestone_date_comes_from_retained_words_and_changes_after_deletion() {
        let dir = Temp::new();
        let mut db = HistoryDb::open(&dir.0).unwrap();
        for (id, time, words) in [(1, 10, 600), (2, 20, 1400), (3, 30, 8500)] {
            let mut r = record(id, time);
            r["wordCount"] = json!(words);
            db.save(&r, 100).unwrap();
        }
        assert_eq!(
            db.snapshot().unwrap()["milestone"],
            json!({"words":10000,"timestamp":30})
        );
        db.delete("t-00003").unwrap();
        assert_eq!(
            db.snapshot().unwrap()["milestone"],
            json!({"words":1000,"timestamp":20})
        );
        db.delete("t-00002").unwrap();
        assert!(db.snapshot().unwrap()["milestone"].is_null());
    }
    #[test]
    fn export_contains_every_record_and_correction_without_changing_archive() {
        let dir = Temp::new();
        legacy(
            &dir.0,
            (0..605).map(|i| record(i, i as i64)).collect(),
            vec![correction(1, 1)],
        );
        let db = HistoryDb::open(&dir.0).unwrap();
        let path = dir.0.join("export.json");
        assert_eq!(db.export(&path, 999).unwrap(), 605);
        let exported: Value = serde_json::from_reader(fs::File::open(path).unwrap()).unwrap();
        assert_eq!(exported["transcripts"].as_array().unwrap().len(), 605);
        assert_eq!(exported["corrections"].as_array().unwrap().len(), 1);
        assert_eq!(exported["transcripts"][0]["futureField"]["keep"], true);
        assert_eq!(db.snapshot().unwrap()["total"], 605);
    }

    #[test]
    fn reformatting_snapshots_and_metrics_survive_edit_reopen_restore_and_export() {
        let dir = Temp::new();
        let mut db = HistoryDb::open(&dir.0).unwrap();
        let mut original = record(1, 100);
        original["rawText"] = json!("um send this friday no monday");
        original["reformattedText"] = json!("Send this Monday.");
        original["pastedText"] = json!("Send this Monday.");
        original["finalText"] = json!("Send this Monday.");
        original["reformatting"] = json!({"schemaVersion":1,"enabled":true,"status":"applied","totalMs":321.5,"modelRevision":"pinned","generatedTokens":5,"options":{"styling":"semi-formal","structure":"lists","context":"general"}});
        db.save(&original, 100).unwrap();
        db.patch("t-00001", &json!({"finalText":"Send this Monday, please.","rawText":"must not overwrite","reformatting":null})).unwrap();
        let deleted = db.delete("t-00001").unwrap().unwrap();
        db.restore(&deleted, 100).unwrap();
        drop(db);
        let db = HistoryDb::open(&dir.0).unwrap();
        let saved = db.get("t-00001").unwrap().unwrap();
        for key in ["rawText", "reformattedText", "pastedText", "reformatting"] {
            assert_eq!(saved[key], original[key]);
        }
        assert_eq!(saved["finalText"], "Send this Monday, please.");
        let path = dir.0.join("reformat-export.json");
        db.export(&path, 100).unwrap();
        let exported: Value = serde_json::from_reader(fs::File::open(path).unwrap()).unwrap();
        assert_eq!(exported["transcripts"][0], saved);
    }
}
