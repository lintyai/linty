import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { fixture } from './ui.fixture.mjs';

const engine = process.env.UI_BROWSER === 'webkit' ? webkit : chromium;
const port = engine === webkit ? '1440' : '1439';
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
const errors = [];
const failures = [];
const output = engine === webkit ? 'artifacts/ui-webkit' : 'artifacts/ui';
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('UI preview did not start')), 15000);
    server.stdout.on('data', (chunk) => { if (String(chunk).includes(port)) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
  });
  await mkdir(output, { recursive: true });
  browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1080, height: 760 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(fixture, {});
  await page.goto(url);
  await page.getByRole('heading', { name: 'Your dictation', exact: true }).waitFor();
  const audit = async (name) => {
    // A frame lets React commit state and the reduced-motion transition finish.
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    if (result.violations.length) console.log(name, JSON.stringify(result.violations.map(v => ({id:v.id, nodes:v.nodes.map(n=>({target:n.target,detail:n.failureSummary}))}))));
    failures.push(...result.violations.map(v => ({ screen: name, id: v.id, targets: v.nodes.map(n => n.target), details: v.nodes.map(n => n.failureSummary) })));
    assert.equal(await page.locator('button button').count(), 0, `${name}: nested buttons`);
  };
  const screenshot = async (name) => {
    while (!(await page.getByRole('dialog').count()) && await page.getByLabel('Dismiss notification').count()) await page.getByLabel('Dismiss notification').first().click();
    return page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
  };
  await audit('overview-light'); await screenshot('overview-light');
  await page.getByRole('button', {name:'View all apps', exact:true}).click();
  await page.getByRole('main').getByRole('heading', {name:'Dictation by app', exact:true}).waitFor();
  await page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name:'Overview',exact:true}).click();
  await page.keyboard.press('Meta+f');
  assert.equal(await page.locator('#history-search').evaluate(el => el === document.activeElement), true);
  await page.locator('#history-search').fill('zz-no-matches');
  await page.getByRole('heading', {name:'No results'}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#history-search').inputValue(), '');
  await page.locator('[data-transcript-id]').first().click();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('[data-transcript-id="qa-1"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Meta+c');
  assert.match(await page.evaluate(() => window.__QA__.clipboard), /thoughtful feedback/);
  await page.locator('.history-detail').getByLabel('Delete transcript', {exact:true}).click();
  assert.equal(await page.locator('[data-transcript-id="qa-1"]').count(), 0);
  await page.getByRole('button', {name:'Undo',exact:true}).click();
  await page.locator('[data-transcript-id="qa-1"]').waitFor();
  assert.equal(await page.locator('[data-transcript-id]').count(), 18);
  await page.locator('[data-transcript-id]').first().click();
  await audit('history-light'); await screenshot('history-light');
  // Editing a transcript records the correction, shows the diff and offers to learn the word.
  await page.locator('.history-detail').getByLabel('Edit transcription', {exact:true}).click();
  const editor = page.getByLabel('Edit transcription text', {exact:true});
  await editor.fill((await editor.inputValue()).replace('experience', 'expereince'));
  await page.getByRole('button', {name:'Save', exact:true}).click();
  await page.getByText('Saved. 1 suggestion waiting on the Dictionary page.').waitFor();
  await page.locator('.correction-pair ins', {hasText:'expereince'}).waitFor();
  assert.equal(await page.evaluate(() => window.__QA__.stores[3].corrections[0].pairs[0].from), 'experience');
  assert.equal(await page.evaluate(() => window.__QA__.stores[4].suggestions.length), 2);
  await page.getByRole('button', {name:'Add expereince to dictionary, replacing experience', exact:true}).click();
  await page.getByText('“expereince” added to your dictionary').waitFor();
  await page.locator('.correction-known').waitFor();
  assert.equal(await page.evaluate(() => window.__QA__.stores[4].entries.some(e => e.right === 'expereince' && e.wrong.includes('experience'))), true);
  await audit('history-correction'); await screenshot('history-correction');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.history-detail').count(), 0);
  await page.keyboard.press('Meta+k');
  await page.getByRole('combobox', {name:'Search Linty'}).fill('language');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.getByLabel('Settings category').waitFor();
  assert.equal(await page.getByLabel('Settings category').inputValue(), 'language');
  await page.getByLabel('Transcription language', {exact:true}).selectOption('es');
  assert.equal(await page.evaluate(() => window.__QA__.stores[1].transcriptionLanguage), 'es');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Settings category').selectOption('appearance');
    await page.getByRole('button', {name: theme === 'light' ? 'Light' : 'Dark', exact:true}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    if (theme === 'light') {
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      assert.equal(await page.getByRole('button', {name:'Dark',exact:true}).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    }
    for (const section of ['general', 'audio', 'models', 'language', 'appearance', 'privacy']) {
      await page.getByLabel('Settings category').selectOption(section);
      await audit(`${section}-${theme}`);
      if (section === 'models' || section === 'appearance' || section === 'language') await screenshot(`${section}-${theme}`);
    }
    for (const name of ['Overview', 'History', 'Apps', 'Dictionary', 'Shortcuts', 'System Check', 'About']) {
      await page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name,exact:true}).click();
      await audit(`${name}-${theme}`);
      if (name === 'Overview') await screenshot(`overview-${theme}`);
      if (name === 'Apps') await screenshot(`apps-${theme}`);
      if (name === 'Dictionary') await screenshot(`dictionary-${theme}`);
    }
    await page.keyboard.press('Meta+,');
  }
  // Expose recoverable failures from the same commands used by the desktop app.
  await page.getByRole('button', {name:'About',exact:true}).click();
  await page.evaluate(() => { window.__QA__.failures['plugin:updater|check'] = 'Offline'; });
  await page.getByRole('button', {name:'Check for updates',exact:true}).click();
  await page.getByText('Could not check for updates. Check your connection and try again.').waitFor();
  await audit('update-error');
  await page.evaluate(() => { delete window.__QA__.failures['plugin:updater|check']; });
  await page.getByRole('button', {name:'Retry',exact:true}).click();
  await page.getByText('You’re using the latest version of Linty.').waitFor();
  // Dictionary page: accept a suggestion, add a word by hand, pause one, and see the learning switches.
  await page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name:'Dictionary',exact:true}).click();
  await page.getByRole('main').getByRole('heading', {name:'Dictionary', exact:true}).waitFor();
  await page.locator('.dictionary-row', {hasText:'Tauri'}).getByRole('button', {name:'Add', exact:true}).click();
  await page.getByText('“Tauri” added to your dictionary').waitFor();
  assert.equal(await page.evaluate(() => window.__QA__.stores[4].entries.some(e => e.right === 'Tauri' && e.wrong.includes('Tory'))), true);
  assert.equal(await page.evaluate(() => window.__QA__.stores[4].suggestions.some(s => s.right === 'Tauri')), false);
  await page.locator('#dictionary-right').fill('Zustand');
  await page.locator('#dictionary-wrong').fill('Zoo stand, Sustained');
  await page.getByRole('button', {name:'Add to dictionary', exact:true}).click();
  await page.getByText('“Zustand” added to your dictionary').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__QA__.stores[4].entries.find(e => e.right === 'Zustand').wrong), ['Zoo stand', 'Sustained']);
  await page.getByRole('switch', {name:'Disable Linty', exact:true}).click();
  await page.getByRole('switch', {name:'Enable Linty', exact:true}).waitFor();
  assert.equal(await page.evaluate(() => window.__QA__.stores[4].entries.find(e => e.right === 'Linty').enabled), false);
  await page.getByRole('button', {name:'Remove Zustand', exact:true}).click();
  await page.getByText('“Zustand” removed').waitFor();
  await audit('dictionary-edited'); await screenshot('dictionary-edited');
  await page.keyboard.press('Meta+,');
  await page.getByLabel('Settings category').selectOption('privacy');
  await page.getByRole('switch', {name:'Learn new words automatically', exact:true}).click();
  assert.equal(await page.evaluate(() => window.__QA__.stores[1].autoLearnWords), true);
  await page.getByRole('switch', {name:'Apply my dictionary', exact:true}).click();
  assert.equal(await page.evaluate(() => window.__QA__.stores[1].dictionaryEnabled), false);
  await page.getByRole('switch', {name:'Apply my dictionary', exact:true}).click();
  await screenshot('privacy-light');
  await page.keyboard.press('Meta+,');
  await page.getByLabel('Settings category').selectOption('models');
  await page.getByRole('button',{name:'Cloud',exact:true}).click();
  await page.getByLabel('Groq API key',{exact:true}).fill('synthetic-test-key');
  await page.getByLabel('Groq API key',{exact:true}).blur();
  assert.equal(await page.evaluate(() => window.__QA__.stores[1].groqApiKey), 'synthetic-test-key');
  await page.getByLabel('Show API key',{exact:true}).click();
  assert.equal(await page.getByLabel('Groq API key',{exact:true}).getAttribute('type'),'text');
  await audit('cloud-settings');
  await page.getByRole('button',{name:'Local',exact:true}).click();
  await page.evaluate(() => { window.__QA__.failures.download_model_file = 'Offline'; });
  await page.getByRole('button',{name:'Download',exact:true}).first().click();
  await page.getByText('Model download failed. Check your connection, then try again.').waitFor();
  await page.evaluate(() => { delete window.__QA__.failures.download_model_file; });
  // Native reset-menu event opens an inert dialog; cancellation restores focus.
  await page.getByLabel('Settings category').focus();
  await page.evaluate(() => window.__QA__.emit('menu-reset-all-data', {}));
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('button', {name:'Cancel',exact:true}).evaluate(el => el === document.activeElement), true);
  for (let i=0; i<5; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
  await audit('reset-dialog'); await screenshot('reset-dialog');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByLabel('Settings category').evaluate(el=>el === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.__QA__.calls.includes('reset_all_data')), false);
  await page.getByRole('button', {name:'Hide sidebar',exact:true}).click();
  assert.equal(await page.locator('#app-sidebar').count(), 0);
  await page.keyboard.press('Control+Meta+s');
  await page.locator('#app-sidebar').waitFor();
  // Original minimum window size: every preference remains reachable without horizontal overflow.
  await page.setViewportSize({ width:640, height:480 });
  for (const section of ['general','audio','models','language','appearance','privacy']) {
    await page.getByLabel('Settings category').selectOption(section);
    const overflow = await page.locator('.preferences-scroll').evaluate(el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false, `${section}: horizontal overflow at 640 × 480`);
  }
  await screenshot('settings-small');
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.locator('[data-transcript-id="qa-0"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Transcription text');
  await screenshot('history-small'); await audit('history-small');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-transcript-id') === 'qa-0');
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Back to history',exact:true}).click();
  assert.equal(await page.locator('.history-list').isVisible(), true);
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-transcript-id') === 'qa-0');
  await context.close();
  // Undo retries a failed save and merges the deleted record with newer dictations.
  const recoveryContext = await browser.newContext({ viewport:{width:1080,height:760}, reducedMotion:'reduce' });
  const recovery = await recoveryContext.newPage();
  recovery.on('pageerror', error => errors.push(error.message));
  await recovery.addInitScript(fixture, {});
  await recovery.goto(url);
  await recovery.getByRole('button',{name:'History',exact:true}).click();
  await recovery.locator('[data-transcript-id="qa-0"]').click();
  await recovery.locator('.history-detail').getByLabel('Delete transcript',{exact:true}).click();
  await recovery.getByRole('button',{name:'Undo',exact:true}).waitFor();
  await recovery.evaluate(async () => {
    const { saveTranscript } = await import('/src/services/history.service.ts');
    await saveTranscript({ ...window.__QA__.stores[2].transcripts[0], transcriptId:'qa-new', timestamp:Date.now(), finalText:'A newer dictation must be preserved.' });
    window.__QA__.failures['plugin:store|save'] = 'Disk unavailable';
  });
  await recovery.getByRole('button',{name:'Undo',exact:true}).click();
  await recovery.getByText('Could not restore transcript. Try Undo again.').waitFor();
  assert.equal(await recovery.locator('[data-transcript-id="qa-0"]').count(), 0);
  await recovery.evaluate(() => { delete window.__QA__.failures['plugin:store|save']; });
  await recovery.getByRole('button',{name:'Undo',exact:true}).click();
  await recovery.locator('[data-transcript-id="qa-0"]').waitFor();
  assert.equal(await recovery.locator('[data-transcript-id]').count(), 19);
  assert.equal(await recovery.locator('[data-transcript-id]').first().getAttribute('data-transcript-id'), 'qa-new');
  assert.equal(await recovery.evaluate(() => new Set(window.__QA__.stores[2].transcripts.map(record => record.transcriptId)).size), 19);
  await recoveryContext.close();
  const fresh = await browser.newContext({ viewport:{width:640,height:480}, reducedMotion:'reduce' });
  const setup = await fresh.newPage();
  setup.on('pageerror', error => errors.push(error.message));
  await setup.addInitScript(fixture,{onboarding:true,empty:true});
  await setup.goto(url);
  await setup.getByRole('button',{name:'Get Started'}).waitFor();
  await setup.screenshot({path:`${output}/onboarding-small.png`,animations:'disabled'});
  await setup.getByRole('button',{name:'Get Started'}).click();
  await setup.getByRole('heading',{name:'Choose Your Trigger Key'}).waitFor();
  await setup.getByRole('button',{name:'Continue',exact:true}).click();
  await setup.getByRole('button',{name:'Start Using Linty'}).waitFor();
  await setup.getByRole('button',{name:'Start Using Linty'}).click();
  await setup.getByText('Ready for your first dictation').waitFor();
  await setup.getByRole('button',{name:'History',exact:true}).click();
  await setup.getByRole('heading',{name:'No transcriptions yet'}).waitFor();
  await setup.screenshot({path:`${output}/history-empty.png`,animations:'disabled'});
  const capsuleContext = await browser.newContext({ viewport:{width:380,height:70}, reducedMotion:'reduce' });
  const capsule = await capsuleContext.newPage();
  capsule.on('pageerror', error => errors.push(error.message));
  await capsule.addInitScript(fixture,{theme:'dark'});
  await capsule.goto(`${url}/capsule.html`);
  await capsule.waitForFunction(() => window.__QA__.calls.includes('plugin:event|listen'));
  for (const state of ['recording','transcribing','done','error']) {
    await capsule.evaluate((state) => window.__QA__.emit('capsule-state', {state, text: state === 'done' ? 'Your words are ready.' : undefined, error: state === 'error' ? 'Could not transcribe. Please try again.' : undefined}), state);
    await capsule.locator('.capsule-pill').waitFor();
    await capsule.screenshot({path:`${output}/capsule-${state}.png`,animations:'disabled'});
  }
  await capsuleContext.close();
  assert.deepEqual(errors, [], 'Unexpected runtime errors');
  assert.deepEqual(failures, [], 'Accessibility failures');
  console.log('UI checks passed: both themes, all screens, settings persistence, keyboard navigation, copy, delete/undo, corrections and dictionary, modal focus, sidebar, minimum window, and onboarding.');
  console.log(`Screenshots: ${output}`);
} finally { await browser?.close(); server.kill(); }
