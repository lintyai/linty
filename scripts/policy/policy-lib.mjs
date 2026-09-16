// Pure helpers for scripts/policy/publish.mjs. The app-side rules live in
// src-tauri/src/policy.rs; this file only builds and checks what is published.
import { createHash, createPublicKey, verify } from "node:crypto";

export const ACTIONS = ["prompt", "force", "rollback", "pause"];
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DAY_SECONDS = 86_400;

export function isVersion(text) {
  return typeof text === "string" && VERSION.test(text);
}

/** Semver ordering for the versions Linty ships (build metadata ignored). */
export function compareVersions(a, b) {
  const [, ...pa] = VERSION.exec(a);
  const [, ...pb] = VERSION.exec(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) return Math.sign(diff);
  }
  if (pa[3] === pb[3]) return 0;
  if (pa[3] === undefined) return 1;
  if (pb[3] === undefined) return -1;
  return pa[3] < pb[3] ? -1 : 1;
}

/** POLICY_PUBLIC_KEY from src-tauri/src/keys.rs. */
export function policyPublicKey(keysSource) {
  const match = /pub const POLICY_PUBLIC_KEY: &str = "([A-Za-z0-9+/=]+)";/.exec(keysSource);
  if (!match) throw new Error("POLICY_PUBLIC_KEY not found in keys.rs");
  return match[1];
}

function minisignLines(tauriBase64) {
  return Buffer.from(tauriBase64.trim(), "base64").toString("utf8").split("\n");
}

/**
 * Verify a `tauri signer sign` signature (base64 of a minisign signature file)
 * against a `tauri signer` public key, including the trusted comment.
 */
export function verifyTauriSignature(data, signature, publicKey) {
  try {
    const keyBytes = Buffer.from(minisignLines(publicKey)[1] ?? "", "base64");
    if (keyBytes.length !== 42 || keyBytes.subarray(0, 2).toString() !== "Ed") return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, keyBytes.subarray(10)]),
      format: "der",
      type: "spki",
    });

    const lines = minisignLines(signature);
    const sigBytes = Buffer.from(lines[1] ?? "", "base64");
    const trusted = lines[2] ?? "";
    const globalSig = Buffer.from(lines[3] ?? "", "base64");
    if (sigBytes.length !== 74 || !trusted.startsWith("trusted comment: ") || globalSig.length !== 64) {
      return false;
    }
    if (!sigBytes.subarray(2, 10).equals(keyBytes.subarray(2, 10))) return false;
    // Only prehashed signatures, as the app accepts (`allow_legacy = false`).
    if (sigBytes.subarray(0, 2).toString() !== "ED") return false;

    const digest = createHash("blake2b512").update(data).digest();
    const signed = sigBytes.subarray(10);
    const trustedText = Buffer.from(trusted.slice("trusted comment: ".length));
    return (
      verify(null, digest, key, signed) &&
      verify(null, Buffer.concat([signed, trustedText]), key, globalSig)
    );
  } catch {
    return false;
  }
}

/** `{ platform: signature }` from a release's latest.json. */
export function releaseSignatures(manifest) {
  const signatures = {};
  for (const [platform, entry] of Object.entries(manifest?.platforms ?? {})) {
    if (typeof entry?.signature === "string" && entry.signature.trim()) {
      signatures[platform] = entry.signature.trim();
    }
  }
  return signatures;
}

/** Payload object of a published envelope, or null. */
export function envelopePolicy(envelopeText) {
  if (!envelopeText) return null;
  const { payload } = JSON.parse(envelopeText);
  return JSON.parse(payload);
}

function uniqueSorted(versions) {
  return [...new Set(versions)].sort(compareVersions);
}

/**
 * Build the next policy document.
 *
 * `previous` is the policy currently published (or null). Blocked versions,
 * the minimum version and remote config carry over unless changed, so a new
 * rollout can never silently unblock a bad build or turn cloud transcription
 * back on. `message` does not carry over. `refresh` re-signs `previous` with a
 * new sequence number and expiry and changes nothing else.
 */
