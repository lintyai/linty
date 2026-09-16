//! Update policy: vendor-signed instructions that stage, pause, force or roll
//! back updates on installed copies.
//!
//! The app fetches one envelope from the policy host:
//!
//! ```json
//! {"payload": "<policy JSON text>", "signature": "<`tauri signer sign` output for payload>"}
//! ```
//!
//! The payload is verified with [`keys::POLICY_PUBLIC_KEY`] before it is
//! parsed. It is accepted only for this app's channel, only while unexpired,
//! and only if its `seq` is higher than any seen before (an equal `seq` must
//! carry the identical payload). The app version may go down on a rollback;
//! the sequence number never does, so a replayed old policy is rejected by any
//! copy that has seen a newer one.
//!
//! Every install the policy directs is pinned to the tarball signature listed
//! in the policy, so the unsigned update manifest cannot substitute another
//! signed build. The request path carries the channel, platform and app
//! version and nothing else; the rollout bucket never leaves the Mac.
//!
//! Once a policy expires its target stays a ceiling, so a pause or a
//! rollback cannot lapse into offering the newest release: only newer
//! releases up to that target are offered until a fresh policy arrives. A
//! copy that has never accepted a policy offers any newer release, as before.
//! Versions any accepted policy blocked are never offered.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use semver::Version;
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::keys;

/// Release channel this build follows.
pub const CHANNEL: &str = "stable";
const POLICY_BASE_URL: &str = "https://updates.linty.ai";
const STATE_FILE: &str = "linty-policy.json";
const STATE_SCHEMA_VERSION: u32 = 1;
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ENVELOPE_BYTES: usize = 64 * 1024;
/// A manual "Check for Updates" ignores the rollout bucket for this long,
/// which covers the policy fetch and the updater check that follows it.
const MANUAL_CHECK_WINDOW: Duration = Duration::from_secs(120);

// ── Policy document ──

/// What the vendor wants copies that are not on the target version to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyAction {
    /// Offer the target to copies below it, within the rollout percentage.
    Prompt,
    /// Require the target, upgrade or downgrade.
    Force,
    /// Require the target from copies above it; offer it to copies below it.
    Rollback,
    /// Offer nothing. Stops a staged rollout without publishing a new build.
    Pause,
    /// An action added after this build. Treated as `Pause`, so a stricter
    /// future directive never loosens what an older copy does.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Deserialize)]
struct PolicyDocument {
    seq: u64,
    issued: String,
    expires: String,
    channel: String,
    target: TargetDocument,
    action: PolicyAction,
    #[serde(default)]
    min_supported_version: Option<String>,
    #[serde(default)]
    blocked_versions: Vec<String>,
    #[serde(default)]
    rollout: RolloutDocument,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    config: RemoteConfig,
}

#[derive(Debug, Deserialize)]
struct TargetDocument {
    version: String,
    /// Tarball signature per updater platform (`darwin-aarch64`), exactly as
    /// published in that release's `latest.json`.
    signatures: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct RolloutDocument {
    #[serde(default = "full_rollout")]
    percent: u8,
    #[serde(default = "yes")]
    force_bypasses: bool,
}

impl Default for RolloutDocument {
    fn default() -> Self {
        Self { percent: full_rollout(), force_bypasses: yes() }
    }
}

/// Settings the vendor can change without a release.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RemoteConfig {
    /// False turns cloud transcription off, e.g. if the provider is abused.
    #[serde(default = "yes")]
    pub cloud_stt_enabled: bool,
    #[serde(default)]
    pub banner: Option<String>,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self { cloud_stt_enabled: true, banner: None }
    }
}

fn yes() -> bool {
    true
}

fn full_rollout() -> u8 {
    100
}

/// A verified, validated policy.
#[derive(Debug, Clone)]
pub struct Policy {
    pub seq: u64,
    pub expires: OffsetDateTime,
    pub target: Version,
    target_signatures: BTreeMap<String, String>,
    pub action: PolicyAction,
    pub min_supported: Option<Version>,
    pub blocked: Vec<Version>,
    pub rollout_percent: u8,
    pub force_bypasses_rollout: bool,
    pub message: Option<String>,
    pub config: RemoteConfig,
}

#[derive(Debug, PartialEq)]
pub enum PolicyError {
    Envelope(String),
    BadSignature,
    Payload(String),
    Invalid(String),
    WrongChannel(String),
    Expired,
    Replayed { seq: u64, highest: u64 },
    Conflicting { seq: u64 },
}

impl std::fmt::Display for PolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Envelope(e) => write!(f, "unreadable envelope: {e}"),
            Self::BadSignature => write!(f, "signature does not verify"),
            Self::Payload(e) => write!(f, "unreadable policy: {e}"),
            Self::Invalid(why) => write!(f, "invalid policy: {why}"),
            Self::WrongChannel(channel) => write!(f, "policy is for channel {channel:?}"),
            Self::Expired => write!(f, "policy has expired"),
            Self::Replayed { seq, highest } => {
                write!(f, "policy seq {seq} is older than seq {highest} already accepted")
            }
            Self::Conflicting { seq } => {
                write!(f, "policy seq {seq} differs from the accepted policy with the same seq")
            }
        }
    }
}

