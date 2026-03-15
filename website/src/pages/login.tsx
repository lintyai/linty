import Layout from '@theme/Layout';

function GoogleIcon() {
  return (
    <svg className="vi-auth__social-icon" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="vi-auth__social-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="vi-auth__social-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

export default function Login() {
  return (
    <Layout title="Log in to VoiceInk" description="Log in to your VoiceInk account">
      <div className="vi-auth">
        <div className="vi-auth__card">
          <div className="vi-auth__logo">
            <span style={{
              width: 8,
              height: 8,
              background: 'var(--vi-accent)',
              borderRadius: '50%',
              display: 'inline-block',
            }} />
            VoiceInk
          </div>
          <h1 className="vi-auth__title">Welcome back</h1>
          <p className="vi-auth__subtitle">Log in to access your VoiceInk account</p>

          <div className="vi-auth__social">
            <button className="vi-auth__social-btn" type="button">
              <GoogleIcon />
              Continue with Google
            </button>
            <button className="vi-auth__social-btn" type="button">
              <AppleIcon />
              Continue with Apple
            </button>
            <button className="vi-auth__social-btn" type="button">
              <GitHubIcon />
              Continue with GitHub
            </button>
          </div>

          <div className="vi-auth__divider">
            <div className="vi-auth__divider-line" />
            <span className="vi-auth__divider-text">or</span>
            <div className="vi-auth__divider-line" />
          </div>

          <form className="vi-auth__form" onSubmit={(e) => e.preventDefault()}>
            <div className="vi-auth__field">
              <label className="vi-auth__label" htmlFor="email">Email</label>
              <input
                className="vi-auth__input"
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <div className="vi-auth__field">
              <label className="vi-auth__label" htmlFor="password">Password</label>
              <input
                className="vi-auth__input"
                id="password"
                type="password"
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginTop: '-0.25rem',
            }}>
              <a
                href="/forgot-password"
                style={{
                  fontFamily: 'var(--vi-font-body)',
                  fontSize: '0.8rem',
                  color: 'var(--vi-accent)',
                  textDecoration: 'none',
                }}
              >
                Forgot password?
              </a>
            </div>

            <button type="submit" className="vi-btn-primary vi-auth__submit" style={{ width: '100%', justifyContent: 'center' }}>
              Log in
            </button>
          </form>

          <div className="vi-auth__footer">
            Don't have an account?{' '}
            <a href="/signup">Sign up free</a>
          </div>
        </div>
      </div>
    </Layout>
  );
}
