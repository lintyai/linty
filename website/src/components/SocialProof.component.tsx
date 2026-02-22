export default function SocialProof() {
  const stats = [
    { number: '10,000+', label: 'Active users' },
    { number: '50M+', label: 'Words transcribed' },
    { number: '100+', label: 'Languages supported' },
    { number: '99.2%', label: 'Accuracy rate' },
  ];

  return (
    <section className="vi-social-proof">
      <div className="vi-container">
        <div className="vi-social-proof__inner">
          {stats.map((stat, i) => (
            <div key={i}>
              {i > 0 && <span className="vi-social-proof__divider" />}
              <div className="vi-social-proof__stat" style={{ display: 'inline-block' }}>
                <div className="vi-social-proof__number">{stat.number}</div>
                <div className="vi-social-proof__label">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