/// Check the envelope's signature and return its payload and signature.
pub fn verify_envelope(body: &[u8], public_key: &str) -> Result<(String, String), PolicyError> {
    #[derive(Deserialize)]
    struct Envelope {
        payload: String,
        signature: String,
    }
    let envelope: Envelope =
        serde_json::from_slice(body).map_err(|e| PolicyError::Envelope(e.to_string()))?;
    verify_signature(envelope.payload.as_bytes(), &envelope.signature, public_key)?;
    Ok((envelope.payload, envelope.signature))
}

/// Same scheme as the updater plugin: both key and signature are base64 of
/// the minisign file text, as `tauri signer` writes them.
fn verify_signature(data: &[u8], signature: &str, public_key: &str) -> Result<(), PolicyError> {
    let decode = |text: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(text.trim())
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or(PolicyError::BadSignature)
    };
    let key_text = decode(public_key)?;
    let key_line = key_text.lines().nth(1).ok_or(PolicyError::BadSignature)?;
    let key = minisign_verify::PublicKey::from_base64(key_line)
        .map_err(|_| PolicyError::BadSignature)?;
    let signature = minisign_verify::Signature::decode(&decode(signature)?)
        .map_err(|_| PolicyError::BadSignature)?;
    key.verify(data, &signature, false)
        .map_err(|_| PolicyError::BadSignature)
}

/// Parse a verified payload and check that it is internally consistent.
pub fn parse_policy(payload: &str, channel: &str) -> Result<Policy, PolicyError> {
    let doc: PolicyDocument =
        serde_json::from_str(payload).map_err(|e| PolicyError::Payload(e.to_string()))?;
    if doc.channel != channel {
        return Err(PolicyError::WrongChannel(doc.channel));
    }
    let version = |text: &str| {
        Version::parse(text).map_err(|_| PolicyError::Invalid(format!("bad version {text:?}")))
    };
    let timestamp = |text: &str| {
        OffsetDateTime::parse(text, &Rfc3339)
            .map_err(|_| PolicyError::Invalid(format!("bad timestamp {text:?}")))
    };

    let target = version(&doc.target.version)?;
    let min_supported = doc.min_supported_version.as_deref().map(version).transpose()?;
    let blocked = doc
        .blocked_versions
        .iter()
        .map(|v| version(v))
        .collect::<Result<Vec<_>, _>>()?;
    let issued = timestamp(&doc.issued)?;
    let expires = timestamp(&doc.expires)?;

    let invalid = |why: &str| Err(PolicyError::Invalid(why.to_string()));
    if expires <= issued {
        return invalid("expires before it is issued");
    }
    if doc.rollout.percent > 100 {
        return invalid("rollout percent above 100");
    }
    if doc.target.signatures.is_empty() {
        return invalid("target lists no signatures");
    }
    if blocked.contains(&target) {
        return invalid("target version is blocked");
    }
    if min_supported.as_ref().is_some_and(|min| &target < min) {
        return invalid("target is below the minimum supported version");
    }

    Ok(Policy {
        seq: doc.seq,
        expires,
        target,
        target_signatures: doc.target.signatures,
        action: doc.action,
        min_supported,
        blocked,
        rollout_percent: doc.rollout.percent,
        force_bypasses_rollout: doc.rollout.force_bypasses,
        message: doc.message,
        config: doc.config,
    })
}

/// Whether `policy` may replace the accepted one. `Ok(true)` means it is new;
/// `Ok(false)` means it is the policy already accepted.
fn check_freshness(
    policy: &Policy,
    payload: &str,
    accepted: Option<(u64, Option<&str>)>,
    now: OffsetDateTime,
) -> Result<bool, PolicyError> {
    if now >= policy.expires {
        return Err(PolicyError::Expired);
    }
    let Some((highest, accepted_payload)) = accepted else {
        return Ok(true);
    };
    match policy.seq.cmp(&highest) {
        std::cmp::Ordering::Less => Err(PolicyError::Replayed { seq: policy.seq, highest }),
        std::cmp::Ordering::Greater => Ok(true),
        std::cmp::Ordering::Equal => match accepted_payload {
            Some(previous) if previous != payload => Err(PolicyError::Conflicting { seq: policy.seq }),
            Some(_) => Ok(false),
            // The stored copy was lost; the signature already verified.
            None => Ok(true),
        },
    }
}

// ── Decisions ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateKind {
    None,
    Prompt,
    Required,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateReason {
    BlockedVersion,
    BelowMinimum,
    Force,
    Rollback,
    Staged,
}

/// What the app should do now, for the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDecision {
    pub update: UpdateKind,
    pub reason: Option<UpdateReason>,
    pub target_version: Option<String>,
    pub message: Option<String>,
    pub cloud_stt_enabled: bool,
    pub banner: Option<String>,
    pub policy_seq: Option<u64>,
}

