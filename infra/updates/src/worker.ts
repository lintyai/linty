/**
 * Linty update host, served at updates.linty.ai.
 *
 * GET /v1/policy/<channel>/<platform>/<version>
 *   The signed policy envelope for the channel, exactly as
 *   scripts/policy/publish.mjs uploaded it. 204 when none is published.
 *
 * GET /v1/manifest/<channel>/<platform>/<version>
 *   The updater manifest (latest.json) of the policy's target release, read
 *   from GitHub Releases. 204 when the caller already runs the target. 404
 *   when no policy is published, so the updater falls through to its GitHub
 *   endpoint; a 204 would stop it there.
 *
 * The worker does not verify the policy. The app does, and it also pins the
 * tarball signature, so a tampered store or manifest cannot install anything.
 * The worker only reads `target.version` to choose a manifest.
 *
 * Privacy: each request writes one Analytics Engine data point holding the
 * route, channel, platform and version. No IP address, user agent or
 * identifier is stored, and Workers Logs are off in wrangler.toml.
 */

export interface KvReader {
  get(key: string): Promise<string | null>;
}

export interface DataPointWriter {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

export interface Env {
  POLICY: KvReader;
  UPDATE_CHECKS?: DataPointWriter;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const RELEASE_DOWNLOADS = "https://github.com/lintyai/linty/releases/download";
const CHANNEL = /^[a-z][a-z0-9-]{0,31}$/;
const PLATFORM = /^[a-z0-9]+-[a-z0-9_]+$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ROUTE = /^\/v1\/(policy|manifest)\/([^/]+)\/([^/]+)\/([^/]+)$/;
/** GitHub release assets never change once published. */
const MANIFEST_CACHE_SECONDS = 300;

export function policyKey(channel: string): string {
  return `policy:${channel}`;
}

/** `target.version` of a stored envelope, or null if it cannot be read. */
export function targetVersion(envelope: string): string | null {
  try {
    const { payload } = JSON.parse(envelope) as { payload?: unknown };
    if (typeof payload !== "string") return null;
    const version = (JSON.parse(payload) as { target?: { version?: unknown } }).target?.version;
    return typeof version === "string" && VERSION.test(version) ? version : null;
  } catch {
    return null;
  }
}

function respond(status: number, body: string | null, head: boolean, contentType?: string): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (body !== null) headers.set("Content-Type", contentType ?? "text/plain; charset=utf-8");
  if (status === 405) headers.set("Allow", "GET, HEAD");
  return new Response(head || status === 204 ? null : body, { status, headers });
}

export async function handleRequest(request: Request, env: Env, fetcher: Fetcher = fetch): Promise<Response> {
  const head = request.method === "HEAD";
  if (request.method !== "GET" && !head) return respond(405, "Method not allowed", head);

  const match = ROUTE.exec(new URL(request.url).pathname);
  if (!match) return respond(404, "Not found", head);
  const [, route, channel, platform, version] = match;
  if (!CHANNEL.test(channel) || !PLATFORM.test(platform) || !VERSION.test(version)) {
    return respond(400, "Bad request", head);
  }

  env.UPDATE_CHECKS?.writeDataPoint({ indexes: [channel], blobs: [route, channel, platform, version] });

  const envelope = await env.POLICY.get(policyKey(channel));
  if (route === "policy") {
    return envelope === null ? respond(204, null, head) : respond(200, envelope, head, "application/json");
  }

  if (envelope === null) return respond(404, "No policy for this channel", head);
  const target = targetVersion(envelope);
  if (target === null) return respond(502, "Stored policy is unreadable", head);
  if (target === version) return respond(204, null, head);

  const upstream = await fetcher(`${RELEASE_DOWNLOADS}/v${target}/latest.json`, {
    // Cloudflare-specific: cache the release asset at the edge.
    cf: { cacheTtl: MANIFEST_CACHE_SECONDS, cacheEverything: true },
  } as RequestInit);
  if (!upstream.ok) return respond(502, `Manifest for ${target} is unavailable`, head);
  const manifest = await upstream.text();
  let manifestVersion: unknown;
  try {
    manifestVersion = (JSON.parse(manifest) as { version?: unknown }).version;
  } catch {
    manifestVersion = undefined;
  }
  if (typeof manifestVersion !== "string" || manifestVersion.replace(/^v/, "") !== target) {
    return respond(502, `Manifest for ${target} names another version`, head);
  }
  return respond(200, manifest, head, "application/json");
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
