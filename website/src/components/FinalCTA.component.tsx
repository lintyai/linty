export default function FinalCTA() {
  return (
    <section className="vi-final-cta vi-section">
      <div className="vi-container" style={{ position: 'relative', zIndex: 1 }}>
        <h2 className="vi-final-cta__title">
          Start speaking.<br />
          Stop typing.
        </h2>
        <p className="vi-final-cta__subtitle">
          Download VoiceInk free and experience the fastest way to turn
          your thoughts into text. Your keyboard will thank you.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <a href="/signup" className="vi-btn-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download for macOS — It's Free
          </a>
          <div style={{
            fontFamily: 'var(--vi-font-mono)',
            fontSize: '0.75rem',
            color: 'var(--vi-text-muted)',
          }}>
            macOS 13+ &middot; Apple Silicon & Intel
          </div>
        </div>
      </div>
    </section>
  );
}