impl Default for PolicyDecision {
    fn default() -> Self {
        Self {
            update: UpdateKind::None,
            reason: None,
            target_version: None,
            message: None,
            cloud_stt_enabled: true,
            banner: None,
            policy_seq: None,
        }
    }
}

/// `policy` must already be known to be unexpired.
pub fn decide(current: &Version, policy: Option<&Policy>, bucket: u8, manual: bool) -> PolicyDecision {
    let Some(policy) = policy else {
        return PolicyDecision::default();
    };
    let base = PolicyDecision {
        cloud_stt_enabled: policy.config.cloud_stt_enabled,
        banner: policy.config.banner.clone(),
        policy_seq: Some(policy.seq),
        ..PolicyDecision::default()
    };
    if *current == policy.target {
        return base;
    }

    let in_rollout = manual || bucket < policy.rollout_percent;
    let required = policy.force_bypasses_rollout || in_rollout;
    let upgrade = policy.target > *current;
    let (update, reason) = if policy.blocked.contains(current) {
        (UpdateKind::Required, UpdateReason::BlockedVersion)
    } else if policy.min_supported.as_ref().is_some_and(|min| current < min) {
        (UpdateKind::Required, UpdateReason::BelowMinimum)
    } else {
        match policy.action {
            PolicyAction::Force if required => (UpdateKind::Required, UpdateReason::Force),
            PolicyAction::Rollback if !upgrade && required => {
                (UpdateKind::Required, UpdateReason::Rollback)
            }
            PolicyAction::Prompt | PolicyAction::Rollback if upgrade && in_rollout => {
                (UpdateKind::Prompt, UpdateReason::Staged)
            }
            _ => return base,
        }
    };
    PolicyDecision {
        update,
        reason: Some(reason),
        target_version: Some(policy.target.to_string()),
        message: policy.message.clone(),
        ..base
    }
}

/// The updater's version comparator: may the release at `remote` be installed?
/// `policy` is the unexpired policy, if any; `sticky` is what every accepted
/// policy leaves behind even after it expires.
pub fn allows(
    current: &Version,
    remote: &Version,
    remote_signature: Option<&str>,
    policy: Option<&Policy>,
    sticky: &Sticky,
    bucket: u8,
    manual: bool,
) -> bool {
    if sticky.blocked.contains(remote) {
        return false;
    }
    let Some(policy) = policy else {
        return remote > current && sticky.ceiling.as_ref().is_none_or(|ceiling| remote <= ceiling);
    };
    let decision = decide(current, Some(policy), bucket, manual);
    if decision.update == UpdateKind::None || *remote != policy.target {
        return false;
    }
    let pinned = match (remote_signature, policy.target_signatures.get(&platform())) {
        (Some(got), Some(want)) => got.trim() == want.trim(),
        _ => false,
    };
    pinned && (remote > current || decision.update == UpdateKind::Required)
}

/// Updater platform key, e.g. `darwin-aarch64`.
pub fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{}-{}", os, std::env::consts::ARCH)
}

/// What an accepted policy leaves in force after it expires.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Sticky {
    /// Never offered.
    pub blocked: Vec<Version>,
    /// Target of the last accepted policy; nothing above it is offered.
    pub ceiling: Option<Version>,
}

impl Sticky {
    fn from_policy(policy: &Policy) -> Self {
        Self { blocked: policy.blocked.clone(), ceiling: Some(policy.target.clone()) }
    }
}

// ── Stored state ──

/// `linty-policy.json` in the app data directory. Not user data:
/// `reset_all_data` keeps it so replay protection survives a reset.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredState {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    rollout_bucket: Option<u8>,
    #[serde(default)]
    highest_seq: Option<u64>,
    #[serde(default)]
    payload: Option<String>,
    #[serde(default)]
    signature: Option<String>,
    #[serde(default)]
    accepted_at: Option<String>,
    /// Kept after the policy expires so a blocked build is never offered.
    #[serde(default)]
    blocked_versions: Vec<String>,
    /// Target of the last accepted policy, kept as a ceiling after it expires.
    #[serde(default)]
    ceiling_version: Option<String>,
}

struct Inner {
    state: StoredState,
    policy: Option<Policy>,
    sticky: Sticky,
    manual_until: Option<Instant>,
}

pub struct PolicyStore {
    public_key: String,
    channel: String,
    path: OnceLock<PathBuf>,
    inner: Mutex<Inner>,
}

