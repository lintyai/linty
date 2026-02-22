import { useEffect, useRef } from 'react';

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: '/forever',
    desc: 'Perfect for trying out voice-to-text. No credit card required.',
    features: [
      '500 words per day',
      'Cloud transcription (Groq)',
      '10 languages',
      'Push-to-talk with Fn key',
      'Auto-paste into any app',
      'Basic transcript history',
    ],
    cta: 'Get Started Free',
    ctaStyle: 'secondary',
    featured: false,
  },
  {
    name: 'Pro',
    price: '$9.99',
    period: '/month',
    desc: 'Unlimited transcription for power users and professionals.',
    features: [
      'Unlimited words',
      'Cloud + Local transcription',
      '100+ languages',
      'AI text correction & polish',
      'Custom whisper prompts',
      'Translate any language to English',
      'Priority cloud processing',
      'Full transcript history & analytics',
    ],
    cta: 'Start Pro Trial',
    ctaStyle: 'primary',
    featured: true,
    badge: 'Most Popular',
  },
  {
    name: 'Teams',
    price: '$19.99',
    period: '/user/mo',
    desc: 'For organizations that want voice-powered productivity at scale.',
    features: [
      'Everything in Pro',
      'Team admin dashboard',
      'Shared custom dictionaries',
      'Usage analytics per member',
      'Priority support',
      'SSO / SAML integration',
      'Volume discounts available',
    ],
    cta: 'Contact Sales',
    ctaStyle: 'secondary',
    featured: false,
  },
];

export default function Pricing() {
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
    <section className="vi-pricing vi-section" id="pricing" ref={ref}>
      <div className="vi-container">
        <div className="vi-reveal" style={{ textAlign: 'center' }}>
          <div className="vi-section-label" style={{ textAlign: 'center' }}>Pricing</div>
          <h2 className="vi-section-title" style={{ textAlign: 'center', margin: '0 auto 1rem' }}>
            Simple pricing,<br />
            no surprises.
          </h2>
          <p className="vi-section-subtitle" style={{ textAlign: 'center', margin: '0 auto' }}>
            Start free, upgrade when you need more.
            All plans include core transcription features.
          </p>
        </div>

        <div className="vi-pricing__grid">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={`vi-pricing-card vi-reveal vi-reveal--delay-${i + 1} ${
                plan.featured ? 'vi-pricing-card--featured' : ''
              }`}
            >
              {plan.badge && (
                <div className="vi-pricing-card__badge">{plan.badge}</div>
              )}

              <div className="vi-pricing-card__name">{plan.name}</div>

              <div className="vi-pricing-card__price">
                <span className="vi-pricing-card__amount">{plan.price}</span>
                <span className="vi-pricing-card__period">{plan.period}</span>
              </div>

              <div className="vi-pricing-card__desc">{plan.desc}</div>

              <ul className="vi-pricing-card__features">
                {plan.features.map((feature, j) => (
                  <li key={j} className="vi-pricing-card__feature">
                    <span className="vi-pricing-card__check">
                      <CheckIcon />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href="/signup"
                className={`${
                  plan.ctaStyle === 'primary' ? 'vi-btn-primary' : 'vi-btn-secondary'
                } vi-pricing-card__btn`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
