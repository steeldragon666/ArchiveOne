import type { ReactNode } from 'react';
import { bone, bone3, bone4, fMono, fSans, ink3, rule, rust } from '../tokens';
import { MonoLabel } from '../atoms';

/** Shared card chrome for a prepared-content item. */
export function ContentCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '13px 15px',
        background: ink3,
        border: `1px solid ${rule}`,
        borderRadius: 4,
      }}
    >
      {children}
    </div>
  );
}

export function KeyVal({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <MonoLabel size={8.5} color={bone4}>
        {label}
      </MonoLabel>
      <div
        style={{
          marginTop: 2,
          fontFamily: fSans,
          fontSize: 12.5,
          lineHeight: 1.5,
          color: bone3,
          whiteSpace: 'pre-wrap',
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <MonoLabel size={8.5} color={bone4}>
        {label}
      </MonoLabel>
      <div
        style={{
          marginTop: 3,
          fontFamily: fMono,
          fontSize: 15,
          color: accent ?? bone,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: fSans, fontSize: 12, color: rust }}>{children}</span>;
}

export function CenteredNote({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <div
      style={{
        padding: '40px 22px',
        textAlign: 'center',
        fontFamily: fSans,
        fontSize: 13.5,
        color: tone === 'error' ? rust : bone3,
      }}
    >
      {children}
    </div>
  );
}
