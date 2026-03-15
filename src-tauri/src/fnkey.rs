//! NSEvent-based fn/globe key monitoring.
//!
//! Uses NSEvent.addGlobalMonitorForEvents (standard AppKit API).
//! Based on the approach used by the open-source VoiceInk (Beingpax/VoiceInk) — now Linty.

use std::ffi::c_void;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

fn log(msg: &str) {
    eprintln!("{}", msg);
    if let Ok(home) = std::env::var("HOME") {
        let path = format!("{}/linty-fnkey.log", home);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let _ = writeln!(f, "{}", msg);
        }
    }
}

// ── Objective-C / macOS FFI ──

#[link(name = "AppKit", kind = "framework")]
extern "C" {}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: i64,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
    static kCFBooleanTrue: *const c_void;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
}

// kAXTrustedCheckOptionPrompt key
const AX_TRUSTED_CHECK_OPTION_PROMPT: &[u8] = b"AXTrustedCheckOptionPrompt\0";

extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(
        alloc: *const c_void,
        c_str: *const u8,
        encoding: u32,
    ) -> *const c_void;
}

/// Prompt macOS to show the Accessibility permission dialog
unsafe fn prompt_accessibility() -> bool {
    let key = CFStringCreateWithCString(
        std::ptr::null(),
        AX_TRUSTED_CHECK_OPTION_PROMPT.as_ptr(),
        0x08000100, // kCFStringEncodingUTF8
    );
    let keys = [key];
    let values = [kCFBooleanTrue];
    let dict = CFDictionaryCreate(
        std::ptr::null(),
        keys.as_ptr(),
        values.as_ptr(),
        1,
        &kCFTypeDictionaryKeyCallBacks as *const _ as *const c_void,
        &kCFTypeDictionaryValueCallBacks as *const _ as *const c_void,
    );
    AXIsProcessTrustedWithOptions(dict)
}

#[link(name = "objc", kind = "dylib")]
extern "C" {
    fn objc_getClass(name: *const u8) -> *const c_void;
    fn sel_registerName(name: *const u8) -> *const c_void;
    fn objc_msgSend();
}

extern "C" {
    static _NSConcreteStackBlock: *const c_void;
}

// NSEventModifierFlagFunction = 1 << 23
const NS_EVENT_MODIFIER_FLAG_FUNCTION: u64 = 0x80_0000;
// NSEventMaskFlagsChanged = 1 << 12
const NS_EVENT_MASK_FLAGS_CHANGED: u64 = 1 << 12;

// ── Block layout for Objective-C ──

#[repr(C)]
struct BlockDescriptor {
    reserved: u64,
    size: u64,
    copy_helper: Option<unsafe extern "C" fn(*mut c_void, *const c_void)>,
    dispose_helper: Option<unsafe extern "C" fn(*mut c_void)>,
}

#[repr(C)]
struct FnKeyBlock {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    invoke: unsafe extern "C" fn(*mut FnKeyBlock, *const c_void),
    descriptor: *const BlockDescriptor,
    // Captured state
    state: *const FnKeyState,
}

struct FnKeyState {
    app: AppHandle,
    fn_held: AtomicBool,
    event_count: AtomicU64,
    /// Timestamp (ms since epoch) of last fn-press — used to debounce spurious
    /// releases during focus transitions (global ↔ local monitor handoff).
    press_timestamp_ms: AtomicU64,
}

/// Minimum hold duration (ms) before a release is accepted.
/// Prevents false releases caused by focus transitions between global/local monitors.
const MIN_HOLD_MS: u64 = 150;

// ── Local monitor block (returns NSEvent* to not consume the event) ──

#[repr(C)]
struct LocalFnKeyBlock {
    isa: *const c_void,
    flags: i32,
    reserved: i32,
    invoke: unsafe extern "C" fn(*mut LocalFnKeyBlock, *const c_void) -> *const c_void,
    descriptor: *const BlockDescriptor,
    state: *const FnKeyState,
}

