//! Public keys the app trusts, in `tauri signer` format (base64 of the
//! minisign public key file). The maintainer holds the private halves outside
//! the repository and CI. The updater's binary key is
//! `plugins.updater.pubkey` in `tauri.conf.json`.
//!
//! Installed copies can only ever trust the keys they shipped with, so these
//! must never be regenerated.

/// Verifies the update policy (`policy.rs`). Key ID 90495F7830512B5D.
pub const POLICY_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDkwNDk1Rjc4MzA1MTJCNUQKUldSZEsxRXdlRjlKa0dHQ1FhdmhvL3JpeGZNRXpKWm5nNGNXVWg3blpzTEFSRVVRdEtHSnBTYlMK";

/// Reserved for signed key-rotation messages, so a future release can replace
/// the policy key on copies installed today. Key ID 556198726162E56C.
#[allow(dead_code)]
pub const ROOT_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU1NjE5ODcyNjE2MkU1NkMKUldSczVXSmhjcGhoVlh6YjZFcnhtZE5ya002QkRXWUYrTW9JQ2VaWS83QkxLT3hKRTVJdE50dVYK";
