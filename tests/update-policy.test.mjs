import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIONS, buildPolicy, compareVersions, envelopePolicy, parseArgs, policyPublicKey, releaseSignatures, verifyTauriSignature } from '../scripts/policy/policy-lib.mjs';

const keys = readFileSync(new URL('../src-tauri/src/keys.rs', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('../src-tauri/tests/fixtures/policy_signed_with_release_key.json', import.meta.url), 'utf8'));
const NOW = 1_758_110_400; // 2025-09-17T12:00:00Z
const manifest = (version, signature = `sig-${version}`) => ({ version: `v${version}`, platforms: { 'darwin-aarch64': { signature, url: 'u' } } });

test('signatures made by tauri signer with the policy key verify, and nothing else does', () => {
  const key = policyPublicKey(keys);
  const payload = Buffer.from(fixture.payload);
  assert.equal(verifyTauriSignature(payload, fixture.signature, key), true);
  assert.equal(verifyTauriSignature(Buffer.from(fixture.payload.replace('pause', 'force')), fixture.signature, key), false);
  const root = /pub const ROOT_PUBLIC_KEY: &str = "([^"]+)"/.exec(keys)[1];
  assert.equal(verifyTauriSignature(payload, fixture.signature, root), false);
  assert.equal(verifyTauriSignature(payload, 'garbage', key), false);
  assert.equal(verifyTauriSignature(payload, fixture.signature, 'garbage'), false);
});

test('a first staged rollout defaults to ten percent and pins the release signature', () => {
  const policy = buildPolicy({ options: { action: 'prompt', version: '0.0.39' }, previous: null, manifest: manifest('0.0.39'), nowSeconds: NOW });
  assert.equal(policy.seq, NOW);
  assert.equal(policy.issued, '2025-09-17T12:00:00Z');
  assert.equal(policy.expires, '2025-10-01T12:00:00Z');
  assert.deepEqual(policy.target, { version: '0.0.39', signatures: { 'darwin-aarch64': 'sig-0.0.39' } });
  assert.deepEqual(policy.rollout, { percent: 10, force_bypasses: true });
  assert.deepEqual(policy.blocked_versions, []);
  assert.deepEqual(policy.config, { cloud_stt_enabled: true, banner: null });
  assert.equal('min_supported_version' in policy, false);
});

test('blocks, minimum and remote config carry over; the message does not', () => {
  const previous = buildPolicy({
    options: { action: 'rollback', version: '0.0.38', block: ['0.0.39'], min: '0.0.30', cloudStt: false, banner: 'Degraded', message: 'Rolling back' },
    previous: null, manifest: manifest('0.0.38'), nowSeconds: NOW,
  });
  assert.equal(previous.rollout.percent, 100);
  const next = buildPolicy({ options: { action: 'prompt', version: '0.0.40' }, previous, manifest: manifest('0.0.40'), nowSeconds: NOW + 60 });
  assert.deepEqual(next.blocked_versions, ['0.0.39']);
  assert.equal(next.min_supported_version, '0.0.30');
  assert.deepEqual(next.config, { cloud_stt_enabled: false, banner: 'Degraded' });
  assert.equal('message' in next, false);

  const changed = buildPolicy({ options: { action: 'prompt', version: '0.0.40', unblock: ['0.0.39'], clearMin: true, cloudStt: true, clearBanner: true }, previous, manifest: manifest('0.0.40'), nowSeconds: NOW + 60 });
  assert.deepEqual(changed.blocked_versions, []);
  assert.equal('min_supported_version' in changed, false);
  assert.deepEqual(changed.config, { cloud_stt_enabled: true, banner: null });
});

test('sequence numbers keep rising even if the clock goes back', () => {
  const previous = { ...buildPolicy({ options: { action: 'pause', version: '0.0.38' }, previous: null, manifest: manifest('0.0.38'), nowSeconds: NOW }), seq: NOW + 500 };
  assert.equal(buildPolicy({ options: { action: 'pause' }, previous, manifest: manifest('0.0.38'), nowSeconds: NOW }).seq, NOW + 501);
});

test('refresh re-signs the published policy with a new sequence and expiry only', () => {
  const previous = buildPolicy({ options: { action: 'force', version: '0.0.38', message: 'Critical fix' }, previous: null, manifest: manifest('0.0.38'), nowSeconds: NOW });
  const refreshed = buildPolicy({ options: { refresh: true, days: 7 }, previous, manifest: null, nowSeconds: NOW + 3600 });
  assert.deepEqual({ ...refreshed, seq: 0, issued: '', expires: '' }, { ...previous, seq: 0, issued: '', expires: '' });
  assert.equal(refreshed.seq, NOW + 3600);
  assert.equal(refreshed.expires, '2025-09-24T13:00:00Z');
  assert.throws(() => buildPolicy({ options: { refresh: true }, previous: null, manifest: null, nowSeconds: NOW }), /needs a published policy/);
});

test('policies the app would reject are refused before signing', () => {
  const build = (options, previous = null, m = manifest(options.version ?? '0.0.39')) => () => buildPolicy({ options, previous, manifest: m, nowSeconds: NOW });
  assert.throws(build({ action: 'canary', version: '0.0.39' }), /--action/);
  assert.throws(build({ action: 'prompt' }, null, null), /--version/);
  assert.throws(build({ action: 'prompt', version: '0.0.39', block: ['0.0.39'] }), /is blocked/);
  assert.throws(build({ action: 'prompt', version: '0.0.39', min: '0.0.40' }), /below the minimum/);
  assert.throws(build({ action: 'prompt', version: '0.0.39', percent: 101 }), /--percent/);
  assert.throws(build({ action: 'prompt', version: '0.0.39', days: 365 }), /--days/);
  assert.throws(build({ action: 'prompt', version: '0.0.39' }, null, manifest('0.0.40')), /names v0.0.40/);
  assert.throws(build({ action: 'prompt', version: '0.0.39' }, null, { version: 'v0.0.39', platforms: {} }), /no signatures/);
  assert.throws(build({ action: 'prompt', version: '0.0.39', channel: 'beta' }, { channel: 'stable' }), /is for stable/);
});

test('helpers', () => {
  assert.deepEqual(ACTIONS, ['prompt', 'force', 'rollback', 'pause']);
  assert.equal(compareVersions('0.0.10', '0.0.9'), 1);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0+build', '1.0.0'), 0);
  assert.deepEqual(releaseSignatures(manifest('0.0.39', ' s \n')), { 'darwin-aarch64': 's' });
  assert.equal(envelopePolicy(null), null);
  assert.equal(envelopePolicy(JSON.stringify(fixture)).channel, 'signing-fixture');
  assert.deepEqual(parseArgs(['--action', 'prompt', '--block', '0.0.1, 0.0.2', '--cloud-stt', 'off', '--staged-force', '--dry-run']),
    { action: 'prompt', block: ['0.0.1', '0.0.2'], cloudStt: false, forceBypasses: false, dryRun: true });
  assert.throws(() => parseArgs(['--percent']), /needs a value/);
  assert.throws(() => parseArgs(['--cloud-stt', 'maybe']), /on or off/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});
