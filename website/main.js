/* Linty landing — cursor, typing, demo, reveals. No dependencies. */
(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;

  /* ---------- custom cursor: elastic tip, blinks like a caret when idle ---------- */
  if (finePointer && !reducedMotion) {
    document.documentElement.classList.add('has-cursor');
    const cursor = document.querySelector('.cursor');

    let mx = innerWidth / 2, my = innerHeight / 2;
    let x = mx, y = my;
    let idleTimer;

    addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;

      cursor.classList.remove('is-idle');
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => cursor.classList.add('is-idle'), 900);

      const el = e.target;
      cursor.classList.toggle('is-link', !!el.closest('a, button, .keycap'));
      cursor.classList.toggle('is-caret', !!el.closest('[data-caret-zone]') && !el.closest('a, button'));
    }, { passive: true });

    (function follow() {
      const dx = mx - x;
      const dy = my - y;
      x += dx * 0.18;
      y += dy * 0.18;

      // stretch the dot along its direction of travel; keep morphed shapes rigid
      const morphed =
        cursor.classList.contains('is-link') ||
        cursor.classList.contains('is-caret') ||
        cursor.classList.contains('is-idle');
      const stretch = morphed ? 0 : Math.min(Math.hypot(dx, dy) / 90, 0.5);
      const angle = stretch > 0.01 ? Math.atan2(dy, dx) : 0;
      cursor.style.transform =
        `translate(${x}px, ${y}px) rotate(${angle}rad) scale(${1 + stretch}, ${1 - stretch * 0.45}) rotate(${-angle}rad)`;
      requestAnimationFrame(follow);
    })();

    addEventListener('mousedown', (e) => {
      cursor.classList.add('is-down');
      const ripple = document.createElement('div');
      ripple.className = 'cursor-ripple';
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      document.body.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    });
    addEventListener('mouseup', () => cursor.classList.remove('is-down'));

    /* magnetic primary buttons */
    document.querySelectorAll('[data-magnetic]').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = `translate(${dx * 0.18}px, ${dy * 0.3}px)`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = '';
      });
    });
  }

  /* ---------- direct download: resolve the latest DMG url ---------- */
  const downloadLinks = document.querySelectorAll('a[href$="/releases/latest"]');
  fetch('https://api.github.com/repos/lintyai/linty/releases/latest')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((release) => {
      const dmg = release.assets.find((a) => a.name.endsWith('.dmg'));
      if (!dmg) return;
      downloadLinks.forEach((a) => {
        a.href = dmg.browser_download_url;
        a.removeAttribute('target'); // download in place instead of a new tab
      });
    })
    .catch(() => {}); // API unreachable → buttons keep linking to the releases page

  /* ---------- nav scrolled state ---------- */
  const nav = document.querySelector('.nav');
  const onScroll = () => nav.classList.toggle('is-scrolled', scrollY > 24);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- typewriter ---------- */
  const typeInto = (el, text, speed = 65) =>
    new Promise((resolve) => {
      if (reducedMotion) {
        el.textContent = text;
        return resolve();
      }
      el.textContent = '';
      let i = 0;
      (function tick() {
        el.textContent = text.slice(0, ++i);
        if (i < text.length) setTimeout(tick, speed + Math.random() * 45);
        else resolve();
      })();
    });

  const typedLine = document.getElementById('typed-line');
  if (!reducedMotion) typedLine.textContent = '';
  setTimeout(() => typeInto(typedLine, typedLine.dataset.typed, 90), reducedMotion ? 0 : 600);

  /* ---------- hold-fn demo: real speech recognition when the browser has it ---------- */
  const key = document.getElementById('demo-key');
  const field = document.getElementById('demo-field');
  const text = document.getElementById('demo-text');
  const FALLBACK_SENTENCE = 'This sentence was spoken, not typed.';
  const HINT = '<span class="demo-placeholder" id="demo-hint">Hold the key — or your space bar — and speak</span>';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let srUnavailable = !SR || !isSecureContext;
  let recognition = null;
  let heard = '';
  let holdStart = 0;
  let typing = false;

  const setPlaceholder = (msg) => {
    text.innerHTML = `<span class="demo-placeholder">${msg}</span>`;
  };

  const showResult = async (sentence) => {
    typing = true;
    const span = document.createElement('span');
    const caret = document.createElement('span');
    caret.className = 'caret';
    text.replaceChildren(span, caret);
    await typeInto(span, sentence, 24);
    typing = false;
    setTimeout(() => {
      if (!typing && !key.classList.contains('is-held')) text.innerHTML = HINT;
    }, 8000);
  };

  const startHold = () => {
    if (typing) return;
    holdStart = Date.now();
    heard = '';
    key.classList.add('is-held');
    key.setAttribute('aria-pressed', 'true');
    field.classList.add('is-recording');
    text.innerHTML = HINT;

    if (srUnavailable) return;
    try {
      recognition = new SR();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (e) => {
        heard = Array.from(e.results)
          .map((r) => r[0].transcript)
          .join(' ')
          .trim();
      };
      recognition.onerror = (e) => {
        // mic blocked or engine unreachable → simulate from now on
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') {
          srUnavailable = true;
        }
      };
      recognition.start();
    } catch {
      srUnavailable = true;
    }
  };

  const endHold = () => {
    if (!key.classList.contains('is-held')) return;
    key.classList.remove('is-held');
    key.setAttribute('aria-pressed', 'false');
    field.classList.remove('is-recording');

    const wasTap = Date.now() - holdStart < 350;

    if (!recognition) {
      if (wasTap) return setPlaceholder('Press and hold to speak');
      return showResult(FALLBACK_SENTENCE);
    }

    // final results can land between stop() and onend — settle once they have
    const r = recognition;
    recognition = null;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (heard) return showResult(heard);
      if (wasTap) return setPlaceholder('Press and hold to speak');
      if (srUnavailable) return showResult(FALLBACK_SENTENCE);
      setPlaceholder("Didn't catch that — hold and try again");
    };
    r.onend = settle;
    try {
      r.stop();
    } catch {
      settle();
    }
    setTimeout(settle, 1500);
  };

  key.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    key.setPointerCapture(e.pointerId);
    startHold();
  });
  key.addEventListener('pointerup', endHold);
  key.addEventListener('pointercancel', endHold);
  key.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      startHold();
    }
  });
  key.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') endHold();
  });

  /* physical keys anywhere on the page: fn where the browser reports it
     (macOS consumes bare fn, so it rarely does), Space as the stand-in */
  const demoEl = document.querySelector('.demo');
  addEventListener('keydown', (e) => {
    const isFn = e.key === 'Fn';
    const isSpace = e.key === ' ' && !e.target.closest('a, button, input, textarea');
    if (!isFn && !isSpace) return;
    e.preventDefault();
    if (e.repeat || typing || key.classList.contains('is-held')) return;
    demoEl.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    startHold();
  });
  addEventListener('keyup', (e) => {
    if (e.key === 'Fn' || e.key === ' ') endHold();
  });

  /* ---------- scroll reveals ---------- */
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
  );
  document.querySelectorAll('[data-reveal], .privacy-statement').forEach((el) => io.observe(el));

  /* ---------- stat counters ---------- */
  const counterIo = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        counterIo.unobserve(entry.target);
        const el = entry.target;
        const target = +el.dataset.count;
        if (reducedMotion) {
          el.textContent = target;
          continue;
        }
        const t0 = performance.now();
        const duration = 1400;
        (function step(t) {
          const p = Math.min((t - t0) / duration, 1);
          el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(step);
        })(t0);
      }
    },
    { threshold: 0.6 }
  );
  document.querySelectorAll('[data-count]').forEach((el) => counterIo.observe(el));

  /* ---------- bento spotlight ---------- */
  if (finePointer) {
    document.querySelectorAll('.card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
  }
})();
