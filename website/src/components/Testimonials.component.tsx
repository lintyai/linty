import { useEffect, useRef } from 'react';

const testimonials = [
  {
    stars: 5,
    text: "VoiceInk completely changed how I write emails. I used to spend 30 minutes crafting messages — now I just speak naturally and it nails the tone every time. My productivity has tripled.",
    name: 'Sarah K.',
    role: 'Product Manager at Stripe',
    initials: 'SK',
  },
  {
    stars: 5,
    text: "As a developer, I was skeptical about voice-to-text for coding. But the push-to-talk approach is genius — I use it for commit messages, PR descriptions, Slack messages, and documentation. Absolute game-changer.",
    name: 'Marcus R.',
    role: 'Senior Engineer at Vercel',
    initials: 'MR',
  },
  {
    stars: 5,
    text: "I switch between English, Hindi, and Spanish all day. VoiceInk handles all three flawlessly with auto-detection. The translation feature is incredible — I speak Hindi and get perfect English text.",
    name: 'Priya M.',
    role: 'Freelance Translator',
    initials: 'PM',
  },
  {
    stars: 5,
    text: "The local transcription mode sold me. As a healthcare professional, I need HIPAA-level privacy. Zero data leaves my Mac. The accuracy with medical terminology is surprisingly good too.",
    name: 'Dr. James L.',
    role: 'Physician',
    initials: 'JL',
  },
  {
    stars: 5,
    text: "I have RSI and typing is painful. VoiceInk gave me my productivity back. The Fn key push-to-talk is so natural — I barely think about it now. It just works everywhere on my Mac.",
    name: 'Alex T.',
    role: 'UX Designer',
    initials: 'AT',
  },
  {
    stars: 5,
    text: "Tried Superwhisper and Wispr Flow before this. VoiceInk wins on speed and accuracy. The AI correction feature polishes my rough speech into professional text. Worth every penny.",
    name: 'David C.',
    role: 'Content Creator',
    initials: 'DC',
  },
];

export default function Testimonials() {
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
    <section className="vi-testimonials vi-section" ref={ref}>
      <div className="vi-container">
        <div className="vi-reveal" style={{ textAlign: 'center' }}>
          <div className="vi-section-label" style={{ textAlign: 'center' }}>Testimonials</div>
          <h2 className="vi-section-title" style={{ textAlign: 'center', margin: '0 auto 1rem' }}>
            Loved by people who<br />
            value their time.
          </h2>
        </div>

        <div className="vi-testimonials__grid">
          {testimonials.slice(0, 3).map((t, i) => (
            <div
              key={i}
              className={`vi-testimonial-card vi-reveal vi-reveal--delay-${i + 1}`}
            >
              <div className="vi-testimonial-card__stars">
                {'★'.repeat(t.stars)}
              </div>
              <div className="vi-testimonial-card__text">
                "{t.text}"
              </div>
              <div className="vi-testimonial-card__author">
                <div className="vi-testimonial-card__avatar">{t.initials}</div>
                <div>
                  <div className="vi-testimonial-card__name">{t.name}</div>
                  <div className="vi-testimonial-card__role">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="vi-testimonials__grid" style={{ marginTop: '1.5rem' }}>
          {testimonials.slice(3).map((t, i) => (
            <div
              key={i}
              className={`vi-testimonial-card vi-reveal vi-reveal--delay-${i + 4}`}
            >
              <div className="vi-testimonial-card__stars">
                {'★'.repeat(t.stars)}
              </div>
              <div className="vi-testimonial-card__text">
                "{t.text}"
              </div>
              <div className="vi-testimonial-card__author">
                <div className="vi-testimonial-card__avatar">{t.initials}</div>
                <div>
                  <div className="vi-testimonial-card__name">{t.name}</div>
                  <div className="vi-testimonial-card__role">{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