unsafe extern "C" fn block_invoke(block: *mut FnKeyBlock, event: *const c_void) {
    let state = &*(*block).state;

    // Count events for diagnostics
    let count = state.event_count.fetch_add(1, Ordering::SeqCst) + 1;

    // Get [event modifierFlags] -> NSUInteger
    let sel = sel_registerName(b"modifierFlags\0".as_ptr());
    let send: unsafe extern "C" fn(*const c_void, *const c_void) -> u64 =
        std::mem::transmute(objc_msgSend as *const c_void);
    let modifier_flags = send(event, sel);

    let fn_pressed = (modifier_flags & NS_EVENT_MODIFIER_FLAG_FUNCTION) != 0;

    if count <= 5 {
        log(&format!(
            "[fnkey] event #{} flags=0x{:X} fn={}",
            count, modifier_flags, fn_pressed
        ));
    }

    if fn_pressed {
        if !state.fn_held.swap(true, Ordering::SeqCst) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            state.press_timestamp_ms.store(now, Ordering::SeqCst);
            log("[fnkey] fn PRESSED — starting recording");
            let _ = state.app.emit("fnkey-pressed", ());
        }
    } else if state.fn_held.swap(false, Ordering::SeqCst) {
        // Debounce: suppress releases within MIN_HOLD_MS of press to avoid
        // false releases during global ↔ local monitor focus transitions.
        let press_ts = state.press_timestamp_ms.load(Ordering::SeqCst);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        if now.saturating_sub(press_ts) < MIN_HOLD_MS {
            // Too fast — likely a focus-transition artefact, re-arm fn_held
            state.fn_held.store(true, Ordering::SeqCst);
            log("[fnkey] fn release suppressed (debounce — focus transition)");
        } else {
            log("[fnkey] fn RELEASED — stopping recording");
            let _ = state.app.emit("fnkey-released", ());
        }
    }
}

unsafe extern "C" fn block_copy_helper(dst: *mut c_void, src: *const c_void) {
    // Copy the state pointer from src block to dst block
    let src_block = src as *const FnKeyBlock;
    let dst_block = dst as *mut FnKeyBlock;
    (*dst_block).state = (*src_block).state;
}

unsafe extern "C" fn block_dispose_helper(_block: *mut c_void) {}

unsafe extern "C" fn local_block_invoke(block: *mut LocalFnKeyBlock, event: *const c_void) -> *const c_void {
    let state = &*(*block).state;

    let sel = sel_registerName(b"modifierFlags\0".as_ptr());
    let send: unsafe extern "C" fn(*const c_void, *const c_void) -> u64 =
        std::mem::transmute(objc_msgSend as *const c_void);
    let modifier_flags = send(event, sel);

    let fn_pressed = (modifier_flags & NS_EVENT_MODIFIER_FLAG_FUNCTION) != 0;

    if fn_pressed {
        if !state.fn_held.swap(true, Ordering::SeqCst) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            state.press_timestamp_ms.store(now, Ordering::SeqCst);
            log("[fnkey] fn PRESSED (local — app focused)");
            let _ = state.app.emit("fnkey-pressed", ());
        }
    } else if state.fn_held.swap(false, Ordering::SeqCst) {
        let press_ts = state.press_timestamp_ms.load(Ordering::SeqCst);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        if now.saturating_sub(press_ts) < MIN_HOLD_MS {
            state.fn_held.store(true, Ordering::SeqCst);
            log("[fnkey] fn release suppressed (debounce — local focus transition)");
        } else {
            log("[fnkey] fn RELEASED (local — app focused)");
            let _ = state.app.emit("fnkey-released", ());
        }
    }

    // Return the event so it's not consumed
    event
}

unsafe extern "C" fn local_block_copy_helper(dst: *mut c_void, src: *const c_void) {
    let src_block = src as *const LocalFnKeyBlock;
    let dst_block = dst as *mut LocalFnKeyBlock;
    (*dst_block).state = (*src_block).state;
}

unsafe extern "C" fn local_block_dispose_helper(_block: *mut c_void) {}

/// Check if accessibility permission is granted via AXIsProcessTrusted.
pub fn is_accessibility_granted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Prompt macOS to show the Accessibility permission dialog.
/// Returns current trust status (usually false until user acts).
pub fn request_accessibility_permission() -> bool {
    unsafe { prompt_accessibility() }
}

