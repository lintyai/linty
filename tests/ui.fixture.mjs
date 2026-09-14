// Synthetic data and an in-memory Tauri bridge for interface tests only.
export const fixture = ({ empty = false, onboarding = false, theme = 'light' } = {}) => {
  const now = Date.now();
  const words = ['Let’s keep the first version focused. A clear experience matters more than another setting.', 'Thanks for the thoughtful feedback. I’ll send the updated proposal tomorrow morning.', 'A reminder for next week: review the notes and share the next steps with the team.', 'The best tools make room for your ideas.'];
  const transcripts = empty ? [] : Array.from({ length: 18 }, (_, i) => ({ transcriptId: `qa-${i}`, finalText: words[i % 4], rawText: words[i % 4].toLowerCase(), corrected: i % 2 === 0, timestamp: now - i * 4 * 3600000, wordCount: 22 + i * 8, durationSeconds: 12 + i * 3, processingTimeMs: 1200, sttTimeMs: 900, correctionTimeMs: 200, engine: i % 4 ? 'local' : 'cloud', modelName: 'Large Turbo Q5', application: { name: ['Notes', 'Mail', 'Safari'][i % 3], bundleId: ['com.apple.Notes', 'com.apple.mail', 'com.apple.Safari'][i % 3] } }));
  // One correction already made in History, and a dictionary with one word each engine keeps missing.
  const corrections = empty ? [] : [{ correctionId: 'corr-1', transcriptId: 'qa-2', timestamp: now - 3600000, source: 'edit', engine: 'local', modelName: 'Large Turbo Q5', language: 'auto', application: { name: 'Safari', bundleId: 'com.apple.Safari' }, wordCount: 17, changedRatio: 0.06, rewrite: false, pairs: [{ kind: 'substitution', from: 'stems', to: 'steps' }] }];
  const dictionary = empty ? { entries: [], suggestions: [] } : {
    entries: [{ entryId: 'dict-1', right: 'Linty', wrong: ['Linti', 'Lindy'], enabled: true, origin: 'manual', timesApplied: 12, createdAt: now - 7 * 86400000, lastAppliedAt: now - 3600000 }],
    suggestions: [{ suggestionId: 'sugg-1', right: 'Tauri', wrong: 'Tory', seenCount: 2, firstSeenAt: now - 2 * 86400000, lastSeenAt: now - 3600000, correctionIds: ['corr-0', 'corr-1'] }],
  };
  const stores = { 1: { theme, onboardingComplete: !onboarding, sttMode: 'local', selectedModelFilename: 'ggml-large-v3-turbo-q5_0.bin', groqApiKey: '', triggerKey: 'fn', correctionEnabled: false }, 2: { transcripts }, 3: { corrections }, 4: dictionary };
  const callbacks = new Map(); const listeners = new Map(); let id = 0;
  window.__QA__ = { stores, calls: [], clipboard: '', failures: {}, emit: (event, payload) => { for (const [key, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id: key, payload }); } };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (event, id) => listeners.delete(id) };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (callback) => { const key = ++id; callbacks.set(key, callback); return key; },
    unregisterCallback: (key) => callbacks.delete(key),
    invoke: async (command, args = {}) => {
      window.__QA__.calls.push(command);
      if (window.__QA__.failures[command]) throw new Error(window.__QA__.failures[command]);
      if (command === 'plugin:store|load' || command === 'plugin:store|get_store') return args.path.includes('history') ? 2 : args.path.includes('corrections') ? 3 : args.path.includes('dictionary') ? 4 : 1;
      if (command === 'plugin:store|get') return [stores[args.rid][args.key], args.key in stores[args.rid]];
      if (command === 'plugin:store|set') { stores[args.rid][args.key] = args.value; return; }
      if (command === 'plugin:event|listen') { const key = ++id; listeners.set(key, args); return key; }
      if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
      if (command === 'plugin:app|version') return '0.0.25';
      if (command === 'plugin:clipboard-manager|write_text') { window.__QA__.clipboard = args.text; return; }
      if (command === 'plugin:updater|check') return null;
      if (command === 'check_microphone') return 'authorized';
      if (['check_accessibility', 'request_microphone', 'request_accessibility', 'is_local_stt_available'].includes(command)) return true;
      if (command === 'check_fn_key_conflict') return { conflict: false, usage_type: 0 };
      if (command === 'get_app_icons') return Object.fromEntries(args.bundleIds.map(id => [id, id === 'com.apple.Safari' ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mOwbvpGEmIY1TCqYfhqAACHB7MQtp/9lwAAAABJRU5ErkJggg==' : null]));
      if (command === 'prepare_parakeet_vocabulary') return false;
      if (command === 'check_model_exists') return args.filename === 'ggml-large-v3-turbo-q5_0.bin';
      if (command === 'get_available_models') return [
        { filename: 'parakeet-tdt-0.6b-v3', name: 'Parakeet TDT v3 (~500 MB) ★ Recommended', description: 'Neural Engine · sub-second', size_mb: 500, backend: 'parakeet' },
        { filename: 'ggml-large-v3-turbo-q5_0.bin', name: 'Whisper Large Turbo Q5 (574 MB)', description: '99 languages · vocabulary prompt', size_mb: 574, backend: 'whisper' },
      ];
      return null;
    },
  };
};