impl PolicyStore {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::with_key(keys::POLICY_PUBLIC_KEY, CHANNEL))
    }

    fn with_key(public_key: &str, channel: &str) -> Self {
        Self {
            public_key: public_key.to_string(),
            channel: channel.to_string(),
            path: OnceLock::new(),
            inner: Mutex::new(Inner {
                state: StoredState::default(),
                policy: None,
                sticky: Sticky::default(),
                manual_until: None,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Read the stored state from `dir`, re-verifying the stored policy.
    pub fn load(&self, dir: &Path) {
        let path = dir.join(STATE_FILE);
        let _ = self.path.set(path.clone());
        let mut state: StoredState = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
                log::warn!("[policy] Ignoring unreadable {}: {}", STATE_FILE, e);
                StoredState::default()
            }),
            Err(_) => StoredState::default(),
        };

        let mut inner = self.lock();
        let mut dirty = state.schema_version != STATE_SCHEMA_VERSION;
        state.schema_version = STATE_SCHEMA_VERSION;
        if state.rollout_bucket.is_none_or(|bucket| bucket >= 100) {
            state.rollout_bucket = Some(random_bucket());
            dirty = true;
        }

        let stored = match (state.payload.as_deref(), state.signature.as_deref()) {
            (Some(payload), Some(signature)) => {
                verify_signature(payload.as_bytes(), signature, &self.public_key)
                    .and_then(|()| parse_policy(payload, &self.channel))
                    .map_err(|e| log::warn!("[policy] Dropping stored policy: {}", e))
                    .ok()
            }
            _ => None,
        };
        if stored.is_none() && state.payload.is_some() {
            state.payload = None;
            state.signature = None;
            dirty = true;
        }
        inner.sticky = match &stored {
            Some(policy) => Sticky::from_policy(policy),
            None => Sticky {
                blocked: state
                    .blocked_versions
                    .iter()
                    .filter_map(|v| Version::parse(v).ok())
                    .collect(),
                ceiling: state.ceiling_version.as_deref().and_then(|v| Version::parse(v).ok()),
            },
        };
        if let Some(policy) = &stored {
            log::info!(
                "[policy] Loaded seq {} ({:?} {}, expires {})",
                policy.seq,
                policy.action,
                policy.target,
                policy.expires
            );
        }
        inner.policy = stored;
        inner.state = state;
        if dirty {
            self.save(&inner);
        }
    }

    /// Verify and adopt a fetched envelope. `Ok(true)` if the policy is new.
    pub fn ingest(&self, body: &[u8], now: OffsetDateTime) -> Result<bool, PolicyError> {
        let (payload, signature) = verify_envelope(body, &self.public_key)?;
        let policy = parse_policy(&payload, &self.channel)?;
        let mut inner = self.lock();
        let accepted = inner
            .state
            .highest_seq
            .map(|seq| (seq, inner.state.payload.as_deref()));
        if !check_freshness(&policy, &payload, accepted, now)? {
            return Ok(false);
        }
        inner.state.highest_seq = Some(policy.seq);
        inner.state.payload = Some(payload);
        inner.state.signature = Some(signature);
        inner.state.accepted_at = now.format(&Rfc3339).ok();
        inner.state.blocked_versions = policy.blocked.iter().map(Version::to_string).collect();
        inner.state.ceiling_version = Some(policy.target.to_string());
        inner.sticky = Sticky::from_policy(&policy);
        if policy.action == PolicyAction::Unknown {
            log::warn!("[policy] Seq {} has an action this build does not know; treating it as pause", policy.seq);
        }
        inner.policy = Some(policy);
        self.save(&inner);
        Ok(true)
    }

    /// Let the next updater check ignore the rollout bucket.
    pub fn mark_manual_check(&self) {
        self.lock().manual_until = Some(Instant::now() + MANUAL_CHECK_WINDOW);
    }

    pub fn decision(&self, current: &Version, now: OffsetDateTime) -> PolicyDecision {
        let inner = self.lock();
        decide(
            current,
            usable(&inner, now),
            rollout_bucket(&inner),
            manual_active(&inner),
        )
    }

    /// Comparator for `tauri_plugin_updater::Builder::default_version_comparator`.
    pub fn allows_release(&self, current: &Version, release: &tauri_plugin_updater::RemoteRelease) -> bool {
        let platform = platform();
        let signature = release
            .signature(&platform)
            .or_else(|_| release.signature(&format!("{platform}-app")))
            .ok()
            .map(String::as_str);
        let inner = self.lock();
        let policy = usable(&inner, OffsetDateTime::now_utc());
        let allowed = allows(
            current,
            &release.version,
            signature,
            policy,
            &inner.sticky,
            rollout_bucket(&inner),
            manual_active(&inner),
        );
        log::info!(
            "[policy] Release {} for {}: {} ({})",
            release.version,
            current,
            if allowed { "offered" } else { "not offered" },
            match policy {
                Some(policy) => format!("policy seq {}", policy.seq),
                None => "no active policy".to_string(),
            }
        );
        allowed
    }

    fn save(&self, inner: &Inner) {
        let Some(path) = self.path.get() else {
            return;
        };
        let result = serde_json::to_vec_pretty(&inner.state)
            .map_err(|e| e.to_string())
            .and_then(|bytes| write_atomically(path, &bytes).map_err(|e| e.to_string()));
        if let Err(e) = result {
            log::error!("[policy] Could not save {}: {}", STATE_FILE, e);
        }
    }
}