/// Set up global fn key monitoring using NSEvent.
/// Must be called from the main thread (Tauri setup closure).
/// Skips monitor setup if accessibility is not granted.
pub fn setup_fn_key_monitor(app: AppHandle) {
    let ax_trusted = unsafe { AXIsProcessTrusted() };
    log(&format!("[fnkey] AXIsProcessTrusted = {}", ax_trusted));

    if !ax_trusted {
        log("[fnkey] Accessibility not granted — skipping monitor setup (will reinit after onboarding)");
        // Store the app handle for later reinitialization
        let mut guard = APP_HANDLE.lock().unwrap();
        *guard = Some(app);
        return;
    }

    init_monitor(app);
}

/// Re-initialize the fn key monitor after accessibility is granted.
/// Called from the frontend after onboarding completes.
pub fn reinit_monitor_if_needed(app: AppHandle) {
    let ax_trusted = unsafe { AXIsProcessTrusted() };
    log(&format!("[fnkey] reinit: AXIsProcessTrusted = {}", ax_trusted));

    if !ax_trusted {
        log("[fnkey] reinit: Still not trusted — cannot start monitor");
        return;
    }

    let already_active = MONITOR_ACTIVE.load(Ordering::SeqCst);
    if already_active {
        log("[fnkey] reinit: Monitor already active — skipping");
        return;
    }

    init_monitor(app);
}

/// Shared app handle for deferred initialization.
static APP_HANDLE: std::sync::Mutex<Option<AppHandle>> = std::sync::Mutex::new(None);
/// Whether the monitor has been successfully started.
static MONITOR_ACTIVE: AtomicBool = AtomicBool::new(false);

// ── Pointer wrappers for Send safety (these are ObjC monitor IDs, accessed under lock) ──

struct SendPtr(*const c_void);
unsafe impl Send for SendPtr {}

struct SendStatePtr(*const FnKeyState);
unsafe impl Send for SendStatePtr {}

/// Stored monitor pointers for teardown.
static GLOBAL_MONITOR: std::sync::Mutex<Option<SendPtr>> = std::sync::Mutex::new(None);
static LOCAL_MONITOR: std::sync::Mutex<Option<SendPtr>> = std::sync::Mutex::new(None);
/// Stored Arc-into-raw pointers so we can reconstitute and drop them on teardown.
static GLOBAL_STATE_PTR: std::sync::Mutex<Option<SendStatePtr>> = std::sync::Mutex::new(None);
static LOCAL_STATE_PTR: std::sync::Mutex<Option<SendStatePtr>> = std::sync::Mutex::new(None);

/// Remove existing NSEvent monitors and reclaim Arc memory. Safe to call even if no monitors exist.
fn teardown_monitors() {
    unsafe {
        let ns_event_class = objc_getClass(b"NSEvent\0".as_ptr());
        let remove_sel = sel_registerName(b"removeMonitor:\0".as_ptr());
        let send_remove: unsafe extern "C" fn(*const c_void, *const c_void, *const c_void) =
            std::mem::transmute(objc_msgSend as *const c_void);

        // Remove global monitor
        if let Ok(mut guard) = GLOBAL_MONITOR.lock() {
            if let Some(SendPtr(ptr)) = guard.take() {
                if !ptr.is_null() {
                    send_remove(ns_event_class, remove_sel, ptr);
                    log("[fnkey] Removed global monitor");
                }
            }
        }

        // Remove local monitor
        if let Ok(mut guard) = LOCAL_MONITOR.lock() {
            if let Some(SendPtr(ptr)) = guard.take() {
                if !ptr.is_null() {
                    send_remove(ns_event_class, remove_sel, ptr);
                    log("[fnkey] Removed local monitor");
                }
            }
        }

        // Reclaim Arc<FnKeyState> to avoid leaks
        if let Ok(mut guard) = GLOBAL_STATE_PTR.lock() {
            if let Some(SendStatePtr(ptr)) = guard.take() {
                if !ptr.is_null() {
                    drop(Arc::from_raw(ptr));
                }
            }
        }
        if let Ok(mut guard) = LOCAL_STATE_PTR.lock() {
            if let Some(SendStatePtr(ptr)) = guard.take() {
                if !ptr.is_null() {
                    drop(Arc::from_raw(ptr));
                }
            }
        }
    }

    MONITOR_ACTIVE.store(false, Ordering::SeqCst);
}

