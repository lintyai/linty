/// Only app identity is captured, once at the start of a dictation.
/// No window titles, URLs, process scans, or background activity log.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationIdentity {
    pub name: String,
    pub bundle_id: Option<String>,
}

#[cfg(target_os = "macos")]
pub fn frontmost_application() -> Option<ApplicationIdentity> {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CStr;

    unsafe fn string(value: *mut Object) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let utf8: *const std::os::raw::c_char = msg_send![value, UTF8String];
        if utf8.is_null() {
            return None;
        }
        Some(CStr::from_ptr(utf8).to_string_lossy().into_owned())
    }

    // start_recording is a synchronous Tauri command, on the main thread.
    // Copy the strings before draining the autorelease pool.
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: *mut Object = msg_send![workspace, frontmostApplication];
        let result = if app.is_null() {
            None
        } else {
            let name: *mut Object = msg_send![app, localizedName];
            let bundle: *mut Object = msg_send![app, bundleIdentifier];
            string(name).map(|name| ApplicationIdentity {
                name,
                bundle_id: string(bundle),
            })
        };
        let _: () = msg_send![pool, drain];
        result
    }
}

#[cfg(not(target_os = "macos"))]
pub fn frontmost_application() -> Option<ApplicationIdentity> {
    None
}
