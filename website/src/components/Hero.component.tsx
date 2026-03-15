import { useState, useEffect, useRef } from 'react';

const TRANSCRIPTION_PHRASES = [
  { text: 'The quarterly report shows a 23% increase in user engagement across all platforms...', lang: 'English' },
  { text: 'Envía el documento al equipo de diseño antes del viernes por favor...', lang: 'Español' },
  { text: '明日の会議のアジェンダを確認してください。重要な項目があります...', lang: '日本語' },
  { text: 'Bitte senden Sie mir die aktualisierte Version des Vertrags bis Freitag...', lang: 'Deutsch' },
  { text: 'कृपया इस प्रोजेक्ट की रिपोर्ट को आज शाम तक पूरा कर दीजिए...', lang: 'हिन्दी' },
];

const WAVEFORM_BARS = 32;

function WaveformAnimation({ isActive }: { isActive: boolean }) {
  return (
    <div className="vi-hero__waveform">
      {Array.from({ length: WAVEFORM_BARS }).map((_, i) => {
        const delay = (i * 0.06) % 1.2;
        const height = isActive
          ? `${Math.random() * 70 + 30}%`
          : '15%';
        return (
          <div
            key={i}
            className="vi-hero__waveform-bar"
            style={{
              height: isActive ? undefined : height,
              animationDelay: `${delay}s`,
              animationPlayState: isActive ? 'running' : 'paused',
              opacity: isActive ? 0.5 + Math.random() * 0.5 : 0.2,
            }}
          />
        );
      })}
    </div>
  );
}

export default function Hero() {
  const [currentPhraseIndex, setCurrentPhraseIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [charIndex, setCharIndex] = useState(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentPhrase = TRANSCRIPTION_PHRASES[currentPhraseIndex];

  useEffect(() => {
    if (charIndex < currentPhrase.text.length) {
      const speed = 25 + Math.random() * 35;
      timeoutRef.current = setTimeout(() => {
        setDisplayedText(currentPhrase.text.slice(0, charIndex + 1));
        setCharIndex((prev) => prev + 1);
      }, speed);
    } else {
      setIsTyping(false);
      timeoutRef.current = setTimeout(() => {
        setCurrentPhraseIndex((prev) => (prev + 1) % TRANSCRIPTION_PHRASES.length);
        setDisplayedText('');
        setCharIndex(0);
        setIsTyping(true);
      }, 2500);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [charIndex, currentPhrase.text, currentPhraseIndex]);

  return (
    <section className="vi-hero">
      <div className="vi-hero__content">
        <div className="vi-hero__badge">
          <span className="vi-hero__badge-dot" />
          Now available for macOS
        </div>

        <h1 className="vi-hero__title">
          Your voice,{' '}
          <span className="vi-hero__title-accent">instantly inked.</span>
        </h1>

        <p className="vi-hero__subtitle">
          Real-time voice-to-text that lives in your menu bar.
          Speak in any language, get perfect text — pasted right where you need it.
        </p>

        <div className="vi-hero__actions">
          <a href="/signup" className="vi-btn-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download for macOS
          </a>
          <a href="#features" className="vi-btn-secondary">
            See how it works
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </a>
        </div>

        <div className="vi-hero__preview">
          <div className="vi-hero__preview-window">
            <div className="vi-hero__preview-header">
              <div className="vi-hero__preview-dots">
                <div className="vi-hero__preview-dot" />
                <div className="vi-hero__preview-dot" />
                <div className="vi-hero__preview-dot" />
              </div>
              <div className="vi-hero__preview-title">
                VoiceInk — {currentPhrase.lang}
              </div>
              <div style={{ width: 42 }} />
            </div>

            <WaveformAnimation isActive={isTyping} />

            <div className="vi-hero__transcript">
              {displayedText}
              <span className="vi-hero__cursor" />
            </div>

            <div className="vi-hero__preview-footer">
              <div className="vi-hero__rec-indicator">
                <span className="vi-hero__rec-dot" />
                {isTyping ? 'Transcribing...' : 'Done'}
              </div>
              <div className="vi-hero__speed">
                {isTyping ? '~300 WPM' : `${currentPhrase.text.split(/\s+/).length} words`}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
