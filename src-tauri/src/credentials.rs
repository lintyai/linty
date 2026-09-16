//! API keys live in the macOS login Keychain, never in the settings JSON.
use std::sync::Mutex;
use tauri::{Manager, Runtime};
use tauri_plugin_store::StoreExt;

const SERVICE: &str = "ai.linty.desktop.groq";
const ACCOUNT: &str = "api-key";
const SETTINGS: &str = "linty-settings.json";
const LEGACY_KEY: &str = "groqApiKey";
static ACCESS: Mutex<()> = Mutex::new(());

trait SecretStore {
    fn read(&self) -> Result<Option<String>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

struct Keychain;

#[cfg(target_os = "macos")]
impl SecretStore for Keychain {
    fn read(&self) -> Result<Option<String>, String> {
        use security_framework::passwords::get_generic_password;
        match get_generic_password(SERVICE, ACCOUNT) {
            Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|_| {
                "The saved Groq key could not be read. Replace it in Settings.".into()
            }),
            Err(error) if error.code() == -25300 => Ok(None), // errSecItemNotFound
            Err(error) => Err(format!(
                "Could not access macOS Keychain ({}). Unlock your keychain and try again.",
                error.code()
            )),
        }
    }
    fn write(&self, value: &str) -> Result<(), String> {
        security_framework::passwords::set_generic_password(SERVICE, ACCOUNT, value.as_bytes())
            .map_err(|error| {
                format!(
                    "Could not save the Groq key in macOS Keychain ({}).",
                    error.code()
                )
            })
    }
    fn delete(&self) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(SERVICE, ACCOUNT) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(error) => Err(format!(
                "Could not remove the Groq key from macOS Keychain ({}).",
                error.code()
            )),
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl SecretStore for Keychain {
    fn read(&self) -> Result<Option<String>, String> {
        Err("Secure credential storage requires macOS.".into())
    }
    fn write(&self, _: &str) -> Result<(), String> {
        Err("Secure credential storage requires macOS.".into())
    }
    fn delete(&self) -> Result<(), String> {
        Err("Secure credential storage requires macOS.".into())
    }
}

/// Commit cleanup only after Keychain accepts the credential. Failed settings
/// persistence leaves the secure copy intact and migration can be retried.
fn migrate(
    secrets: &impl SecretStore,
    legacy: Option<&str>,
    purge_legacy: impl FnOnce() -> Result<(), String>,
) -> Result<String, String> {
    let saved = secrets.read()?;
    let key = match saved {
        Some(key) => key,
        None => match legacy.map(str::trim).filter(|key| !key.is_empty()) {
            Some(key) => {
                secrets.write(key)?;
                key.to_owned()
            }
            None => String::new(),
        },
    };
    purge_legacy()?;
    Ok(key)
}

fn restore_setting<R: Runtime>(
    store: &tauri_plugin_store::Store<R>,
    name: &str,
    value: Option<serde_json::Value>,
) {
    match value {
        Some(value) => store.set(name, value),
        None => {
            store.delete(name);
        }
    }
}

/// Removes the legacy field from the live store as well as disk, so a later
/// auto-save cannot reintroduce the plaintext key.
fn purge<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let store = app.store(SETTINGS).map_err(|e| e.to_string())?;
    let previous = store.get(LEGACY_KEY);
    if previous.is_none() {
        return Ok(());
    }
    store.delete(LEGACY_KEY);
    if let Err(error) = store.save() {
        restore_setting(&store, LEGACY_KEY, previous);
        return Err(format!(
            "Could not remove the old key from settings: {error}"
        ));
    }
    Ok(())
}

fn read_and_migrate<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<String, String> {
    let store = app.store(SETTINGS).map_err(|e| e.to_string())?;
    let legacy = store.get(LEGACY_KEY);
    let key = migrate(
        &Keychain,
        legacy.as_ref().and_then(|value| value.as_str()),
        || purge(&app),
    )?;
    if legacy
        .as_ref()
        .and_then(|value| value.as_str())
        .is_some_and(|value| !value.is_empty())
    {
        log::info!("[credentials] Legacy Groq key migrated to macOS Keychain");
    }
    Ok(key)
}

