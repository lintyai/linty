#!/usr/bin/env node
// Sign and publish Linty's update policy. See docs/runbooks/update-policy.md.
//
//   node scripts/policy/publish.mjs --show
//   node scripts/policy/publish.mjs --action prompt --version 0.0.39 --percent 10
//   node scripts/policy/publish.mjs --action rollback --version 0.0.38 --block 0.0.39 --message "..."
//   node scripts/policy/publish.mjs --refresh
//
// Needs LINTY_POLICY_KEY_PATH and LINTY_POLICY_KEY_PASSWORD, and a Wrangler
// login for the Cloudflare account that serves updates.linty.ai.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowListedEnv,
  buildPolicy,
  envelopePolicy,
  parseArgs,
  policyPublicKey,
  verifyTauriSignature,
} from "./policy-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = process.env.LINTY_UPDATE_HOST ?? "https://updates.linty.ai";
const RELEASES = "https://github.com/lintyai/linty/releases/download";
const WRANGLER = "wrangler@4.132.0";
// Requests from this tool show up in the counts as version 0.0.0.
const PROBE = "darwin-aarch64/0.0.0";
const KV_PROPAGATION_MS = 90_000;
const BASE_ENV = ["PATH", "HOME", "TMPDIR", "USER", "LANG", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy"];

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow", headers: { "Cache-Control": "no-cache" } });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response.text();
}

function wrangler(args, cwd) {
  // Only what Wrangler needs: its login lives under HOME, or it reads
  // CLOUDFLARE_* tokens. No usage telemetry.
  const env = allowListedEnv(process.env, {
    names: BASE_ENV,
    prefixes: ["CLOUDFLARE_", "WRANGLER_"],
    extra: { WRANGLER_SEND_METRICS: "false" },
  });
  const result = spawnSync("npx", ["--yes", WRANGLER, ...args], { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed`);
}

function sign(payloadPath) {
  const keyPath = process.env.LINTY_POLICY_KEY_PATH;
  const password = process.env.LINTY_POLICY_KEY_PASSWORD;
  if (!keyPath || password === undefined) {
    throw new Error("set LINTY_POLICY_KEY_PATH and LINTY_POLICY_KEY_PASSWORD");
  }
  // Only the policy key's password; the updater's own key, if exported, and
  // every other secret stay out of the signer's environment.
  const env = allowListedEnv(process.env, {
    names: BASE_ENV,
    extra: { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password, CI: "true" },
  });
  const result = spawnSync(
    join(ROOT, "node_modules/.bin/tauri"),
    ["signer", "sign", "-f", keyPath, payloadPath],
    { env, encoding: "utf8" },
  );
  if (result.status !== 0) {
    const reason = (result.stderr || "").trim().split("\n").pop();
    throw new Error(`tauri signer failed: ${reason}`);
  }
  return readFileSync(`${payloadPath}.sig`, "utf8").trim();
}

async function waitForLive(channel, seq) {
  const deadline = Date.now() + KV_PROPAGATION_MS;
  while (Date.now() < deadline) {
    const live = envelopePolicy(await fetchText(`${HOST}/v1/policy/${channel}/${PROBE}`));
    if (live?.seq === seq) return true;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const channel = options.channel ?? "stable";
  const previous = envelopePolicy(await fetchText(`${HOST}/v1/policy/${channel}/${PROBE}`));

  if (options.show) {
    console.log(previous ? JSON.stringify(previous, null, 2) : `No policy is published for ${channel}.`);
    return;
  }

  const version = options.refresh ? null : options.version ?? previous?.target?.version;
  const manifest = version
    ? JSON.parse(await fetchText(`${RELEASES}/v${version}/latest.json`))
    : null;
  const policy = buildPolicy({
    options,
    previous,
    manifest,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  const payload = JSON.stringify(policy);
  console.log(JSON.stringify(policy, null, 2));

  const publicKey = policyPublicKey(readFileSync(join(ROOT, "src-tauri/src/keys.rs"), "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "linty-policy-"));
  try {
    const payloadPath = join(dir, "policy.json");
    writeFileSync(payloadPath, payload);
    const signature = sign(payloadPath);
    if (!verifyTauriSignature(Buffer.from(payload), signature, publicKey)) {
      throw new Error("the signature does not verify with POLICY_PUBLIC_KEY in keys.rs; is this the policy key?");
    }
    if (options.dryRun) {
      console.log("Signed and verified. Dry run: nothing uploaded.");
      return;
    }

    const envelopePath = join(dir, "envelope.json");
    writeFileSync(envelopePath, JSON.stringify({ payload, signature }));
    wrangler(
      ["kv", "key", "put", `policy:${channel}`, "--binding", "POLICY", "--path", envelopePath, "--remote"],
      join(ROOT, "infra/updates"),
    );
    console.log(
      (await waitForLive(channel, policy.seq))
        ? `Published seq ${policy.seq}; it expires ${policy.expires}.`
        : `Uploaded seq ${policy.seq}, but ${HOST} did not serve it within ${KV_PROPAGATION_MS / 1000} s. Check again with --show.`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`publish: ${error.message}`);
  process.exit(1);
});
