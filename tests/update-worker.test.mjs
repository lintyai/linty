import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, policyKey, targetVersion } from '../infra/updates/src/worker.ts';

const envelope = (version) => JSON.stringify({ payload: JSON.stringify({ seq: 1, target: { version } }), signature: 'sig' });
const manifest = (version) => JSON.stringify({ version: `v${version}`, platforms: { 'darwin-aarch64': { signature: 's', url: 'u' } } });

function setup({ stored = envelope('0.0.40'), upstream = () => new Response(manifest('0.0.40')) } = {}) {
  const points = [];
  const fetched = [];
  const env = {
    POLICY: { get: async (key) => (key === policyKey('stable') ? stored : null) },
    UPDATE_CHECKS: { writeDataPoint: (point) => points.push(point) },
  };
  const fetcher = async (url, init) => { fetched.push({ url, init }); return upstream(url); };
  const call = (path, method = 'GET') => handleRequest(new Request(`https://updates.linty.ai${path}`, { method }), env, fetcher);
  return { call, points, fetched };
}

test('policy route serves the stored envelope unchanged and never lets it be cached', async () => {
  const { call } = setup();
  const res = await call('/v1/policy/stable/darwin-aarch64/0.0.39');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), envelope('0.0.40'));
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal((await setup({ stored: null }).call('/v1/policy/stable/darwin-aarch64/0.0.39')).status, 204);
});

test('manifest route serves the target release so the app can compare it', async () => {
  const { call, fetched } = setup();
  const res = await call('/v1/manifest/stable/darwin-aarch64/0.0.41');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), manifest('0.0.40'));
  assert.equal(fetched[0].url, 'https://github.com/lintyai/linty/releases/download/v0.0.40/latest.json');
  assert.equal(fetched[0].init.cf.cacheTtl, 300);
});

test('manifest route answers 204 on the target and 404 without a policy so the updater falls back', async () => {
  assert.equal((await setup().call('/v1/manifest/stable/darwin-aarch64/0.0.40')).status, 204);
  const { call, fetched } = setup({ stored: null });
  assert.equal((await call('/v1/manifest/stable/darwin-aarch64/0.0.39')).status, 404);
  assert.equal(fetched.length, 0);
});

test('manifest problems are server errors, which the updater also falls back from', async () => {
  const missing = setup({ upstream: () => new Response('nope', { status: 404 }) });
  assert.equal((await missing.call('/v1/manifest/stable/darwin-aarch64/0.0.39')).status, 502);
  const mismatched = setup({ upstream: () => new Response(manifest('0.0.41')) });
  assert.equal((await mismatched.call('/v1/manifest/stable/darwin-aarch64/0.0.39')).status, 502);
  const garbage = setup({ upstream: () => new Response('<html>') });
  assert.equal((await garbage.call('/v1/manifest/stable/darwin-aarch64/0.0.39')).status, 502);
  const unreadable = setup({ stored: '{"payload":"not json"}' });
  assert.equal((await unreadable.call('/v1/manifest/stable/darwin-aarch64/0.0.39')).status, 502);
});

test('requests are validated before anything is read or counted', async () => {
  const { call, points } = setup();
  assert.equal((await call('/v1/policy/stable/darwin-aarch64/latest')).status, 400);
  assert.equal((await call('/v1/policy/Stable/darwin-aarch64/0.0.39')).status, 400);
  assert.equal((await call('/v1/policy/stable/../0.0.39')).status, 404);
  assert.equal((await call('/v1/other/stable/darwin-aarch64/0.0.39')).status, 404);
  const post = await call('/v1/policy/stable/darwin-aarch64/0.0.39', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal(points.length, 0);
});

test('each check records only route, channel, platform and version', async () => {
  const { call, points } = setup();
  await call('/v1/policy/stable/darwin-aarch64/0.0.39');
  await call('/v1/manifest/stable/darwin-aarch64/0.0.39');
  assert.deepEqual(points, [
    { indexes: ['stable'], blobs: ['policy', 'stable', 'darwin-aarch64', '0.0.39'] },
    { indexes: ['stable'], blobs: ['manifest', 'stable', 'darwin-aarch64', '0.0.39'] },
  ]);
});

test('HEAD requests get headers only', async () => {
  const res = await setup().call('/v1/policy/stable/darwin-aarch64/0.0.39', 'HEAD');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
});

test('targetVersion reads only a well-formed target', () => {
  assert.equal(targetVersion(envelope('0.0.40')), '0.0.40');
  assert.equal(targetVersion(envelope('latest')), null);
  assert.equal(targetVersion('{}'), null);
  assert.equal(targetVersion('nope'), null);
});
