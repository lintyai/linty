//! Learn from corrections made in other apps.
//!
//! After Linty pastes a dictation, watch the focused text field through the
//! Accessibility API and report the word-level changes the person makes inside
//! the pasted span. The frontend stores them exactly like an edit made in
//! History (`correction-observed` event).
//!
//! Reads only. The field's text is compared in memory and dropped; only the
//! changed words leave this module. Off unless "Learn from corrections in other
//! apps" is on in Settings → Privacy & storage. Coverage is best-effort: native
//! AppKit fields and most browsers expose their text, some editors do not.

use std::ffi::{c_void, CStr};
use std::ops::Range;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use cocoa::base::{id, nil};
use cocoa::foundation::NSString;
use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::state::AppState;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> *mut c_void;
    fn AXUIElementCopyAttributeValue(
        element: *mut c_void,
        attribute: *const c_void,
        value: *mut *const c_void,
    ) -> i32;
    fn AXUIElementGetPid(element: *mut c_void, pid: *mut i32) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
    fn CFGetTypeID(cf: *const c_void) -> usize;
    fn CFStringGetTypeID() -> usize;
}

/// How long after a paste the field is watched.
const WATCH_SECS: u64 = 60;
const POLL: Duration = Duration::from_millis(1000);
/// Let the target app apply the Cmd+V before the first read.
const SETTLE_MS: u64 = 400;
/// Skip whole documents (a long note or an editor buffer).
const MAX_DIFF_CHARS: usize = 20_000;
const MAX_MISSES: u8 = 3;
const LINTY_BUNDLE_ID: &str = "ai.linty.desktop";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObservedApplication {
    pub name: String,
    pub bundle_id: Option<String>,
}

/// One word-level change, in the shape the frontend's `CorrectionPair` expects.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ObservedPair {
    pub kind: &'static str,
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ObservedCorrection {
    pub transcript_id: String,
    pub pasted: String,
    /// Words in the pasted text; the denominator for corrections per 100 words.
    pub word_count: usize,
    pub application: ObservedApplication,
    pub pairs: Vec<ObservedPair>,
    /// Seconds between the paste and the last change seen.
    pub seconds_after_paste: u64,
}

/// What the Accessibility API tells us about the element with keyboard focus.
struct FocusSnapshot {
    pid: i32,
    app: String,
    bundle: Option<String>,
    /// Text value, when the element exposes one as a string.
    value: Option<String>,
}

/// Owned CFType that releases itself.
struct Cf(*const c_void);
impl Drop for Cf {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: the pointer came from a Copy* call, which hands us +1.
            unsafe { CFRelease(self.0) };
        }
    }
}

/// SAFETY for the FFI helpers below: AXUIElement copy calls are documented as
/// thread-safe reads; every CF object received is released via `Cf`, and the
/// NSString attribute names are owned (+1) and released explicitly.
unsafe fn attr(element: *mut c_void, name: &str) -> Option<Cf> {
    let key: id = NSString::alloc(nil).init_str(name);
    let mut out: *const c_void = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(element, key as *const c_void, &mut out);
    let _: () = msg_send![key, release];
    if err != 0 || out.is_null() {
        None
    } else {
        Some(Cf(out))
    }
}

unsafe fn cf_string(cf: &Cf) -> Option<String> {
    if CFGetTypeID(cf.0) != CFStringGetTypeID() {
        return None;
    }
    // CFString is toll-free bridged to NSString.
    let utf8: *const std::os::raw::c_char = msg_send![cf.0 as id, UTF8String];
    if utf8.is_null() {
        return None;
    }
    Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
}

unsafe fn app_identity(pid: i32) -> (String, Option<String>) {
    let app: *mut Object =
        msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid];
    if app.is_null() {
        return (format!("pid {}", pid), None);
    }
    let name: *mut Object = msg_send![app, localizedName];
    let bundle: *mut Object = msg_send![app, bundleIdentifier];
    let to_string = |s: *mut Object| -> Option<String> {
        if s.is_null() {
            return None;
        }
        let utf8: *const std::os::raw::c_char = msg_send![s, UTF8String];
        (!utf8.is_null()).then(|| CStr::from_ptr(utf8).to_string_lossy().into_owned())
    };
    (
        to_string(name).unwrap_or_else(|| format!("pid {}", pid)),
        to_string(bundle),
    )
}

fn snapshot_focus() -> Option<FocusSnapshot> {
    // SAFETY: see the note above `attr`. Runs on a background thread inside its
    // own autorelease pool; the objects touched are copied out before the drain.
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let result = (|| {
            let system = Cf(AXUIElementCreateSystemWide() as *const c_void);
            let focused = attr(system.0 as *mut c_void, "AXFocusedUIElement")?;
            let element = focused.0 as *mut c_void;
            let mut pid: i32 = 0;
            if AXUIElementGetPid(element, &mut pid) != 0 {
                return None;
            }
            let (app, bundle) = app_identity(pid);
            let value = attr(element, "AXValue").and_then(|v| cf_string(&v));
            Some(FocusSnapshot {
                pid,
                app,
                bundle,
                value,
            })
        })();
        let _: () = msg_send![pool, drain];
        result
    }
}

