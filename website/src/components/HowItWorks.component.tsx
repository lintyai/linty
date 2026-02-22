import { useEffect, useRef } from 'react';

const steps = [
  {
    number: '1',
    title: 'Press & Hold',
    desc: 'Hold the Fn key (or your custom hotkey) anywhere on your Mac. VoiceInk activates instantly from the menu bar.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <rect x="6" y="8" width="4" height="4" rx="1" />
      </svg>
    ),
  },
  {
    number: '2',
    title: 'Speak Naturally',
    desc: 'Talk at your natural pace in any of 100+ languages. No need to speak slowly or enunciate — VoiceInk understands you.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </svg>
    ),
  },
  {
    number: '3',
    title: 'Text Appears',
    desc: 'Release the key and your polished text is instantly pasted into whatever app you\'re using. Email, Slack, code editor — anywhere.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
  },
];

export default function HowItWorks() {
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

  return (
    <section className="vi-how-it-works vi-section" ref={ref}>
      <div className="vi-container">
        <div className="vi-reveal" style={{ textAlign: 'center' }}>
          <div className="vi-section-label" style={{ textAlign: 'center' }}>How It Works</div>
          <h2 className="vi-section-title" style={{ textAlign: 'center', margin: '0 auto 1rem' }}>
            Three seconds from<br />
            thought to text.
          </h2>
          <p className="vi-section-subtitle" style={{ textAlign: 'center', margin: '0 auto' }}>
            No apps to open. No windows to switch. Just hold, speak, and release.
          </p>
        </div>

        <div className="vi-steps">
          {steps.map((step, i) => (
            <div key={i} className={`vi-step vi-reveal vi-reveal--delay-${i + 2}`}>
              <div className="vi-step__number">{step.number}</div>
              <div style={{ marginBottom: '1.25rem', color: 'var(--vi-accent)', opacity: 0.6 }}>
                {step.icon}
              </div>
              <div className="vi-step__title">{step.title}</div>
              <div className="vi-step__desc">{step.desc}</div>
              {i < steps.length - 1 && <div className="vi-step__connector" />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