export function buildPolicy({ options, previous, manifest, nowSeconds }) {
  const channel = options.channel ?? "stable";
  const days = options.days ?? 14;
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("--days must be 1 to 90");
  if (previous && previous.channel !== channel) throw new Error(`published policy is for ${previous.channel}`);

  const seq = Math.max(nowSeconds, (previous?.seq ?? 0) + 1);
  const issued = new Date(nowSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const expires = new Date((nowSeconds + days * DAY_SECONDS) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

  if (options.refresh) {
    if (!previous) throw new Error("--refresh needs a published policy");
    return { ...previous, seq, issued, expires };
  }

  const action = options.action;
  if (!ACTIONS.includes(action)) throw new Error(`--action must be one of ${ACTIONS.join(", ")}`);
  const version = options.version ?? previous?.target?.version;
  if (!isVersion(version)) throw new Error("--version is required (x.y.z)");

  const signatures = manifest
    ? releaseSignatures(manifest)
    : version === previous?.target?.version
      ? previous.target.signatures
      : {};
  if (Object.keys(signatures).length === 0) throw new Error(`no signatures found for ${version}`);
  if (manifest && String(manifest.version).replace(/^v/, "") !== version) {
    throw new Error(`latest.json names ${manifest.version}, not ${version}`);
  }

  for (const v of [...(options.block ?? []), ...(options.unblock ?? [])]) {
    if (!isVersion(v)) throw new Error(`not a version: ${v}`);
  }
  const blocked = uniqueSorted(
    [...(previous?.blocked_versions ?? []), ...(options.block ?? [])].filter(
      (v) => !(options.unblock ?? []).includes(v),
    ),
  );
  if (blocked.includes(version)) throw new Error(`${version} is blocked; unblock it or pick another target`);

  let minimum = options.clearMin ? undefined : options.min ?? previous?.min_supported_version;
  if (minimum !== undefined && !isVersion(minimum)) throw new Error(`not a version: ${minimum}`);
  if (minimum !== undefined && compareVersions(version, minimum) < 0) {
    throw new Error(`target ${version} is below the minimum ${minimum}`);
  }

  const percent = options.percent ?? (action === "prompt" ? 10 : 100);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error("--percent must be 0 to 100");

  const previousConfig = previous?.config ?? {};
  const config = {
    cloud_stt_enabled: options.cloudStt ?? previousConfig.cloud_stt_enabled ?? true,
    banner: options.clearBanner ? null : options.banner ?? previousConfig.banner ?? null,
  };

  const policy = {
    seq,
    issued,
    expires,
    channel,
    target: { version, signatures },
    action,
    blocked_versions: blocked,
    rollout: { percent, force_bypasses: options.forceBypasses ?? true },
    config,
  };
  if (minimum !== undefined) policy.min_supported_version = minimum;
  if (options.message) policy.message = options.message;
  return policy;
}

export function parseArgs(argv) {
  const options = {};
  const list = (value) => value.split(",").map((v) => v.trim()).filter(Boolean);
  const flags = {
    "--action": (v) => (options.action = v),
    "--version": (v) => (options.version = v),
    "--percent": (v) => (options.percent = Number(v)),
    "--min": (v) => (options.min = v),
    "--block": (v) => (options.block = list(v)),
    "--unblock": (v) => (options.unblock = list(v)),
    "--message": (v) => (options.message = v),
    "--banner": (v) => (options.banner = v),
    "--cloud-stt": (v) => {
      if (v !== "on" && v !== "off") throw new Error("--cloud-stt must be on or off");
      options.cloudStt = v === "on";
    },
    "--days": (v) => (options.days = Number(v)),
    "--channel": (v) => (options.channel = v),
  };
  const switches = {
    "--refresh": () => (options.refresh = true),
    "--show": () => (options.show = true),
    "--dry-run": () => (options.dryRun = true),
    "--clear-min": () => (options.clearMin = true),
    "--clear-banner": () => (options.clearBanner = true),
    "--staged-force": () => (options.forceBypasses = false),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (switches[arg]) switches[arg]();
    else if (flags[arg]) {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      flags[arg](argv[(i += 1)]);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}
