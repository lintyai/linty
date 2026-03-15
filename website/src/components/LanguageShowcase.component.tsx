import { useEffect, useRef } from 'react';

const languages = [
  { flag: '🇺🇸', name: 'English' },
  { flag: '🇪🇸', name: 'Español' },
  { flag: '🇫🇷', name: 'Français' },
  { flag: '🇩🇪', name: 'Deutsch' },
  { flag: '🇯🇵', name: '日本語' },
  { flag: '🇨🇳', name: '中文' },
  { flag: '🇰🇷', name: '한국어' },
  { flag: '🇮🇳', name: 'हिन्दी' },
  { flag: '🇵🇹', name: 'Português' },
  { flag: '🇮🇹', name: 'Italiano' },
  { flag: '🇷🇺', name: 'Русский' },
  { flag: '🇸🇦', name: 'العربية' },
  { flag: '🇹🇷', name: 'Türkçe' },
  { flag: '🇻🇳', name: 'Tiếng Việt' },
  { flag: '🇹🇭', name: 'ไทย' },
  { flag: '🇳🇱', name: 'Nederlands' },
  { flag: '🇵🇱', name: 'Polski' },
  { flag: '🇸🇪', name: 'Svenska' },
  { flag: '🇩🇰', name: 'Dansk' },
  { flag: '🇳🇴', name: 'Norsk' },
  { flag: '🇫🇮', name: 'Suomi' },
  { flag: '🇬🇷', name: 'Ελληνικά' },
  { flag: '🇮🇱', name: 'עברית' },
  { flag: '🇮🇩', name: 'Bahasa Indonesia' },
];

export default function LanguageShowcase() {
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
    <section className="vi-languages vi-section" ref={ref}>
      <div className="vi-container">
        <div className="vi-reveal" style={{ textAlign: 'center' }}>
          <div className="vi-section-label" style={{ textAlign: 'center' }}>Multilingual</div>
          <h2 className="vi-section-title" style={{ textAlign: 'center', margin: '0 auto 1rem' }}>
            Speak your language.<br />
            All of them.
          </h2>
          <p className="vi-section-subtitle" style={{ textAlign: 'center', margin: '0 auto' }}>
            VoiceInk auto-detects your language and transcribes flawlessly.
            Need English output? Toggle translate mode and speak in any language.
          </p>
        </div>

        <div className="vi-languages__grid vi-reveal vi-reveal--delay-2">
          {languages.map((lang, i) => (
            <div
              key={i}
              className="vi-language-pill"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <span className="vi-language-pill__flag">{lang.flag}</span>
              {lang.name}
            </div>
          ))}
          <div
            className="vi-language-pill"
            style={{ borderColor: 'rgba(226, 53, 53, 0.2)', color: 'var(--vi-accent)' }}
          >
            +76 more
          </div>
        </div>
      </div>
    </section>
  );
}