fn usable(inner: &Inner, now: OffsetDateTime) -> Option<&Policy> {
    inner.policy.as_ref().filter(|policy| now < policy.expires)
}

/// Before the stored state loads, sit at the back of every staged rollout.
fn rollout_bucket(inner: &Inner) -> u8 {
    inner.state.rollout_bucket.unwrap_or(99)
}

fn manual_active(inner: &Inner) -> bool {
    inner.manual_until.is_some_and(|until| Instant::now() < until)
}

fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temp = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        // Without this a power loss can leave an empty file behind the rename,
        // losing the sequence number that blocks replays.
        file.sync_all()?;
    }
    std::fs::rename(&temp, path)
}

/// 0–99, drawn once per install. `RandomState` is seeded from the OS
/// random source, which is enough for bucketing.
fn random_bucket() -> u8 {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    (hasher.finish() % 100) as u8
}

// ── Fetching ──

fn policy_url(version: &Version) -> String {
    // Debug builds can point at a local policy server; release builds cannot.
    let base = if cfg!(debug_assertions) {
        std::env::var("LINTY_POLICY_URL").unwrap_or_else(|_| POLICY_BASE_URL.to_string())
    } else {
        POLICY_BASE_URL.to_string()
    };
    format!(
        "{}/v1/policy/{}/{}/{}",
        base.trim_end_matches('/'),
        CHANNEL,
        platform(),
        version
    )
}

