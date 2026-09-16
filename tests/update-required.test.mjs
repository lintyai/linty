import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_STT_PAUSED, cloudTranscriptionPaused, isDictationBusy, isRequiredUpdate, requiredUpdateExplanation, requiredUpdateTitle, waitUntilIdle } from '../src/lib/update-policy.util.ts';

const decision = (over = {}) => ({ update: 'required', reason: 'rollback', targetVersion: '0.0.40', message: null, cloudSttEnabled: true, banner: null, policySeq: 1, ...over });

function fakeWorld() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  const listeners = new Set();
  const state = { isRecording: false, status: 'idle' };
  return {
    state,
    timers: {
      set: (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
      clear: (id) => timers.delete(id),
    },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    change(patch) { Object.assign(state, patch); for (const l of [...listeners]) l(); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
    },
    listenerCount: () => listeners.size,
  };
}

const settled = async (promise) => {
  let done = false;
  promise.then(() => { done = true; });
  await new Promise((r) => setImmediate(r));
  return done;
};

test('install waits for thirty quiet seconds and restarts the wait when dictation begins', async () => {
  const w = fakeWorld();
  const quiet = waitUntilIdle(() => isDictationBusy(w.state), w.subscribe, 30_000, w.timers);
  w.advance(20_000);
  w.change({ isRecording: true, status: 'recording' });
  w.advance(60_000);
  assert.equal(await settled(quiet), false, 'never installs while recording');
  w.change({ isRecording: false, status: 'transcribing' });
  w.change({ status: 'pasting' });
  w.advance(60_000);
  assert.equal(await settled(quiet), false, 'never installs while the text is being produced');
  w.change({ status: 'done' });
  w.advance(29_000);
  assert.equal(await settled(quiet), false);
  w.advance(1_000);
  assert.equal(await settled(quiet), true);
  assert.equal(w.listenerCount(), 0, 'unsubscribes when finished');
});

test('the default timers resolve (the browser-only invocation error is covered by yarn test:ui)', async () => {
  const quiet = waitUntilIdle(() => false, () => () => {}, 1);
  await quiet;
});

test('unrelated store changes do not postpone the install', async () => {
  const w = fakeWorld();
  const quiet = waitUntilIdle(() => isDictationBusy(w.state), w.subscribe, 30_000, w.timers);
  for (let i = 0; i < 29; i += 1) { w.advance(1_000); w.change({ status: 'idle' }); }
  w.advance(1_000);
  assert.equal(await settled(quiet), true);
});

test('only the update the policy names is treated as required', () => {
  assert.equal(isRequiredUpdate(decision(), '0.0.40'), true);
  assert.equal(isRequiredUpdate(decision(), '0.0.41'), false);
  assert.equal(isRequiredUpdate(decision({ update: 'prompt' }), '0.0.40'), false);
  assert.equal(isRequiredUpdate(null, '0.0.40'), false);
});

test('busy means recording or producing text', () => {
  for (const status of ['recording', 'transcribing', 'correcting', 'pasting']) assert.equal(isDictationBusy({ isRecording: false, status }), true, status);
  for (const status of ['idle', 'done', 'error']) assert.equal(isDictationBusy({ isRecording: false, status }), false, status);
  assert.equal(isDictationBusy({ isRecording: true, status: 'idle' }), true);
});

test('cloud transcription pauses only on an explicit policy switch', () => {
  assert.equal(cloudTranscriptionPaused(decision({ cloudSttEnabled: false })), true);
  assert.equal(cloudTranscriptionPaused(decision()), false);
  assert.equal(cloudTranscriptionPaused(null), false);
  assert.match(CLOUD_STT_PAUSED, /Switch to on-device/);
});

test('the blocking screen explains itself for every reason', () => {
  assert.equal(requiredUpdateTitle('rollback'), 'Linty needs to switch versions');
  assert.equal(requiredUpdateTitle('blockedVersion'), 'Linty needs to switch versions');
  assert.equal(requiredUpdateTitle('force'), 'Linty needs to update');
  const texts = ['blockedVersion', 'rollback', 'belowMinimum', 'force'].map(requiredUpdateExplanation);
  assert.equal(new Set(texts).size, 4);
  assert.equal(requiredUpdateExplanation(null), requiredUpdateExplanation('force'), 'no reason reads as a required update');
  assert.ok(texts.every((t) => t.endsWith('.')));
});