#[tauri::command(async)]
pub fn get_groq_api_key(app: tauri::AppHandle) -> Result<String, String> {
    let _guard = ACCESS
        .lock()
        .map_err(|_| "Credential storage is unavailable")?;
    read_and_migrate(&app)
}

#[tauri::command(async)]
pub fn set_groq_api_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let _guard = ACCESS
        .lock()
        .map_err(|_| "Credential storage is unavailable")?;
    let key = key.trim();
    if key.is_empty() {
        return Err("Enter a Groq API key before saving.".into());
    }
    // Preserve any previous credential before cleaning up the legacy settings.
    // If cleanup fails, report failure before replacing the saved key.
    read_and_migrate(&app)?;
    Keychain.write(key)
}

#[tauri::command(async)]
pub fn remove_groq_api_key(app: tauri::AppHandle) -> Result<(), String> {
    let _guard = ACCESS
        .lock()
        .map_err(|_| "Credential storage is unavailable")?;
    if app
        .state::<crate::state::AppState>()
        .recording
        .lock()
        .map_err(|_| "Recording state is unavailable")?
        .is_recording
    {
        return Err("Finish dictating before removing your API key.".into());
    }
    let store = app.store(SETTINGS).map_err(|e| e.to_string())?;
    let previous_key = store.get(LEGACY_KEY);
    let previous_mode = store.get("sttMode");
    store.delete(LEGACY_KEY);
    store.set("sttMode", serde_json::json!("local"));
    let result = store
        .save()
        .map_err(|e| format!("Could not save Local mode: {e}"))
        .and_then(|()| Keychain.delete());
    if let Err(error) = result {
        restore_setting(&store, LEGACY_KEY, previous_key);
        restore_setting(&store, "sttMode", previous_mode);
        let _ = store.save();
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    #[derive(Default)]
    struct FakeSecrets {
        value: RefCell<Option<String>>,
        fail_write: Cell<bool>,
    }
    impl SecretStore for FakeSecrets {
        fn read(&self) -> Result<Option<String>, String> {
            Ok(self.value.borrow().clone())
        }
        fn write(&self, key: &str) -> Result<(), String> {
            if self.fail_write.get() {
                return Err("Keychain locked".into());
            }
            *self.value.borrow_mut() = Some(key.into());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            self.value.borrow_mut().take();
            Ok(())
        }
    }

    #[test]
    fn migration_purges_plaintext_only_after_secure_storage_succeeds() {
        let secrets = FakeSecrets::default();
        secrets.fail_write.set(true);
        let purged = Cell::new(false);
        assert!(migrate(&secrets, Some("synthetic-key"), || {
            purged.set(true);
            Ok(())
        })
        .is_err());
        assert!(!purged.get());
        secrets.fail_write.set(false);
        assert_eq!(
            migrate(&secrets, Some("synthetic-key"), || {
                purged.set(true);
                Ok(())
            })
            .unwrap(),
            "synthetic-key"
        );
        assert!(purged.get());
        assert_eq!(secrets.read().unwrap().as_deref(), Some("synthetic-key"));
    }

    #[test]
    fn cleanup_can_be_retried_and_never_overwrites_a_newer_keychain_key() {
        let secrets = FakeSecrets::default();
        assert!(migrate(&secrets, Some("legacy-key"), || Err("Disk full".into())).is_err());
        assert_eq!(secrets.read().unwrap().as_deref(), Some("legacy-key"));
        secrets.write("replacement-key").unwrap();
        assert_eq!(
            migrate(&secrets, Some("legacy-key"), || Ok(())).unwrap(),
            "replacement-key"
        );
        secrets.delete().unwrap();
        assert_eq!(migrate(&secrets, None, || Ok(())).unwrap(), "");
    }
}