/// Start watching the focused field after a paste. `generation` is the value the
/// caller bumped in `AppState`; a later paste bumps it again, which ends this
/// watch while still reporting whatever it saw.
pub fn watch_after_paste(app: tauri::AppHandle, generation: u64, transcript_id: String, pasted: String) {
    let spawned = std::thread::Builder::new()
        .name("correction-watch".into())
        .spawn(move || watch(app, generation, transcript_id, pasted));
    if let Err(e) = spawned {
        eprintln!("[corrections] could not start the watch: {}", e);
    }
}

fn is_current(app: &tauri::AppHandle, generation: u64) -> bool {
    app.state::<AppState>()
        .correction_watch_generation
        .load(Ordering::SeqCst)
        == generation
}

fn watch(app: tauri::AppHandle, generation: u64, transcript_id: String, pasted: String) {
    std::thread::sleep(Duration::from_millis(SETTLE_MS));
    let Some(first) = snapshot_focus() else {
        return;
    };
    if first.bundle.as_deref() == Some(LINTY_BUNDLE_ID) {
        return;
    }
    let Some(value0) = first.value else {
        eprintln!("[corrections] {} does not expose its text field; nothing to learn from", first.app);
        return;
    };
    if value0.chars().count() > MAX_DIFF_CHARS {
        return;
    }
    let pasted_words = words(&pasted);
    let base = words(&value0);
    let Some(start) = find_span(&base, &pasted_words) else {
        eprintln!("[corrections] pasted text not found in the {} field; nothing to learn from", first.app);
        return;
    };
    let span = start..start + pasted_words.len();

    let started = Instant::now();
    let mut latest = value0;
    let mut changed_at: Option<Instant> = None;
    let mut misses = 0u8;
    while started.elapsed() < Duration::from_secs(WATCH_SECS) {
        std::thread::sleep(POLL);
        if !is_current(&app, generation) {
            break;
        }
        let Some(snap) = snapshot_focus() else {
            misses += 1;
            if misses >= MAX_MISSES {
                break;
            }
            continue;
        };
        misses = 0;
        if snap.pid != first.pid {
            break;
        }
        let Some(current) = snap.value else {
            continue;
        };
        if current == latest {
            continue;
        }
        // A field that empties was submitted; keep what was seen before it.
        if current.trim().is_empty() || current.chars().count() > MAX_DIFF_CHARS {
            break;
        }
        latest = current;
        changed_at = Some(Instant::now());
    }
    let Some(changed_at) = changed_at else {
        return;
    };
    let pairs = span_edits(&base, &words(&latest), &span);
    if pairs.is_empty() {
        return;
    }
    eprintln!("[corrections] {} change(s) observed in {}", pairs.len(), first.app);
    let correction = ObservedCorrection {
        transcript_id,
        word_count: pasted_words.len(),
        pasted,
        application: ObservedApplication {
            name: first.app,
            bundle_id: first.bundle,
        },
        pairs,
        seconds_after_paste: changed_at.duration_since(started).as_secs(),
    };
    if let Err(e) = app.emit("correction-observed", &correction) {
        eprintln!("[corrections] could not report the correction: {}", e);
    }
}

fn words(text: &str) -> Vec<String> {
    text.split_whitespace().map(String::from).collect()
}

/// Lower-case, punctuation-stripped form used when an app reformats the paste
/// (smart quotes, auto-capitalisation) so the exact words no longer match.
fn loose(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()
}

/// Index of the pasted words inside the field's words, searching from the end
/// because the paste is usually the newest text in the field.
fn find_span(field: &[String], pasted: &[String]) -> Option<usize> {
    if pasted.is_empty() || field.len() < pasted.len() {
        return None;
    }
    let mut candidates = (0..=field.len() - pasted.len()).rev();
    if let Some(i) = candidates.clone().find(|&i| field[i..i + pasted.len()] == *pasted) {
        return Some(i);
    }
    let pasted_loose: Vec<String> = pasted.iter().map(|w| loose(w)).collect();
    candidates.find(|&i| {
        field[i..i + pasted.len()]
            .iter()
            .zip(&pasted_loose)
            .all(|(a, b)| loose(a) == *b)
    })
}

#[derive(Debug, PartialEq)]
struct Edit {
    /// Index in the original words where the change starts (insertions: before this word).
    at: usize,
    kind: &'static str,
    from: String,
    to: String,
}

