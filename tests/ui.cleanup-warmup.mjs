import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { fixture } from './ui.fixture.mjs';

const port = process.env.UI_PORT ?? '1459';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
const errors = [];

function setupWarmup({ enabled = false, installed = true, mode = 'local' } = {}) {
  const qa = window.__QA__;
  qa.stores[1].reformatEnabled = enabled;
  qa.stores[1].sttMode = mode;
  if (mode === 'cloud') qa.secureGroqKey = 'synthetic-test-key';
  qa.warmups = [];
  qa.preparations = [];
  qa.capsule = [];
  qa.discardedAudio = [];
  qa.transcript = 'A prepared dictation.';
  qa.stopResult = { sample_count: 16000, duration_secs: 1 };
  let warm = false;
  let pending;
  const original = window.__TAURI_INTERNALS__.invoke;
  if (installed) void original('download_s1_model');
  qa.calls.length = 0;
  const prepare = () => {
    if (warm) return Promise.resolve();
    if (pending) return pending;
    pending = new Promise((resolve, reject) => qa.warmups.push({
      resolve: () => { warm = true; resolve(); }, reject,
    })).finally(() => { pending = null; });
    return pending;
  };
  qa.cooldown = () => { warm = false; qa.emit('model-idle-unloaded'); };
  window.__TAURI_INTERNALS__.invoke = (command, args) => {
    if (command === 'emit_capsule_state') qa.capsule.push(args);
    if (command === 'history_discard_pending_audio') qa.discardedAudio.push(args.generation);
    if (command === 'prepare_s1_model') { qa.calls.push(command); return prepare(); }
    if (command === 'prepare_dictation') {
      qa.calls.push(command); qa.preparations.push(args);
      return installed ? prepare() : Promise.resolve();
    }
    if (command === 'stop_recording') {
      qa.calls.push(command);
      return Promise.resolve(qa.stopResult);
    }
    if (command === 'transcribe_buffer') {
      qa.calls.push(command);
      return Promise.resolve({ text: qa.transcript, vocabularyApplied: [] });
    }
    if (command === 'reformat_transcript' && qa.cleanupResult) {
      qa.calls.push(command);
      return Promise.resolve(qa.cleanupResult);
    }
    return original(command, args);
  };
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview did not start')), 15000);
    server.stdout.on('data', chunk => { if (String(chunk).includes(port)) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
  });
  browser = await chromium.launch({ headless: true });
  const open = async (options = {}) => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ content: `(${fixture.toString()})({empty:true});(${setupWarmup.toString()})(${JSON.stringify(options)});` });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByRole('heading', { name: 'Your dictation', exact: true }).waitFor();
    await page.evaluate(async () => {
      document.hasFocus = () => false;
      window.__QA__.appStore = (await import('/src/store/app.store.ts')).useAppStore;
      window.__QA__.isRecoveringDictation = (await import('/src/services/dictation-recovery.service.ts')).isRecoveringDictation;
      window.__QA__.readiness = (await import('/src/services/dictation-preparation.service.ts')).dictationPreparation;
    });
    return page;
  };
  const chooseMode = async (page, label) => {
    await page.getByRole('combobox', { name: 'Text cleanup', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  };
  const enabled = page => page.evaluate(async () => (await import('/src/store/app.store.ts')).useAppStore.getState().reformatEnabled);
  // Poll a synchronous predicate: a Promise is truthy even when it resolves false.
  const waitStatus = (page, status) => page.waitForFunction(status => window.__QA__.appStore.getState().status === status, status);
  const press = page => page.evaluate(() => window.__QA__.emit('fnkey-pressed'));
  const release = page => page.evaluate(() => window.__QA__.emit('fnkey-released'));
  const micCalls = page => page.evaluate(() => window.__QA__.calls.filter(c => c === 'start_recording').length);

  // Startup and recording share warm-up, but the microphone opens immediately.
  let page = await open();
  await page.waitForFunction(() => window.__QA__.warmups.length === 1 && window.__QA__.preparations.length === 1);
  await page.getByRole('button', { name: 'On-device: Preparing. Configure speech engine' }).waitFor();
  assert.equal(await enabled(page), false);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('download_s1_model')), false);
  await press(page);
  await waitStatus(page, 'recording');
  assert.equal(await micCalls(page), 1);
  assert.equal(await page.evaluate(() => window.__QA__.preparations.length), 1, 'Startup and dictation share preparation');
  await page.waitForFunction(() => window.__QA__.appStore.getState().recordingDuration > 0);
  await release(page);
  await waitStatus(page, 'preparing');
  assert.equal(await page.evaluate(() => window.__QA__.appStore.getState().isRecording), false, 'Release closes the microphone while warm-up continues');
  assert.equal(await page.evaluate(() => window.__QA__.capsule.at(-1).state), 'preparing');
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('transcribe_buffer')), false, 'Audio waits for preparation');
  await page.evaluate(() => window.__QA__.warmups[0].resolve());
  await waitStatus(page, 'done');
  assert.equal(await micCalls(page), 1, 'Preparation completion never reopens the microphone');
  assert.equal(await page.evaluate(() => window.__QA__.calls.filter(c => c === 'paste_text').length), 1);

  // Both the first and second actual dictations use the already warm instance.
  for (let i = 0; i < 2; i++) {
    await press(page); await waitStatus(page, 'recording');
    await release(page); await waitStatus(page, 'done');
  }
  assert.equal(await page.evaluate(() => window.__QA__.warmups.length), 1);
  assert.equal(await page.evaluate(() => window.__QA__.calls.filter(c => c === 'paste_text').length), 3);

  // After idle, capture overlaps loading. A failed post-stop wait is retryable.
  await page.evaluate(() => window.__QA__.cooldown());
  await press(page); await waitStatus(page, 'recording');
  await page.waitForFunction(() => window.__QA__.warmups.length === 2);
  assert.equal(await micCalls(page), 4);
  await release(page); await waitStatus(page, 'preparing');
  await page.evaluate(() => window.__QA__.warmups[1].reject(new Error('Synthetic preparation failure')));
  await waitStatus(page, 'error');
  await page.waitForFunction(() => !window.__QA__.isRecoveringDictation());
  await release(page);
  await press(page); await waitStatus(page, 'recording');
  await page.waitForFunction(() => window.__QA__.warmups.length === 3);
  await page.evaluate(() => window.__QA__.warmups[2].resolve());
  await page.waitForFunction(() => window.__QA__.readiness.getSnapshot() === 'ready');
  assert.equal(await page.evaluate(() => window.__QA__.appStore.getState().status), 'recording', 'Background completion keeps listening');
  await release(page); await waitStatus(page, 'done');

  // Enabling cleanup still waits for preparation and preserves mode on failure.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.evaluate(() => window.__QA__.cooldown());
  await chooseMode(page, 'Clean up on this Mac');
  await page.getByRole('status').filter({ hasText: 'Preparing on-device cleanup' }).waitFor();
  assert.equal(await enabled(page), false);
  assert.equal(await page.getByRole('combobox', { name: 'Text cleanup' }).isDisabled(), true);
  await page.waitForFunction(() => window.__QA__.warmups.length === 4);
  await page.evaluate(() => window.__QA__.warmups[3].reject(new Error('Synthetic warm-up failure')));
  await page.getByRole('alert').filter({ hasText: 'Synthetic warm-up failure' }).waitFor();
  assert.equal(await enabled(page), false);
  await page.getByRole('button', { name: 'Use on-device cleanup', exact: true }).click();
  await page.waitForFunction(() => window.__QA__.warmups.length === 5);
  await page.evaluate(() => window.__QA__.warmups[4].resolve());
  await page.waitForFunction(() => window.__QA__.stores[1].reformatEnabled === true);
  assert.equal(await enabled(page), true);
  await chooseMode(page, 'Keep as spoken');
  await page.waitForFunction(() => window.__QA__.stores[1].reformatEnabled === false);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('unload_s1_model')), false, 'Installed S1 remains warm when disabled');
  await page.close();

  // Enabled installations also prepare proactively, without a real correction.
  page = await open({ enabled: true });
  await page.waitForFunction(() => window.__QA__.warmups.length === 1);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('reformat_transcript')), false);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('download_s1_model')), false);
  await page.evaluate(() => window.__QA__.warmups[0].resolve());
  await page.getByRole('button', { name: 'On-device: Ready. Configure speech engine' }).waitFor();

  // A native-validated empty cleanup is a successful no-op. Never paste an
  // empty clipboard over a selection or save a blank entry/recording.
  await page.evaluate(() => {
    const qa = window.__QA__;
    qa.transcript = 'um uh um';
    qa.stopResult.recording_generation = 1;
    qa.cleanupResult = { text: '', metrics: {
      schemaVersion: 1, status: 'applied', reason: 'filler_only', changed: true,
      options: { styling: 'semi-formal', structure: 'lists', context: 'general' },
      requestedLanguage: 'en', inputWords: 3, outputWords: 0, inputCharacters: 8, outputCharacters: 0,
    } };
  });
  await press(page); await waitStatus(page, 'recording');
  await release(page); await waitStatus(page, 'idle');
  await page.waitForFunction(() => window.__QA__.discardedAudio.includes(1));
  assert.equal(await page.evaluate(() => window.__QA__.calls.filter(c => c === 'reformat_transcript').length), 1);
  for (const command of ['snapshot_clipboard', 'write_transient_text', 'paste_text', 'history_save']) {
    assert.equal(await page.evaluate(command => window.__QA__.calls.includes(command), command), false, `${command} must not run for filler-only cleanup`);
  }
  assert.equal(await page.evaluate(() => window.__QA__.appStore.getState().toasts.length), 0, 'Intentional empty cleanup is not an error');
  assert.equal(await page.evaluate(() => window.__QA__.appStore.getState().isRecording), false);
  assert.equal(await page.evaluate(() => window.__QA__.capsule.at(-1).state), 'idle');
  await page.waitForFunction(() => window.__QA__.calls.includes('hide_capsule'));

  // The next meaningful short dictation still pastes and saves exactly once.
  await page.evaluate(() => {
    const qa = window.__QA__;
    qa.transcript = 'no';
    qa.cleanupResult = { text: 'No.', metrics: { ...qa.cleanupResult.metrics,
      status: 'applied', reason: null, inputWords: 1, outputWords: 1, inputCharacters: 2, outputCharacters: 3,
    } };
  });
  await press(page); await waitStatus(page, 'recording');
  await release(page); await waitStatus(page, 'done');
  assert.equal(await page.evaluate(() => window.__QA__.calls.filter(c => c === 'paste_text').length), 1);
  assert.equal(await page.evaluate(() => window.__QA__.stores[2].transcripts.length), 1);
  assert.equal(await page.evaluate(() => window.__QA__.stores[2].transcripts[0].finalText), 'No.');

  // Rejected empty results still use the complete original and surface fallback.
  await page.evaluate(() => {
    const qa = window.__QA__;
    qa.transcript = "um don't send the report";
    qa.cleanupResult = { text: qa.transcript, metrics: { ...qa.cleanupResult.metrics,
      status: 'fallback', reason: 'empty_output', changed: false,
    } };
  });
  await press(page); await waitStatus(page, 'recording');
  await release(page); await waitStatus(page, 'done');
  assert.equal(await page.evaluate(() => window.__QA__.calls.filter(c => c === 'paste_text').length), 2);
  assert.equal(await page.evaluate(() => window.__QA__.stores[2].transcripts[0].finalText), "um don't send the report");
  assert.equal(await page.evaluate(() => window.__QA__.appStore.getState().toasts.some(t => t.message.includes('original text was kept'))), true);
  await page.close();

  // Absent optional cleanup stays absent. Speech readiness still works.
  page = await open({ installed: false });
  await page.getByRole('button', { name: 'On-device: Ready. Configure speech engine' }).waitFor();
  assert.equal(await page.evaluate(() => window.__QA__.warmups.length), 0);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('download_s1_model')), false);
  await press(page); await waitStatus(page, 'recording');
  await release(page); await waitStatus(page, 'done');
  await page.close();

  // Cloud dictation prepares installed local cleanup without local speech or
  // sending a synthetic cloud transcription/correction request.
  page = await open({ mode: 'cloud' });
  await page.waitForFunction(() => window.__QA__.preparations.length === 1);
  assert.equal(await page.evaluate(() => window.__QA__.preparations[0].local), false);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('load_local_model')), false);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('transcribe_buffer_cloud')), false);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('reformat_transcript')), false);
  await page.evaluate(() => window.__QA__.warmups[0].resolve());
  await page.getByRole('button', { name: 'Cloud: Ready. Configure speech engine' }).waitFor();
  await page.close();

  // A model switch finishing during preparation cannot leave transcription using
  // the old prepared selection.
  page = await open();
  await page.waitForFunction(() => window.__QA__.preparations.length === 1);
  await press(page); await waitStatus(page, 'recording');
  await release(page); await waitStatus(page, 'preparing');
  await page.evaluate(async () => {
    (await import('/src/store/app.store.ts')).useAppStore.getState().setLoadedModelFilename('parakeet-tdt-0.6b-v3');
    window.__QA__.warmups[0].resolve();
  });
  await waitStatus(page, 'done');
  assert.equal(await page.evaluate(() => window.__QA__.preparations.at(-1).filename), 'parakeet-tdt-0.6b-v3');
  assert.equal(await micCalls(page), 1);
  await page.close();

  // Empty audio closes capture without waiting or pasting after a late warm-up.
  page = await open();
  await page.waitForFunction(() => window.__QA__.warmups.length === 1);
  await page.evaluate(() => { window.__QA__.stopResult = { sample_count: 0, duration_secs: 0 }; });
  await press(page); await waitStatus(page, 'recording');
  await release(page); await waitStatus(page, 'idle');
  await page.evaluate(() => window.__QA__.warmups[0].resolve());
  await page.getByRole('button', { name: 'On-device: Ready. Configure speech engine' }).waitFor();
  assert.equal(await micCalls(page), 1);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('transcribe_buffer')), false);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('paste_text')), false);
  assert.equal(await page.evaluate(() => window.__QA__.appStore.getState().status), 'idle');
  await page.close();

  // A background failure leaves the microphone running; stop retries readiness.
  page = await open();
  await press(page); await waitStatus(page, 'recording');
  await page.waitForFunction(() => window.__QA__.warmups.length === 1);
  await page.evaluate(() => window.__QA__.warmups[0].reject(new Error('Background warm-up failed')));
  await page.waitForFunction(() => window.__QA__.readiness.getSnapshot() === 'error');
  assert.equal(await page.evaluate(() => window.__QA__.appStore.getState().isRecording), true);
  await release(page); await waitStatus(page, 'preparing');
  await page.waitForFunction(() => window.__QA__.warmups.length === 2);
  await page.evaluate(() => window.__QA__.warmups[1].resolve());
  await waitStatus(page, 'done');
  assert.equal(await micCalls(page), 1);
  await page.close();

  // Recovery during the post-stop wait suppresses its late result. The next
  // recording can still use the shared preparation and paste exactly once.
  page = await open();
  await press(page); await waitStatus(page, 'recording');
  await release(page); await waitStatus(page, 'preparing');
  await page.evaluate(() => window.__QA__.emit('system-wake'));
  await waitStatus(page, 'error');
  await page.waitForFunction(() => !window.__QA__.isRecoveringDictation());
  await press(page); await waitStatus(page, 'recording');
  await page.evaluate(() => window.__QA__.warmups[0].resolve());
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('paste_text')), false);
  await release(page); await waitStatus(page, 'done');
  assert.equal(await micCalls(page), 2);
  assert.equal(await page.evaluate(() => window.__QA__.calls.filter(c => c === 'paste_text').length), 1);
  await page.close();

  // A hung preparation times out after stop, and cannot resume the old session.
  page = await open();
  await page.clock.install();
  await press(page); await waitStatus(page, 'recording');
  await release(page); await page.clock.runFor(401); await waitStatus(page, 'preparing');
  await page.clock.runFor(180_001);
  await waitStatus(page, 'error');
  await page.waitForFunction(() => !window.__QA__.isRecoveringDictation());
  assert.match(await page.evaluate(() => window.__QA__.appStore.getState().error), /preparation timed out/);
  await page.evaluate(() => window.__QA__.warmups[0].resolve());
  await page.clock.runFor(1);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('transcribe_buffer')), false);
  assert.equal(await page.evaluate(() => window.__QA__.appStore.getState().isRecording), false);
  await page.close();

  assert.deepEqual(errors, []);
  console.log('Cleanup checks passed: preparation, filler-only no-op, pending audio disposal, next dictation, meaningful-text fallback, cancellation, timeout and mode changes.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
