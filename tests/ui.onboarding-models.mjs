import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import { fixture } from './ui.fixture.mjs';

const PARAKEET = 'parakeet-tdt-0.6b-v3';
const WHISPER = 'ggml-large-v3-turbo-q5_0.bin';
const engine = process.env.UI_BROWSER === 'webkit' ? webkit : chromium;
const port = process.env.UI_PORT ?? '1456';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
const errors = [];

function setupBridge({ existing = [], parakeet = true, local = true, restoreMic = false, holdLoad = false, mode = 'local', holdAvailability = false, failPreparationOnce = false, language } = {}) {
  const qa = window.__QA__;
  if (!restoreMic) delete qa.stores[1].selectedModelFilename;
  qa.stores[1].sttMode = mode;
  if (language !== undefined) qa.stores[1].transcriptionLanguage = language;
  qa.installed = new Set(existing);
  qa.downloads = [];
  qa.loads = [];
  qa.pendingDownloads = {};
  qa.pendingLoads = {};
  const original = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    const handled = ['check_model_exists', 'download_model_file', 'load_local_model', 'is_local_stt_available', 'get_available_models'];
    if (handled.includes(command)) qa.calls.push(command);
    if (command === 'is_local_stt_available') {
      if (holdAvailability) return new Promise(resolve => { qa.resolveAvailability = resolve; });
      return local;
    }
    if (command === 'check_model_exists') return qa.installed.has(args.filename);
    if (command === 'get_available_models') {
      const catalog = await original(command, args);
      return parakeet ? catalog : catalog.filter(model => model.backend === 'whisper');
    }
    if (command === 'download_model_file') {
      qa.downloads.push(args.filename);
      return new Promise((resolve, reject) => {
        qa.pendingDownloads[args.filename] = {
          resolve: () => {
            qa.installed.add(args.filename);
            qa.emit('model-download-complete', { filename: args.filename });
            resolve(`/models/${args.filename}`);
          },
          reject: () => reject(new Error('Connection interrupted')),
        };
      });
    }
    if (command === 'load_local_model') {
      qa.loads.push(args.filename);
      if (failPreparationOnce) { failPreparationOnce = false; throw new Error('Synthetic preparation failed'); }
      if (holdLoad) return new Promise(resolve => { qa.pendingLoads[args.filename] = resolve; });
      return;
    }
    if (command === 'check_microphone' && restoreMic) return 'denied';
    if (command === 'request_microphone' && restoreMic) return false;
    return original(command, args);
  };
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview did not start')), 15000);
    server.stdout.on('data', chunk => { if (String(chunk).includes(port)) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
  });
  browser = await engine.launch({ headless: true });
  const open = async (options = {}) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 680 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ content: `(${fixture.toString()})(${JSON.stringify({ onboarding: !options.returning && !options.restoreMic, empty: true, theme: options.theme ?? 'light' })});(${setupBridge.toString()})(${JSON.stringify(options)});` });
    await page.goto(`http://127.0.0.1:${port}`);
    return page;
  };
  const waitDownload = (page, filename) => page.waitForFunction(name => Boolean(window.__QA__.pendingDownloads[name]), filename);
  const finishDownload = (page, filename) => page.evaluate(name => window.__QA__.pendingDownloads[name].resolve(), filename);
  const selected = page => page.evaluate(() => window.__QA__.stores[1].selectedModelFilename);
  const assertProgress = async (page, current, total, label) => {
    const progress = page.locator('.onboarding-progress');
    await progress.getByText(`Step ${current} of ${total} · ${label}`, { exact: true }).waitFor();
    assert.equal(await progress.locator('li').count(), total, 'Dot count matches the displayed total');
    assert.equal(await progress.locator('li[aria-current="step"]').innerText(), label, 'Active dot matches the current screen');
    assert.equal(await progress.locator('li').nth(current - 1).getAttribute('aria-current'), 'step');
  };
  const reachLanguage = async page => {
    await assertProgress(page, 1, 7, 'Welcome');
    await page.getByRole('button', { name: 'Get Started', exact: true }).click();
    await page.getByRole('combobox', { name: 'Dictation language', exact: true }).waitFor();
    await assertProgress(page, 2, 7, 'Dictation language');
  };
  const reachTrigger = async page => {
    await reachLanguage(page);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Microphone Access', exact: true }).waitFor();
    await assertProgress(page, 3, 7, 'Microphone');
    await page.getByRole('heading', { name: 'Accessibility Permission', exact: true }).waitFor();
    await assertProgress(page, 4, 7, 'Accessibility');
    await page.getByRole('heading', { name: 'Choose Your Trigger Key', exact: true }).waitFor();
    await assertProgress(page, 5, 7, 'Trigger key');
  };
  const reachModels = async page => {
    await reachTrigger(page);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('combobox', { name: 'Speech model', exact: true }).waitFor();
    await assertProgress(page, 6, 7, 'Speech engine');
  };
  const chooseWhisper = async page => {
    await page.getByRole('combobox', { name: 'Speech model', exact: true }).click();
    await page.getByRole('option', { name: 'Whisper Large Turbo Q5 (574 MB)', exact: true }).click();
  };

  await mkdir('artifacts/onboarding-language', { recursive: true });
  // A new install starts with English. The selected spoken language is saved
  // before permission setup, and a failed write leaves the choice retryable.
  for (const theme of ['dark', 'light']) {
    const languagePage = await open({ theme });
    await reachLanguage(languagePage);
    const picker = languagePage.getByRole('combobox', { name: 'Dictation language', exact: true });
    assert.equal(await picker.innerText(), 'English');
    await languagePage.screenshot({ path: `artifacts/onboarding-language/${engine.name()}-${theme}.png`, animations: 'disabled' });
    await picker.click();
    await languagePage.getByRole('option', { name: 'French', exact: true }).click();
    await languagePage.evaluate(() => { window.__QA__.failures['plugin:store|save'] = 'Disk full'; });
    await languagePage.getByRole('button', { name: 'Continue', exact: true }).click();
    await languagePage.getByRole('alert').filter({ hasText: 'Could not save your dictation language' }).waitFor();
    assert.equal(await picker.innerText(), 'French', 'A failed write keeps the draft choice');
    assert.equal(await languagePage.getByRole('heading', { name: 'Microphone Access', exact: true }).count(), 0);
    assert.equal(await languagePage.evaluate(async () => (await import('/src/store/app.store.ts')).useAppStore.getState().transcriptionLanguage), 'en');
    await languagePage.evaluate(() => { delete window.__QA__.failures['plugin:store|save']; });
    await languagePage.getByRole('button', { name: 'Continue', exact: true }).click();
    await languagePage.getByRole('heading', { name: 'Microphone Access', exact: true }).waitFor();
    assert.equal(await languagePage.evaluate(() => window.__QA__.stores[1].transcriptionLanguage), 'fr');
    assert.equal(await languagePage.evaluate(async () => (await import('/src/store/app.store.ts')).useAppStore.getState().transcriptionLanguage), 'fr');
    await languagePage.close();
  }
  // A previously saved choice, including auto-detect, survives resumed setup.
  for (const [language, label] of [['fr', 'French'], ['auto', 'Auto-detect']]) {
    const languagePage = await open({ language });
    await reachLanguage(languagePage);
    assert.equal(await languagePage.getByRole('combobox', { name: 'Dictation language', exact: true }).innerText(), label);
    await languagePage.getByRole('button', { name: 'Continue', exact: true }).click();
    await languagePage.getByRole('heading', { name: 'Microphone Access', exact: true }).waitFor();
    assert.equal(await languagePage.evaluate(() => window.__QA__.stores[1].transcriptionLanguage), language);
    await languagePage.close();
  }

  // Downloads begin before permissions; StrictMode starts only one transfer.
  let page = await open();
  await waitDownload(page, PARAKEET);
  assert.deepEqual(await page.evaluate(() => window.__QA__.downloads), [PARAKEET]);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('download_s1_model')), false);
  await finishDownload(page, PARAKEET);
  await page.waitForFunction(name => window.__QA__.stores[1].selectedModelFilename === name, PARAKEET);
  await page.getByRole('heading', { name: 'Welcome to Linty', exact: true }).waitFor();
  await reachModels(page);
  assert.equal(await page.evaluate(() => window.__QA__.stores[1].transcriptionLanguage), 'en', 'Continuing without a change persists English');
  assert.match(await page.getByRole('combobox', { name: 'Speech model' }).innerText(), /Parakeet/);
  await page.getByRole('heading', { name: 'Speech Engine Ready' }).waitFor();
  await page.screenshot({ path: '/tmp/linty-onboarding-default-model.png' });
  await chooseWhisper(page);
  await waitDownload(page, WHISPER);
  assert.deepEqual(await page.evaluate(() => window.__QA__.downloads), [PARAKEET, WHISPER]);
  await finishDownload(page, WHISPER);
  await page.getByRole('heading', { name: 'Speech Engine Ready' }).waitFor();
  assert.equal(await selected(page), WHISPER);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await assertProgress(page, 7, 7, 'Ready');
  await page.getByRole('button', { name: 'Start Using Linty', exact: true }).click();
  await page.getByRole('heading', { name: 'Your dictation', exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await import('/src/store/app.store.ts')).useAppStore.getState().transcriptionLanguage), 'en');
  assert.deepEqual(await page.evaluate(() => window.__QA__.loads), [PARAKEET, WHISPER]);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('download_s1_model')), false);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Text cleanup', exact: true }).click();
  await page.getByRole('option', { name: 'Clean up on this Mac', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('download_s1_model')), false);
  await page.getByRole('button', { name: 'Download & use', exact: true }).click();
  await page.waitForFunction(() => window.__QA__.stores[1].reformatEnabled === true);
  assert.equal(await page.evaluate(() => window.__QA__.calls.filter(command => command === 'download_s1_model').length), 1);
  await page.close();

  // Changing selection while the default is downloading keeps progress and activation separate.
  page = await open();
  await waitDownload(page, PARAKEET);
  await reachModels(page);
  await page.evaluate(name => window.__QA__.emit('model-download-progress', { filename: name, progress: 37 }), PARAKEET);
  await page.getByText('37%', { exact: true }).waitFor();
  await chooseWhisper(page);
  await waitDownload(page, WHISPER);
  await page.evaluate(([parakeet, whisper]) => {
    window.__QA__.emit('model-download-progress', { filename: whisper, progress: 22 });
    window.__QA__.emit('model-download-progress', { filename: parakeet, progress: 91 });
  }, [PARAKEET, WHISPER]);
  await page.getByText('22%', { exact: true }).waitFor();
  await finishDownload(page, WHISPER);
  await page.getByRole('heading', { name: 'Speech Engine Ready' }).waitFor();
  await finishDownload(page, PARAKEET);
  assert.equal(await selected(page), WHISPER);
  assert.deepEqual(await page.evaluate(() => window.__QA__.loads), [WHISPER]);
  await page.close();

  // A completed download is retained when loading overlaps a new selection.
  page = await open({ holdLoad: true });
  await waitDownload(page, PARAKEET);
  await finishDownload(page, PARAKEET);
  await page.waitForFunction(name => Boolean(window.__QA__.pendingLoads[name]), PARAKEET);
  await reachModels(page);
  await page.getByRole('heading', { name: 'Preparing Dictation', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Speech Engine Ready', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).count(), 0, 'Fresh setup cannot finish while preparation is pending');
  await chooseWhisper(page);
  await waitDownload(page, WHISPER);
  await finishDownload(page, WHISPER);
  await page.evaluate(name => window.__QA__.pendingLoads[name](), PARAKEET);
  await page.waitForFunction(name => Boolean(window.__QA__.pendingLoads[name]), WHISPER);
  assert.equal(await selected(page), undefined);
  await page.evaluate(name => window.__QA__.pendingLoads[name](), WHISPER);
  await page.getByRole('heading', { name: 'Speech Engine Ready' }).waitFor();
  assert.equal(await selected(page), WHISPER);
  await page.close();

  // A first-load preparation failure retains the completed download and can
  // retry preparation without showing readiness early or downloading twice.
  page = await open({ failPreparationOnce: true });
  await waitDownload(page, PARAKEET);
  await finishDownload(page, PARAKEET);
  await reachModels(page);
  await page.getByText('Synthetic preparation failed', { exact: false }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Speech Engine Ready' }).count(), 0);
  await page.getByRole('button', { name: 'Retry Preparation', exact: true }).click();
  await page.getByRole('heading', { name: 'Speech Engine Ready' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__QA__.downloads), [PARAKEET]);
  assert.equal(await page.evaluate(() => window.__QA__.loads.length), 2);
  await page.close();

  // Download failure remains retryable at the model step.
  page = await open();
  await waitDownload(page, PARAKEET);
  await page.evaluate(name => window.__QA__.pendingDownloads[name].reject(), PARAKEET);
  await reachModels(page);
  await page.getByText('Connection interrupted', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Retry Download', exact: true }).click();
  await page.waitForFunction(() => window.__QA__.downloads.length === 2);
  await finishDownload(page, PARAKEET);
  await page.getByRole('heading', { name: 'Speech Engine Ready' }).waitFor();
  await page.close();

  // Skipping to cloud leaves it selected even if the background transfer finishes later.
  page = await open();
  await waitDownload(page, PARAKEET);
  await reachModels(page);
  await page.getByRole('button', { name: 'Skip — use cloud instead', exact: true }).click();
  await assertProgress(page, 7, 8, 'Cloud setup');
  await page.getByRole('textbox', { name: 'Groq API key' }).fill('synthetic-test-key');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start Using Linty', exact: true }).waitFor();
  await assertProgress(page, 8, 8, 'Ready');
  await finishDownload(page, PARAKEET);
  assert.equal(await page.evaluate(() => window.__QA__.stores[1].sttMode), 'cloud');
  assert.deepEqual(await page.evaluate(() => window.__QA__.loads), []);
  await page.close();

  // Unsupported Parakeet falls back to Whisper; already installed models are reused.
  page = await open({ parakeet: false });
  await waitDownload(page, WHISPER);
  assert.deepEqual(await page.evaluate(() => window.__QA__.downloads), [WHISPER]);
  await page.close();
  page = await open({ existing: [PARAKEET], mode: 'cloud' });
  await page.waitForFunction(name => window.__QA__.stores[1].selectedModelFilename === name, PARAKEET);
  assert.deepEqual(await page.evaluate(() => window.__QA__.downloads), []);
  await reachModels(page);
  await page.evaluate(() => { window.__QA__.failures['plugin:store|save'] = 'Disk full'; });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not save your speech engine' }).waitFor();
  await page.evaluate(() => { delete window.__QA__.failures['plugin:store|save']; });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start Using Linty', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__QA__.stores[1].sttMode), 'local');
  assert.deepEqual(await page.evaluate(() => window.__QA__.downloads), []);
  await page.close();

  // Unsupported local builds still show permissions before cloud setup.
  page = await open({ local: false });
  await reachTrigger(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: 'Cloud Transcription', exact: true }).waitFor();
  await assertProgress(page, 6, 7, 'Cloud setup');
  await page.getByRole('textbox', { name: 'Groq API key' }).fill('synthetic-test-key');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await assertProgress(page, 7, 7, 'Ready');
  assert.deepEqual(await page.evaluate(() => window.__QA__.downloads), []);
  await page.close();

  // A late support check keeps the local screen in the count if it was visited.
  page = await open({ holdAvailability: true });
  await reachTrigger(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await assertProgress(page, 6, 7, 'Speech engine');
  await page.evaluate(() => window.__QA__.resolveAvailability(false));
  await page.getByRole('heading', { name: 'Cloud Transcription', exact: true }).waitFor();
  await assertProgress(page, 7, 8, 'Cloud setup');
  await page.close();

  // Existing users and permission recovery never initiate first-run downloads.
  for (const language of [undefined, 'auto', 'fr']) {
    page = await open({ returning: true, language });
    await page.getByRole('heading', { name: 'Your dictation', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__QA__.downloads), []);
    assert.equal(await page.evaluate(async () => (await import('/src/store/app.store.ts')).useAppStore.getState().transcriptionLanguage), language ?? 'auto', 'An existing installation keeps its language and prior default');
    await page.close();
  }
  page = await open({ restoreMic: true, language: 'fr' });
  await page.getByRole('heading', { name: 'Microphone Access', exact: true }).waitFor();
  assert.equal(await page.locator('.onboarding-progress').innerText(), 'Restore microphone access');
  assert.equal(await page.locator('.onboarding-progress li').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__QA__.downloads), []);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('download_s1_model')), false);
  assert.equal(await page.evaluate(async () => (await import('/src/store/app.store.ts')).useAppStore.getState().transcriptionLanguage), 'fr');
  await page.close();

  assert.deepEqual(errors, []);
  console.log(`Onboarding checks passed in ${engine.name()}: English default, language persistence/retry, preserved existing preferences, screen counts for local/cloud/recovery paths, downloads, model switching, races, retry, fallback, and S1-mini only on request.`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