/// Tear down existing monitors and re-initialize. Called on system wake.
pub fn force_reinit_monitor(app: AppHandle) {
    log("[fnkey] force_reinit — tearing down and re-creating monitors");
    teardown_monitors();
    init_monitor(app);
}

fn init_monitor(app: AppHandle) {
    let state = Arc::new(FnKeyState {
        app,
        fn_held: AtomicBool::new(false),
        event_count: AtomicU64::new(0),
        press_timestamp_ms: AtomicU64::new(0),
    });

    // Two Arc references — one for global monitor, one for local monitor
    let state_ptr_global = Arc::into_raw(Arc::clone(&state));
    let state_ptr_local = Arc::into_raw(state);

    unsafe {
        let ns_event_class = objc_getClass(b"NSEvent\0".as_ptr());

        // ── Global monitor (events when app is NOT focused) ──

        static DESCRIPTOR: BlockDescriptor = BlockDescriptor {
            reserved: 0,
            size: std::mem::size_of::<FnKeyBlock>() as u64,
            copy_helper: Some(block_copy_helper),
            dispose_helper: Some(block_dispose_helper),
        };

        let block = Box::new(FnKeyBlock {
            isa: _NSConcreteStackBlock,
            flags: (1 << 25), // BLOCK_HAS_COPY_DISPOSE
            reserved: 0,
            invoke: block_invoke,
            descriptor: &DESCRIPTOR,
            state: state_ptr_global,
        });
        let block_ptr = Box::into_raw(block);

        let sel = sel_registerName(
            b"addGlobalMonitorForEventsMatchingMask:handler:\0".as_ptr(),
        );
        let send: unsafe extern "C" fn(
            *const c_void,
            *const c_void,
            u64,
            *const FnKeyBlock,
        ) -> *const c_void = std::mem::transmute(objc_msgSend as *const c_void);

        let monitor = send(ns_event_class, sel, NS_EVENT_MASK_FLAGS_CHANGED, block_ptr);

        if monitor.is_null() {
            log("[fnkey] NSEvent global monitor FAILED");
        } else {
            log("[fnkey] NSEvent global monitor active");
            if let Ok(mut g) = GLOBAL_MONITOR.lock() { *g = Some(SendPtr(monitor)); }
        }

        // Store state pointer for teardown
        if let Ok(mut g) = GLOBAL_STATE_PTR.lock() { *g = Some(SendStatePtr(state_ptr_global)); }

        // ── Local monitor (events when app IS focused) ──

        static LOCAL_DESCRIPTOR: BlockDescriptor = BlockDescriptor {
            reserved: 0,
            size: std::mem::size_of::<LocalFnKeyBlock>() as u64,
            copy_helper: Some(local_block_copy_helper),
            dispose_helper: Some(local_block_dispose_helper),
        };

        let local_block = Box::new(LocalFnKeyBlock {
            isa: _NSConcreteStackBlock,
            flags: (1 << 25),
            reserved: 0,
            invoke: local_block_invoke,
            descriptor: &LOCAL_DESCRIPTOR,
            state: state_ptr_local,
        });
        let local_block_ptr = Box::into_raw(local_block);

        let local_sel = sel_registerName(
            b"addLocalMonitorForEventsMatchingMask:handler:\0".as_ptr(),
        );
        let local_send: unsafe extern "C" fn(
            *const c_void,
            *const c_void,
            u64,
            *const LocalFnKeyBlock,
        ) -> *const c_void = std::mem::transmute(objc_msgSend as *const c_void);

        let local_monitor = local_send(
            ns_event_class,
            local_sel,
            NS_EVENT_MASK_FLAGS_CHANGED,
            local_block_ptr,
        );

        if local_monitor.is_null() {
            log("[fnkey] NSEvent local monitor FAILED");
        } else {
            log("[fnkey] NSEvent local monitor active");
            if let Ok(mut g) = LOCAL_MONITOR.lock() { *g = Some(SendPtr(local_monitor)); }
        }

        // Store state pointer for teardown
        if let Ok(mut g) = LOCAL_STATE_PTR.lock() { *g = Some(SendStatePtr(state_ptr_local)); }

        if !monitor.is_null() || !local_monitor.is_null() {
            MONITOR_ACTIVE.store(true, Ordering::SeqCst);
            log("[fnkey] fn key monitoring ready — press fn to record");
        }
    }
}
