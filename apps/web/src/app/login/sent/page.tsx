import Link from 'next/link';
import type { CSSProperties } from 'react';
import {
  amber,
  bone,
  bone2,
  bone3,
  fMono,
  fSans,
  fSerif,
  ink,
  ink2,
  rule,
} from '../../consultant/_components/tokens';
import { Diamond, MonoLabel } from '../../consultant/_components/atoms';

/**
 * Terminal "Check your email" page — landed on after the user submits
 * the login form. The API always returns the same generic 200 whether
 * the email is registered or not, so this page is deliberately
 * existence-agnostic: it tells the user what to look for without
 * confirming anything about their account state.
 */

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

export default function LoginSentPage() {
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
        <MonoLabel color={bone3}>Sign-in link sent</MonoLabel>
      </nav>

      <div style={mainStyle}>
        <section style={cardStyle}>
          <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Diamond size={12} color={amber} />
            <MonoLabel color={amber}>Email sent</MonoLabel>
          </div>
          <h1
            style={{
              margin: '0 0 16px',
              fontFamily: fSerif,
              fontSize: 32,
              fontWeight: 300,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}
          >
            Check your inbox.
          </h1>
          <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.7, color: bone2 }}>
            If the email you entered is tied to an ArchiveOne account, a sign-in link is on its way.
            The link is valid for 15 minutes and can only be used once.
          </p>
          <p style={{ margin: '0 0 24px', fontSize: 14, lineHeight: 1.7, color: bone2 }}>
            Didn&apos;t receive it? Check your spam folder, or{' '}
            <Link
              href="/login"
              style={{ color: amber, textDecoration: 'none', borderBottom: `1px solid ${amber}` }}
            >
              request a new link
            </Link>
            .
          </p>
          <div
            style={{
              paddingTop: 20,
              borderTop: `1px solid ${rule}`,
              fontFamily: fMono,
              fontSize: 11,
              letterSpacing: '0.06em',
              color: bone3,
            }}
          >
            <Link
              href="/"
              style={{
                color: bone3,
                textDecoration: 'none',
              }}
            >
              Back to site
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
