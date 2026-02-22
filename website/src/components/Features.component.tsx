import { useEffect, useRef } from 'react';

const features = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    title: 'Blazing Fast',
    desc: 'Real-time transcription at 300+ words per minute. Your text appears instantly as you speak — no waiting, no lag.',
    stat: '<0.5s',
    statLabel: 'latency',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    title: 'Pinpoint Accurate',
    desc: 'Powered by Whisper Large V3 with AI post-processing. Handles accents, technical jargon, and mixed languages flawlessly.',
    stat: '99.2%',
    statLabel: 'accuracy',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    title: 'Any Language',
    desc: 'Speak in 100+ languages with automatic detection. Translate on-the-fly to English. Multilingual workflows, simplified.',
    stat: '100+',
    statLabel: 'languages',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: 'Privacy First',
    desc: 'Local-first with on-device processing via Apple Metal GPU. Your audio never leaves your Mac when using local mode.',
    stat: '0',
    statLabel: 'data sent',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
    title: 'Push-to-Talk',
    desc: 'Hold Fn key to record, release to transcribe. Text auto-pastes into your focused app. Zero friction, zero context switching.',
    stat: 'Fn',
    statLabel: 'key trigger',
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    title: 'AI Correction',
    desc: 'Built-in LLM post-processing cleans up grammar, punctuation, and formatting. Get polished text from natural speech.',
    stat: 'LLM',
    statLabel: 'powered',
  },
];

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('vi-reveal--visible');
          }
        });
      },
      { threshold: 0.1 }
    );

    const children = el.querySelectorAll('.vi-reveal');
    children.forEach((child) => observer.observe(child));

    return () => observer.disconnect();
  }, []);

  return ref;
}

export default function Features() {
  const containerRef = useReveal();

  return (
    <section className="vi-features vi-section" id="features" ref={containerRef}>
      <div className="vi-container">
        <div className="vi-reveal">
          <div className="vi-section-label">Features</div>
          <h2 className="vi-section-title">
            Everything you need to<br />
            speak instead of type.
          </h2>
          <p className="vi-section-subtitle">
            VoiceInk sits quietly in your menu bar until you need it.
            One key press transforms your voice into perfectly formatted text.
          </p>
        </div>

        <div className="vi-features__grid">
          {features.map((feature, i) => (
            <div
              key={i}
              className={`vi-feature-card vi-reveal vi-reveal--delay-${i + 1}`}
            >
              <div className="vi-feature-card__icon">{feature.icon}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span className="vi-feature-card__stat vi-feature-card__stat-accent" style={{ fontSize: '1.5rem' }}>
                  {feature.stat}
                </span>
                <span style={{ fontFamily: 'var(--vi-font-mono)', fontSize: '0.7rem', color: 'var(--vi-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {feature.statLabel}
                </span>
              </div>
              <div className="vi-feature-card__title">{feature.title}</div>
              <div className="vi-feature-card__desc">{feature.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