/// `Ok(None)` when the host has no policy for this channel (HTTP 204).
async fn fetch_envelope(url: &str) -> Result<Option<Vec<u8>>, String> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if status == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > MAX_ENVELOPE_BYTES {
            return Err(format!("response larger than {MAX_ENVELOPE_BYTES} bytes"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(Some(body))
}

/// Fetch the latest policy, then report what the app should do. Fetch and
/// verification failures are logged; the last accepted policy stays in force
/// until it expires.
#[tauri::command]
pub async fn check_policy(
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<PolicyStore>>,
    manual: Option<bool>,
) -> Result<PolicyDecision, String> {
    let current = app.package_info().version.clone();
    if manual.unwrap_or(false) {
        store.mark_manual_check();
    }
    match fetch_envelope(&policy_url(&current)).await {
        Ok(Some(body)) => match store.ingest(&body, OffsetDateTime::now_utc()) {
            Ok(true) => log::info!("[policy] Accepted a new policy"),
            Ok(false) => log::debug!("[policy] Policy unchanged"),
            Err(e) => log::warn!("[policy] Rejected fetched policy: {}", e),
        },
        Ok(None) => log::debug!("[policy] No policy published for {}", CHANNEL),
        Err(e) => log::info!("[policy] Could not fetch policy: {}", e),
    }
    Ok(store.decision(&current, OffsetDateTime::now_utc()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    const NOW: OffsetDateTime = datetime!(2026-09-17 12:00 UTC);

    struct TestKey {
        keypair: minisign::KeyPair,
        public_key: String,
    }

    impl TestKey {
        fn new() -> Self {
            let keypair = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
            let public_key = b64(&keypair.pk.to_box().unwrap().to_string());
            Self { keypair, public_key }
        }

        fn sign(&self, payload: &str) -> String {
            let signature = minisign::sign(
                Some(&self.keypair.pk),
                &self.keypair.sk,
                std::io::Cursor::new(payload.as_bytes()),
                Some("test"),
                None,
            )
            .unwrap();
            b64(&signature.to_string())
        }

        fn envelope(&self, payload: &str) -> Vec<u8> {
            serde_json::to_vec(&serde_json::json!({
                "payload": payload,
                "signature": self.sign(payload),
            }))
            .unwrap()
        }
    }

    fn b64(text: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(text)
    }

    fn v(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    /// A policy document; `edit` adjusts the JSON before it is serialized.
    fn payload(seq: u64, edit: impl FnOnce(&mut serde_json::Value)) -> String {
        let mut doc = serde_json::json!({
            "seq": seq,
            "issued": "2026-09-17T09:00:00Z",
            "expires": "2026-09-20T09:00:00Z",
            "channel": "stable",
            "target": {
                "version": "0.0.40",
                "signatures": { platform(): "sig-0.0.40" }
            },
            "action": "prompt",
            "rollout": { "percent": 25 }
        });
        edit(&mut doc);
        doc.to_string()
    }

    fn policy(edit: impl FnOnce(&mut serde_json::Value)) -> Policy {
        parse_policy(&payload(1, edit), "stable").unwrap()
    }

    #[test]
    fn verifies_signatures_and_rejects_tampering() {
        let key = TestKey::new();
        let text = payload(1, |_| {});
        assert_eq!(verify_envelope(&key.envelope(&text), &key.public_key).unwrap().0, text);

        let mut forged: serde_json::Value = serde_json::from_slice(&key.envelope(&text)).unwrap();
        forged["payload"] = serde_json::Value::String(text.replace("prompt", "force"));
        let forged = serde_json::to_vec(&forged).unwrap();
        assert_eq!(verify_envelope(&forged, &key.public_key), Err(PolicyError::BadSignature));

        let other = TestKey::new();
        assert_eq!(
            verify_envelope(&key.envelope(&text), &other.public_key),
            Err(PolicyError::BadSignature)
        );
        assert!(matches!(verify_envelope(b"not json", &key.public_key), Err(PolicyError::Envelope(_))));
    }

    #[test]
    fn accepts_the_format_tauri_signer_writes_with_the_release_key() {
        // Signed with the release policy key by `tauri signer sign`. Its
        // channel is not one any build follows, so it can never be adopted.
        let body = include_bytes!("../tests/fixtures/policy_signed_with_release_key.json");
        let (text, _) = verify_envelope(body, keys::POLICY_PUBLIC_KEY).unwrap();
        assert!(matches!(parse_policy(&text, CHANNEL), Err(PolicyError::WrongChannel(_))));
        assert!(parse_policy(&text, "signing-fixture").is_ok());
    }

    #[test]
    fn rejects_inconsistent_policies() {
        let invalid = |edit: fn(&mut serde_json::Value)| {
            matches!(parse_policy(&payload(1, edit), "stable"), Err(PolicyError::Invalid(_)))
        };
        assert!(invalid(|d| d["target"]["version"] = "latest".into()));
        assert!(invalid(|d| d["expires"] = "2026-09-16T00:00:00Z".into()));
        assert!(invalid(|d| d["expires"] = "soon".into()));
        assert!(invalid(|d| d["rollout"]["percent"] = 101.into()));
        assert!(invalid(|d| d["target"]["signatures"] = serde_json::json!({})));
        assert!(invalid(|d| d["blocked_versions"] = serde_json::json!(["0.0.40"])));
        assert!(invalid(|d| d["min_supported_version"] = "0.0.41".into()));
        assert!(matches!(
            parse_policy(&payload(1, |d| d["channel"] = "beta".into()), "stable"),
            Err(PolicyError::WrongChannel(_))
        ));
    }

    #[test]
    fn unknown_actions_act_like_pause() {
        let p = policy(|d| {
            d["action"] = "canary".into();
            d["blocked_versions"] = serde_json::json!(["0.0.41"]);
        });
        assert_eq!(p.action, PolicyAction::Unknown);
        assert_eq!(decide(&v("0.0.39"), Some(&p), 0, true).update, UpdateKind::None);
        assert_eq!(decide(&v("0.0.41"), Some(&p), 99, false).update, UpdateKind::Required);
        assert!(!allows(&v("0.0.39"), &v("0.0.40"), Some("sig-0.0.40"), Some(&p), &Sticky::default(), 0, true));
    }

    #[test]
    fn sequence_numbers_only_move_forward() {
        let text = payload(5, |_| {});
        let p = parse_policy(&text, "stable").unwrap();
        assert_eq!(check_freshness(&p, &text, None, NOW), Ok(true));
        assert_eq!(check_freshness(&p, &text, Some((4, None)), NOW), Ok(true));
        assert_eq!(check_freshness(&p, &text, Some((5, Some(&text))), NOW), Ok(false));
        assert_eq!(check_freshness(&p, &text, Some((5, None)), NOW), Ok(true));
        assert_eq!(
            check_freshness(&p, &text, Some((5, Some("other"))), NOW),
            Err(PolicyError::Conflicting { seq: 5 })
        );
        assert_eq!(
            check_freshness(&p, &text, Some((6, Some("newer"))), NOW),
            Err(PolicyError::Replayed { seq: 5, highest: 6 })
        );
        assert_eq!(
            check_freshness(&p, &text, None, datetime!(2026-09-20 09:00 UTC)),
            Err(PolicyError::Expired)
        );
    }

    #[test]
    fn no_policy_means_no_decision() {
        assert_eq!(decide(&v("0.0.30"), None, 0, false), PolicyDecision::default());
    }

    #[test]
    fn prompt_respects_the_rollout_bucket_unless_checked_by_hand() {
        let p = policy(|_| {});
        let current = v("0.0.39");
        assert_eq!(decide(&current, Some(&p), 24, false).update, UpdateKind::Prompt);
        assert_eq!(decide(&current, Some(&p), 25, false).update, UpdateKind::None);
        assert_eq!(decide(&current, Some(&p), 99, true).update, UpdateKind::Prompt);
        // Nothing to offer at or above the target.
        assert_eq!(decide(&v("0.0.40"), Some(&p), 0, true).update, UpdateKind::None);
        assert_eq!(decide(&v("0.0.41"), Some(&p), 0, true).update, UpdateKind::None);
    }

    #[test]
    fn force_and_rollback_are_required() {
        let force = policy(|d| d["action"] = "force".into());
        let d = decide(&v("0.0.41"), Some(&force), 99, false);
        assert_eq!((d.update, d.reason), (UpdateKind::Required, Some(UpdateReason::Force)));
        assert_eq!(d.target_version.as_deref(), Some("0.0.40"));

        let rollback = policy(|d| d["action"] = "rollback".into());
        let above = decide(&v("0.0.41"), Some(&rollback), 99, false);
        assert_eq!((above.update, above.reason), (UpdateKind::Required, Some(UpdateReason::Rollback)));
        // Copies below the rollback target are only offered it, within the rollout.
        assert_eq!(decide(&v("0.0.39"), Some(&rollback), 99, false).update, UpdateKind::None);
        assert_eq!(decide(&v("0.0.39"), Some(&rollback), 0, false).update, UpdateKind::Prompt);

        let staged = policy(|d| {
            d["action"] = "force".into();
            d["rollout"]["force_bypasses"] = false.into();
        });
        assert_eq!(decide(&v("0.0.41"), Some(&staged), 99, false).update, UpdateKind::None);
        assert_eq!(decide(&v("0.0.41"), Some(&staged), 10, false).update, UpdateKind::Required);
    }

    #[test]
    fn blocked_and_unsupported_versions_must_move_even_when_paused() {
        let p = policy(|d| {
            d["action"] = "pause".into();
            d["blocked_versions"] = serde_json::json!(["0.0.41"]);
            d["min_supported_version"] = "0.0.35".into();
        });
        let blocked = decide(&v("0.0.41"), Some(&p), 99, false);
        assert_eq!((blocked.update, blocked.reason), (UpdateKind::Required, Some(UpdateReason::BlockedVersion)));
        let old = decide(&v("0.0.30"), Some(&p), 99, false);
        assert_eq!((old.update, old.reason), (UpdateKind::Required, Some(UpdateReason::BelowMinimum)));
        assert_eq!(decide(&v("0.0.38"), Some(&p), 0, true).update, UpdateKind::None);
    }

    #[test]
    fn remote_config_is_reported_with_every_decision() {
        let p = policy(|d| d["config"] = serde_json::json!({ "cloud_stt_enabled": false, "banner": "Maintenance" }));
        let d = decide(&v("0.0.40"), Some(&p), 0, false);
        assert!(!d.cloud_stt_enabled);
        assert_eq!(d.banner.as_deref(), Some("Maintenance"));
        assert_eq!(d.policy_seq, Some(1));
    }

    #[test]
    fn comparator_without_policy_keeps_todays_behaviour() {
        let current = v("0.0.39");
        let none = Sticky::default();
        assert!(allows(&current, &v("0.0.40"), None, None, &none, 0, false));
        assert!(!allows(&current, &v("0.0.38"), None, None, &none, 0, false));
        let blocked = Sticky { blocked: vec![v("0.0.40")], ceiling: None };
        assert!(!allows(&current, &v("0.0.40"), None, None, &blocked, 0, false));
    }

    #[test]
    fn an_expired_policy_leaves_its_target_as_a_ceiling() {
        let held = Sticky { blocked: Vec::new(), ceiling: Some(v("0.0.40")) };
        assert!(allows(&v("0.0.39"), &v("0.0.40"), None, None, &held, 0, false));
        assert!(!allows(&v("0.0.39"), &v("0.0.41"), None, None, &held, 0, false));
        assert!(!allows(&v("0.0.40"), &v("0.0.41"), None, None, &held, 0, false));
        assert!(!allows(&v("0.0.41"), &v("0.0.40"), None, None, &held, 0, false));
    }

    #[test]
    fn comparator_follows_the_policy_and_pins_the_signature() {
        let sig = Some("sig-0.0.40");
        let prompt = policy(|_| {});
        let current = v("0.0.39");
        assert!(allows(&current, &v("0.0.40"), sig, Some(&prompt), &Sticky::default(), 0, false));
        // Outside the rollout, a different release, or a different tarball.
        assert!(!allows(&current, &v("0.0.40"), sig, Some(&prompt), &Sticky::default(), 50, false));
        assert!(!allows(&current, &v("0.0.41"), Some("sig-0.0.41"), Some(&prompt), &Sticky::default(), 0, false));
        assert!(!allows(&current, &v("0.0.40"), Some("sig-other"), Some(&prompt), &Sticky::default(), 0, false));
        assert!(!allows(&current, &v("0.0.40"), None, Some(&prompt), &Sticky::default(), 0, false));

        // A downgrade needs a rollback or force directive.
        let rollback = policy(|d| d["action"] = "rollback".into());
        assert!(allows(&v("0.0.41"), &v("0.0.40"), sig, Some(&rollback), &Sticky::default(), 99, false));
        let above_prompt = policy(|_| {});
        assert!(!allows(&v("0.0.41"), &v("0.0.40"), sig, Some(&above_prompt), &Sticky::default(), 0, true));

        let paused = policy(|d| d["action"] = "pause".into());
        assert!(!allows(&current, &v("0.0.40"), sig, Some(&paused), &Sticky::default(), 0, true));
    }

    #[test]
    fn store_persists_state_and_survives_restarts() {
        let key = TestKey::new();
        let dir = std::env::temp_dir().join(format!("linty-policy-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let store = PolicyStore::with_key(&key.public_key, "stable");
        store.load(&dir);
        let bucket = store.lock().state.rollout_bucket.unwrap();
        assert!(bucket < 100);

        let first = payload(3, |d| d["blocked_versions"] = serde_json::json!(["0.0.37"]));
        assert_eq!(store.ingest(&key.envelope(&first), NOW), Ok(true));
        assert_eq!(store.ingest(&key.envelope(&first), NOW), Ok(false));
        let older = payload(2, |_| {});
        assert_eq!(
            store.ingest(&key.envelope(&older), NOW),
            Err(PolicyError::Replayed { seq: 2, highest: 3 })
        );

        let reloaded = PolicyStore::with_key(&key.public_key, "stable");
        reloaded.load(&dir);
        {
            let inner = reloaded.lock();
            assert_eq!(inner.state.rollout_bucket, Some(bucket));
            assert_eq!(inner.policy.as_ref().map(|p| p.seq), Some(3));
            assert_eq!(inner.sticky, Sticky { blocked: vec![v("0.0.37")], ceiling: Some(v("0.0.40")) });
        }
        assert_eq!(reloaded.decision(&v("0.0.37"), NOW).reason, Some(UpdateReason::BlockedVersion));
        // Expired: no decision, but the blocked version stays blocked.
        let later = datetime!(2026-10-01 00:00 UTC);
        assert_eq!(reloaded.decision(&v("0.0.37"), later), PolicyDecision::default());

        // A stored policy whose signature no longer verifies is dropped; the
        // sequence number, blocked list and ceiling are kept.
        let path = dir.join(STATE_FILE);
        let mut raw: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        raw["payload"] = serde_json::Value::String(first.replace("prompt", "force"));
        std::fs::write(&path, serde_json::to_vec(&raw).unwrap()).unwrap();
        let tampered = PolicyStore::with_key(&key.public_key, "stable");
        tampered.load(&dir);
        {
            let inner = tampered.lock();
            assert!(inner.policy.is_none());
            assert_eq!(inner.state.highest_seq, Some(3));
            assert_eq!(inner.sticky, Sticky { blocked: vec![v("0.0.37")], ceiling: Some(v("0.0.40")) });
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn manual_checks_open_a_short_window() {
        let store = PolicyStore::with_key("unused", "stable");
        assert!(!manual_active(&store.lock()));
        store.mark_manual_check();
        assert!(manual_active(&store.lock()));
    }

    #[test]
    fn comparator_reads_the_updater_plugins_release() {
        let key = TestKey::new();
        let dir = std::env::temp_dir().join(format!("linty-policy-release-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = PolicyStore::with_key(&key.public_key, "stable");
        store.load(&dir);
        store.lock().state.rollout_bucket = Some(0);

        let now = OffsetDateTime::now_utc();
        let text = payload(1, |d| {
            d["action"] = "rollback".into();
            d["issued"] = (now - time::Duration::hours(1)).format(&Rfc3339).unwrap().into();
            d["expires"] = (now + time::Duration::days(1)).format(&Rfc3339).unwrap().into();
        });
        assert_eq!(store.ingest(&key.envelope(&text), now), Ok(true));

        let release = |signature: &str| -> tauri_plugin_updater::RemoteRelease {
            serde_json::from_value(serde_json::json!({
                "version": "0.0.40",
                "platforms": { platform(): { "signature": signature, "url": "https://example.com/Linty.app.tar.gz" } }
            }))
            .unwrap()
        };
        assert!(store.allows_release(&v("0.0.41"), &release("sig-0.0.40")));
        assert!(!store.allows_release(&v("0.0.41"), &release("sig-substituted")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Serves one canned HTTP response on a local port.
    fn serve_once(response: Vec<u8>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/policy", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request = [0_u8; 4096];
                let _ = stream.read(&mut request);
                let _ = stream.write_all(&response);
            }
        });
        url
    }

    fn http(status: &str, body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response
    }

    #[tokio::test]
    async fn fetch_handles_success_absence_errors_and_oversized_bodies() {
        let body = br#"{"payload":"{}","signature":"x"}"#;
        assert_eq!(fetch_envelope(&serve_once(http("200 OK", body))).await, Ok(Some(body.to_vec())));
        assert_eq!(
            fetch_envelope(&serve_once(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n".to_vec())).await,
            Ok(None)
        );
        assert_eq!(
            fetch_envelope(&serve_once(http("503 Service Unavailable", b"down"))).await,
            Err("HTTP 503 Service Unavailable".to_string())
        );
        let huge = vec![b'a'; MAX_ENVELOPE_BYTES + 1];
        assert!(fetch_envelope(&serve_once(http("200 OK", &huge))).await.is_err());
    }

    #[test]
    fn policy_url_names_only_channel_platform_and_version() {
        let url = policy_url(&v("0.0.38"));
        assert!(url.ends_with(&format!("/v1/policy/stable/{}/0.0.38", platform())), "{url}");
    }
}
