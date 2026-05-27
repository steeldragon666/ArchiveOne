'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  amber,
  bone,
  bone2,
  bone3,
  bone4,
  fMono,
  fSans,
  fSerif,
  ink,
  ink2,
  ink3,
  rule,
  ruleStrong,
  rust,
} from '../consultant/_components/tokens';
import { Diamond, MonoLabel } from '../consultant/_components/atoms';

/**
 * Magic-link login form.
 *
 * UX:
 *   - Email input (autocompletes against the browser's email vault).
 *   - "Send sign-in link" submits to `POST /v1/auth/login`.
 *   - The API always responds 200 with a generic message regardless
 *     of whether the email is registered; we treat any 2xx as success
 *     and navigate to `/login/sent`.
 *   - 503 (email transport not configured) and 422 / 5xx surface as
 *     inline errors. Rate-limit / unknown-email are NEVER surfaced —
 *     the API maps both to the same 200 by design.
 *
 * Network errors and unexpected statuses fall through to a generic
 * "Could not send sign-in link" message — we never lean on the API's
 * error.message for sensitive states.
 */

interface ApiErrorBody {
  error?: string;
  message?: string;
}

const screenStyle: CSSProperties = {
  minHeight: '100vh',
  background: ink,
  color: bone,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: fSans,
};

const navStyle: CSSProperties = {
  padding: '24px 32px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: `1px solid ${rule}`,
};

const mainStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 480,
  background: ink2,
  border: `1px solid ${rule}`,
  padding: 40,
};

const inputStyle: CSSProperties = {
  width: '100%',
  background: ink3,
  border: `1px solid ${ruleStrong}`,
  color: bone,
  fontFamily: fSans,
  fontSize: 15,
  padding: '12px 14px',
  outline: 'none',
  boxSizing: 'border-box',
};

const buttonStyle = (enabled: boolean): CSSProperties => ({
  width: '100%',
  fontFamily: fMono,
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  padding: '14px 22px',
  border: `1px solid ${enabled ? amber : ruleStrong}`,
  background: enabled ? amber : ink3,
  color: enabled ? ink : bone4,
  cursor: enabled ? 'pointer' : 'not-allowed',
});

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && !submitting;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch('/v1/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: email.trim().toLowerCase() }),
        });
        if (res.ok) {
          router.push('/login/sent');
          return;
        }
        // 503 → email transport unconfigured; show a plain operator
        // message rather than parroting the API body.
        if (res.status === 503) {
          setError(
            'Sign-in by email is not available on this deployment. Contact your administrator.',
          );
          setSubmitting(false);
          return;
        }
        // Anything else: surface the API message if present (422
        // validation errors are the main case), otherwise a generic
        // failure message.
        let msg = `Could not send sign-in link (HTTP ${res.status}).`;
        try {
          const parsed = (await res.json()) as ApiErrorBody;
          if (parsed.message) msg = parsed.message;
        } catch {
          // non-JSON; keep the default
        }
        setError(msg);
        setSubmitting(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
        setSubmitting(false);
      }
    })();
  };

  return (
    <main style={screenStyle}>
      <nav style={navStyle}>
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            color: bone,
            textDecoration: 'none',
          }}
        >
          <Diamond size={10} />
          <span style={{ fontFamily: fSerif, fontSize: 18, fontWeight: 500 }}>ArchiveOne</span>
        </Link>
        <MonoLabel color={bone3}>Existing account sign-in</MonoLabel>
      </nav>

      <div style={mainStyle}>
        <section style={cardStyle}>
          <div style={{ marginBottom: 24 }}>
            <MonoLabel color={amber}>Magic-link login</MonoLabel>
            <h1
              style={{
                margin: '14px 0 12px',
                fontFamily: fSerif,
                fontSize: 32,
                fontWeight: 300,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: bone,
              }}
            >
              Sign in to your workspace.
            </h1>
            <p
              style={{
                margin: 0,
                fontFamily: fSans,
                fontSize: 14,
                lineHeight: 1.7,
                color: bone2,
              }}
            >
              Enter the email tied to your ArchiveOne account. We&apos;ll send a sign-in link valid
              for 15 minutes.
            </p>
          </div>

          <form onSubmit={onSubmit}>
            <label style={{ display: 'block', marginBottom: 20 }}>
              <span
                style={{
                  display: 'block',
                  fontFamily: fMono,
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: bone3,
                  marginBottom: 8,
                }}
              >
                Work email
              </span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                style={inputStyle}
                placeholder="you@firm.com.au"
              />
            </label>

            <button type="submit" disabled={!canSubmit} style={buttonStyle(canSubmit)}>
              {submitting ? 'Sending link…' : 'Send sign-in link'}
            </button>

            {error !== null && (
              <p
                role="alert"
                style={{
                  marginTop: 20,
                  padding: '10px 14px',
                  border: `1px solid ${rust}`,
                  background: 'rgba(196,106,72,0.12)',
                  color: rust,
                  fontFamily: fMono,
                  fontSize: 11,
                  letterSpacing: '0.06em',
                }}
              >
                {error}
              </p>
            )}
          </form>

          <div
            style={{
              marginTop: 28,
              paddingTop: 20,
              borderTop: `1px solid ${rule}`,
              fontFamily: fMono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: bone3,
            }}
          >
            Don&apos;t have an account?{' '}
            <Link
              href="/signup"
              style={{ color: amber, textDecoration: 'none', borderBottom: `1px solid ${amber}` }}
            >
              Request workspace access
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
