import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { fixture } from './ui.fixture.mjs';
const engine = process.env.UI_BROWSER === 'webkit' ? webkit : chromium;
const port = process.env.UI_PORT ?? '1466';
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',port,'--strictPort'],{stdio:['ignore','pipe','pipe']});
let browser;
const errors=[];
try {
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Preview startup timed out')),15000);
    server.stdout.on('data',chunk=>{if(String(chunk).includes(port)){clearTimeout(timer);resolve();}});
    server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Preview exited ${code}`));});
  });
  browser=await engine.launch({headless:true});
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(fixture,{});
  await page.addInitScript(()=>{
    const original=window.__TAURI_INTERNALS__.invoke;
    window.__QA__.handlers={}; window.__QA__.capsule=[]; window.__QA__.generation=0;
    window.__TAURI_INTERNALS__.invoke=(command,args)=>{
      if(command==='plugin:global-shortcut|register') for(const shortcut of args.shortcuts) window.__QA__.handlers[shortcut]=args.handler.onmessage;
      if(command==='plugin:global-shortcut|unregister') for(const shortcut of args.shortcuts) delete window.__QA__.handlers[shortcut];
      if(command==='emit_capsule_state') window.__QA__.capsule.push(args);
      if(command==='start_recording') {
        window.__QA__.calls.push(command);
        if(window.__QA__.delayStart) return new Promise(resolve=>{window.__QA__.resolveStart=()=>resolve(++window.__QA__.generation);});
        return Promise.resolve(++window.__QA__.generation);
      }
      if(command==='stop_recording' && window.__QA__.hasAudio) {window.__QA__.calls.push(command);return Promise.resolve({sample_count:32000,duration_secs:2});}
      if(command==='transcribe_buffer') {window.__QA__.calls.push(command);return Promise.resolve({text:'Private words stay out of the pill.',vocabulary_applied:[]});}
      return original(command,args);
    };
    document.hasFocus=()=>false;
  });
  await page.goto(url);
  await page.getByRole('heading',{name:'Your dictation',exact:true}).waitFor();
  const store=await page.evaluateHandle(async()=>(await import('/src/store/app.store.ts')).useAppStore);
  const status=s=>page.waitForFunction(({store,s})=>store.getState().status===s,{store,s});
  const get=()=>store.evaluate(s=>({recording:s.getState().isRecording,handsFree:s.getState().handsFree,quiet:s.getState().quietSeconds,generation:s.getState().recordingGeneration}));
  const count=command=>page.evaluate(command=>window.__QA__.calls.filter(c=>c===command).length,command);
  const double=source=>page.evaluate(source=>{
    const fire=state=>source==='modifier'?window.__QA__.emit(state==='Pressed'?'fnkey-pressed':'fnkey-released'):window.__QA__.handlers[source]({state,shortcut:source});
    fire('Pressed');fire('Released');fire('Pressed');fire('Released');
  },source);
  await page.clock.install();
  for(const trigger of ['fn','modifier:right-command','Control+Option+Space']) {
    await store.evaluate((s,trigger)=>s.getState().setTriggerKey(trigger),trigger);
    const source=trigger==='Control+Option+Space'?trigger:'modifier';
    if(source!=='modifier') await page.waitForFunction(source=>!!window.__QA__.handlers[source],source);
    else await page.clock.runFor(10);
    const starts=await count('start_recording'), stops=await count('stop_recording');
    await double(source); await status('recording'); await page.clock.runFor(500);
    assert.equal((await get()).handsFree,true,`${trigger} latches`);
    assert.equal(await count('start_recording'),starts+1);
    assert.equal(await count('stop_recording'),stops);
    await double(source); await status('idle');
    assert.equal(await count('stop_recording'),stops+1);
  }
  // Alternate shortcut has the same gestures, and latching survives slow startup.
  await store.evaluate(s=>s.getState().setTriggerKey('fn')); await page.clock.runFor(10);
  const alternate='CommandOrControl+Shift+Space';
  await page.waitForFunction(key=>!!window.__QA__.handlers[key],alternate);
  await page.evaluate(()=>{window.__QA__.delayStart=true;});
  await double(alternate);
  await page.waitForFunction(()=>!!window.__QA__.resolveStart);
  await page.clock.runFor(600);
  await page.evaluate(()=>{window.__QA__.resolveStart();window.__QA__.delayStart=false;});
  await status('recording'); assert.equal((await get()).handsFree,true);
  let generation=(await get()).generation;
  await page.evaluate(generation=>window.__QA__.emit('recording-quiet',{generation,quiet_seconds:20}),generation);
  assert.equal((await get()).quiet,20);
  await page.evaluate(generation=>window.__QA__.emit('recording-quiet',{generation,quiet_seconds:0}),generation);
  assert.equal((await get()).quiet,0,'Input clears the warning');
  let inferences=await count('transcribe_buffer');
  await page.evaluate(()=>{window.__QA__.capsule=[];});
  await page.evaluate(generation=>window.__QA__.emit('recording-auto-stopped',{generation,quiet_seconds:30,heard_input:false}),generation);
  await status('idle');
  await page.waitForFunction(()=>window.__QA__.capsule.at(-1)?.state==='quiet-stop');
  assert.equal(await page.evaluate(()=>window.__QA__.capsule.some(s=>s.state==='idle')),false,'Empty auto-stop never hides the pill between listening and its notice');
  assert.equal(await count('transcribe_buffer'),inferences,'An empty auto-stop does not run inference');
  assert.ok(await count('recover_recording')>0,'Empty audio is freed');
  await page.evaluate(()=>{window.__QA__.hasAudio=true;});
  await double('modifier'); await status('recording');
  const newer=(await get()).generation;
  await page.evaluate(generation=>window.__QA__.emit('recording-auto-stopped',{generation,quiet_seconds:30,heard_input:true}),generation);
  assert.equal((await get()).recording,true,'A stale timeout cannot stop the new session');
  await page.evaluate(generation=>{
    window.__QA__.emit('recording-auto-stopped',{generation,quiet_seconds:30,heard_input:true});
    window.__QA__.emit('fnkey-released');
  },newer);
  await status('done');
  assert.equal(await count('transcribe_buffer'),inferences+1,'Input is transcribed once on auto-stop');
  assert.equal(await count('paste_text'),1);
  const done=await page.evaluate(()=>window.__QA__.capsule.findLast(s=>s.state==='done'));
  assert.deepEqual(done,{state:'done'},'The success payload never contains transcript text');
  await page.evaluate(()=>{window.__QA__.hasAudio=false;});
  await double('modifier'); await status('recording');
  await store.evaluate(s=>s.getState().setTriggerKey('Control+Option+Space'));
  await status('idle');
  assert.equal((await get()).handsFree,false,'Changing the configured trigger finishes the old capture');

  await mkdir('artifacts/dictation-pill',{recursive:true});
  for(const theme of ['dark','light']) for(const reducedMotion of ['no-preference','reduce']) {
    const context=await browser.newContext({viewport:{width:380,height:52},reducedMotion});
    const pill=await context.newPage(); pill.on('pageerror',e=>errors.push(e.message));
    await pill.addInitScript(fixture,{theme}); await pill.goto(`${url}/capsule.html`);
    await pill.waitForFunction(()=>window.__QA__?.calls.includes('plugin:event|listen'));
    await pill.clock.install();
    const send=payload=>pill.evaluate(payload=>window.__QA__.emit('capsule-state',payload),payload);
    await send({state:'recording',generation:12,hands_free:true});
    await pill.locator('.capsule-recording').waitFor();
    assert.equal(await pill.getByAltText('Linty').getAttribute('src'),'/brand/favicon.png');
    await pill.clock.runFor(200);
    await pill.locator('.capsule-pill').evaluate(el=>Promise.allSettled(el.getAnimations().map(a=>a.finished)));
    const geometry=await pill.locator('.capsule-pill').boundingBox();
    await pill.clock.runFor(1100);
    await send({state:'recording',generation:12,hands_free:true});
    assert.equal(await pill.locator('.capsule-time').innerText(),'0:01','Latching does not restart the duration');
    await pill.evaluate(()=>{
      for(let i=0;i<19;i++) window.__QA__.emit('capsule-amplitude',.03);
      window.__QA__.emit('recording-quiet',{generation:11,quiet_seconds:25});
    });
    assert.equal(await pill.locator('.capsule-quiet').count(),0);
    await pill.evaluate(()=>window.__QA__.emit('recording-quiet',{generation:12,quiet_seconds:24}));
    await pill.getByText('Still talking?',{exact:true}).waitFor();
    await pill.clock.runFor(200);
    await pill.screenshot({path:`artifacts/dictation-pill/quiet-${theme}-${reducedMotion}.png`});
    await pill.evaluate(()=>window.__QA__.emit('recording-quiet',{generation:12,quiet_seconds:0}));
    await pill.getByRole('button',{name:'Finish dictation'}).click();
    assert.equal(await pill.evaluate(()=>window.__QA__.emittedEvents.filter(e=>e.event==='capsule-stop').length),1);
    for(const state of ['transcribing','correcting','pasting','done']) {
      await send({state,text:'Private transcript must not render.'});
      await pill.evaluate(()=>window.__QA__.emit('capsule-partial-text','Private partial text must not render.'));
      await pill.clock.runFor(200);
      assert.equal(await pill.getByText(/Private/).count(),0);
      const bounds=await pill.locator('.capsule-pill').boundingBox();
      assert.equal(bounds.width,geometry.width,'Normal states retain pill width');
      assert.equal(bounds.height,geometry.height,'Normal states retain pill height');
      assert.ok(bounds.y>=0 && bounds.y+bounds.height<=52,'Pill fits the native panel');
      await pill.screenshot({path:`artifacts/dictation-pill/${state}-${theme}-${reducedMotion}.png`});
    }
    await pill.clock.runFor(1200);
    assert.equal(await pill.locator('.capsule-pill').count(),0,'Success fades away');
    await send({state:'recording',generation:13}); await pill.clock.runFor(200);
    await send({state:'idle'}); await pill.clock.runFor(80);
    await send({state:'recording',generation:14}); await pill.clock.runFor(300);
    assert.equal(await pill.locator('.capsule-recording').count(),1,'An old fade cannot hide a new recording');
    await send({state:'error',error:'Microphone disconnected. Choose another input.'});
    await pill.locator('.capsule-pill').evaluate(el=>Promise.allSettled(el.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished)));
    assert.deepEqual((await new AxeBuilder({page:pill}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(`Dictation checks passed in ${engine.name()}: configured triggers, slow-start latching, silence recovery, stale events, one paste, favicon, no transcript, fixed geometry, dismissal and accessibility.`);
} finally { await browser?.close(); server.kill(); }