/// Changes inside the pasted span only: typing before or after the paste is not a correction.
fn span_edits(before: &[String], after: &[String], span: &Range<usize>) -> Vec<ObservedPair> {
    word_diff(before, after)
        .into_iter()
        .filter(|e| match e.kind {
            "insertion" => e.at > span.start && e.at < span.end,
            _ => span.contains(&e.at),
        })
        .map(|e| ObservedPair {
            kind: e.kind,
            from: e.from,
            to: e.to,
        })
        .collect()
}

/// Word-level diff (longest common subsequence). Adjacent runs of deletions and
/// insertions of equal length are paired one to one, because they are almost
/// always word-for-word fixes; unequal runs become one substitution.
fn word_diff(a: &[String], b: &[String]) -> Vec<Edit> {
    let (n, m) = (a.len(), b.len());
    if n > 2000 || m > 2000 {
        return Vec::new();
    }
    let mut lcs = vec![vec![0u16; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }
    let mut edits = Vec::new();
    let mut dels: Vec<String> = Vec::new();
    let mut ins: Vec<String> = Vec::new();
    let mut run_at = 0usize;
    let flush = |at: usize, dels: &mut Vec<String>, ins: &mut Vec<String>, edits: &mut Vec<Edit>| {
        if !dels.is_empty() && !ins.is_empty() {
            if dels.len() == ins.len() {
                for (k, (from, to)) in dels.drain(..).zip(ins.drain(..)).enumerate() {
                    edits.push(Edit { at: at + k, kind: "substitution", from, to });
                }
            } else {
                edits.push(Edit { at, kind: "substitution", from: dels.join(" "), to: ins.join(" ") });
            }
        } else if !dels.is_empty() {
            edits.push(Edit { at, kind: "deletion", from: dels.join(" "), to: String::new() });
        } else if !ins.is_empty() {
            edits.push(Edit { at, kind: "insertion", from: String::new(), to: ins.join(" ") });
        }
        dels.clear();
        ins.clear();
    };
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[i] == b[j] {
            flush(run_at, &mut dels, &mut ins, &mut edits);
            i += 1;
            j += 1;
        } else {
            if dels.is_empty() && ins.is_empty() {
                run_at = i;
            }
            if lcs[i + 1][j] >= lcs[i][j + 1] {
                dels.push(a[i].clone());
                i += 1;
            } else {
                ins.push(b[j].clone());
                j += 1;
            }
        }
    }
    if i < n || j < m {
        if dels.is_empty() && ins.is_empty() {
            run_at = i;
        }
        dels.extend(a[i..].iter().cloned());
        ins.extend(b[j..].iter().cloned());
    }
    flush(run_at, &mut dels, &mut ins, &mut edits);
    edits
}

#[cfg(test)]
mod tests {
    use super::{find_span, span_edits, word_diff, words, Edit, ObservedPair};

    fn sub(at: usize, from: &str, to: &str) -> Edit {
        Edit { at, kind: "substitution", from: from.into(), to: to.into() }
    }

    #[test]
    fn pairs_adjacent_delete_and_insert_as_substitutions() {
        let edits = word_diff(
            &words("names like Tari, Zustan and Groke are spelled"),
            &words("names like Tauri, Zustand and Groq are spelled"),
        );
        assert_eq!(edits, vec![sub(2, "Tari,", "Tauri,"), sub(3, "Zustan", "Zustand"), sub(5, "Groke", "Groq")]);
    }

    #[test]
    fn reports_insertions_and_deletions_with_positions() {
        assert_eq!(
            word_diff(&words("a b c"), &words("a b c d")),
            vec![Edit { at: 3, kind: "insertion", from: "".into(), to: "d".into() }]
        );
        assert_eq!(
            word_diff(&words("a b c"), &words("a c")),
            vec![Edit { at: 1, kind: "deletion", from: "b".into(), to: "".into() }]
        );
        assert!(word_diff(&words("same text"), &words("same text")).is_empty());
    }

    #[test]
    fn finds_the_pasted_span_even_when_the_app_reformats_it() {
        let field = words("Earlier text. Let's meet at tauri hq tomorrow.");
        assert_eq!(find_span(&field, &words("Let's meet at tauri hq tomorrow.")), Some(2));
        assert_eq!(find_span(&field, &words("let's meet at Tauri HQ tomorrow")), Some(2));
        assert_eq!(find_span(&field, &words("something else")), None);
    }

    #[test]
    fn keeps_only_changes_inside_the_pasted_span() {
        let before = words("Hi team, ship the parakeet build today please");
        let after = words("Hello team, ship the Parakeet build today please and thanks");
        let span = 2..8; // "ship the parakeet build today please"
        assert_eq!(
            span_edits(&before, &after, &span),
            vec![ObservedPair { kind: "substitution", from: "parakeet".into(), to: "Parakeet".into() }]
        );
    }
}
