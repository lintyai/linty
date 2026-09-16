/* Static product page. Its walkthrough is an illustration, not a speech benchmark. */
(() => {
  const root = document.documentElement;
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const image = document.getElementById('product-image');
  const caption = document.getElementById('screen-caption');
  const screens = {
    history: { caption: 'Find, copy, and edit the words you’ve already said.', alt: 'Linty’s History screen with an example project update selected for review and editing.' },
    overview: { caption: 'An example week: 3,048 words, about 52 minutes back.', alt: 'Linty’s Overview with a plausible week of example dictations, words transcribed, and estimated time saved.' },
    engines: { caption: 'Choose the speech engine that fits your Mac.', alt: 'Linty’s Speech engine settings showing local models and controls for processing on your device.' },
  };
  let selected = 'overview';
  let explicitTheme = false;
  try { explicitTheme = ['light', 'dark'].includes(localStorage.getItem('linty-site-theme')); } catch {}
  const showScreen = (name) => {
    if (!screens[name]) return;
    selected = name;
    image.src = `images/${selected}-${root.dataset.theme}.png`;
    const imageLink = document.getElementById('product-image-link');
    imageLink.href = image.src;
    imageLink.setAttribute('aria-label', `Open the ${selected === 'engines' ? 'Speech engines' : selected} screenshot at full size`);
    image.alt = screens[selected].alt;
    caption.textContent = screens[selected].caption;
    document.getElementById('sample-label').textContent = selected === 'overview' ? 'Example data · 40 wpm typing baseline' : 'Actual interface · example data';
    document.querySelectorAll('[data-screen]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.screen === selected)));
  };
  const setTheme = (theme, remember = false) => {
    root.dataset.theme = theme;
    document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
    showScreen(selected);
    if (remember) {
      explicitTheme = true;
      try { localStorage.setItem('linty-site-theme', theme); } catch {}
    }
  };
  setTheme(root.dataset.theme || (systemTheme.matches ? 'dark' : 'light'));
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeChoice, true)));
  document.querySelectorAll('[data-screen]').forEach(button => button.addEventListener('click', () => showScreen(button.dataset.screen)));
  document.querySelectorAll('[data-open-screen]').forEach(link => link.addEventListener('click', () => showScreen(link.dataset.openScreen)));
  systemTheme.addEventListener('change', event => { if (!explicitTheme) setTheme(event.matches ? 'dark' : 'light'); });

  const play = document.getElementById('play-demo');
  const output = document.getElementById('demo-output');
  const status = document.getElementById('demo-status');
  const capsule = document.getElementById('demo-capsule');
  const label = document.getElementById('capsule-label');
  const sentence = output.parentElement.dataset.example;
  let timer;
  const finish = () => {
    clearTimeout(timer);
    output.textContent = sentence;
    capsule.classList.remove('is-recording');
    label.textContent = 'Words, right where you need them';
    status.textContent = 'Example complete · text inserted';
    play.textContent = 'Replay example ↗';
    play.disabled = false;
  };
  play.addEventListener('click', () => {
    play.disabled = true;
    play.textContent = 'Playing example…';
    output.replaceChildren();
    capsule.classList.add('is-recording');
    label.textContent = 'Listening…';
    status.textContent = '1. Hold the key · 2. Speak';
    if (reducedMotion.matches) return finish();
    timer = setTimeout(() => {
      capsule.classList.remove('is-recording');
      label.textContent = 'Transcribing…';
      status.textContent = '3. Release the key';
      timer = setTimeout(finish, 800);
    }, 1600);
  });
  reducedMotion.addEventListener('change', event => { if (event.matches && play.disabled) finish(); });

  // Download links use GitHub’s stable latest-release installer URL; no API lookup needed.
})();
