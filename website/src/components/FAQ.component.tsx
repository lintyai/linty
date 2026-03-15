import { useState, useEffect, useRef } from 'react';

const faqs = [
  {
    q: 'How does VoiceInk work?',
    a: 'VoiceInk lives in your macOS menu bar. Hold the Fn key (or your custom hotkey) to start recording, speak naturally, and release to stop. Your speech is instantly transcribed and pasted into whatever app you\'re currently using — email, Slack, code editors, anywhere.',
  },
  {
    q: 'Is my audio data private?',
    a: 'Absolutely. In local mode, your audio is processed entirely on your Mac using Apple\'s Metal GPU — nothing ever leaves your device. In cloud mode, audio is sent to Groq\'s API for processing with Whisper Large V3, then immediately discarded. We never store your audio recordings.',
  },
  {
    q: 'What languages are supported?',
    a: 'VoiceInk supports 100+ languages including English, Spanish, French, German, Japanese, Chinese, Hindi, Arabic, Portuguese, Korean, and many more. It auto-detects your language, and you can enable translate mode to automatically convert any language into English output.',
  },
  {
    q: 'Do I need an internet connection?',
    a: 'Not necessarily. VoiceInk offers local mode which runs entirely offline using whisper.cpp with Metal acceleration. Cloud mode (faster and more accurate) requires internet and uses Groq\'s API. You can switch between modes in settings.',
  },
  {
    q: 'How accurate is the transcription?',
    a: 'Very accurate. Cloud mode uses Whisper Large V3 via Groq, achieving 99%+ accuracy for most languages. The optional AI correction feature further polishes the output by fixing grammar, punctuation, and formatting using an LLM post-processor.',
  },
  {
    q: 'Can I use VoiceInk with any app?',
    a: 'Yes. VoiceInk uses system-level clipboard and paste integration, so it works with any macOS application — email clients, code editors, browsers, Slack, Notion, Google Docs, Terminal, and more. If you can paste text into it, VoiceInk works with it.',
  },
  {
    q: 'What\'s the difference between Free and Pro?',
    a: 'The Free plan gives you 500 words per day with cloud transcription in 10 languages. Pro unlocks unlimited words, local + cloud modes, 100+ languages, AI text correction, custom prompts, translation, and full history analytics. Teams adds admin features and SSO.',
  },
  {
    q: 'Is there a Windows or Linux version?',
    a: 'Currently VoiceInk is macOS-only, built natively with Tauri 2 for the best performance and system integration. We\'re evaluating Windows support based on user demand — join our waitlist to be notified.',
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
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
    <section className="vi-faq vi-section" ref={ref}>
      <div className="vi-container">
        <div className="vi-reveal" style={{ textAlign: 'center' }}>
          <div className="vi-section-label" style={{ textAlign: 'center' }}>FAQ</div>
          <h2 className="vi-section-title" style={{ textAlign: 'center', margin: '0 auto 1rem' }}>
            Questions? Answered.
          </h2>
        </div>

        <div className="vi-faq__list">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className={`vi-faq-item vi-reveal vi-reveal--delay-${Math.min(i + 1, 5)} ${
                openIndex === i ? 'vi-faq-item--open' : ''
              }`}
            >
              <button
                className="vi-faq-item__trigger"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                {faq.q}
                <span className="vi-faq-item__icon">+</span>
              </button>
              <div className="vi-faq-item__content">
                <div className="vi-faq-item__answer">{faq.a}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
