'use client';

/**
 * Small presentational primitives shared across the onboarding view.
 * Pure styling — they reuse the workspace tokens so the functional flow
 * looks native next to dashboard-view / wizard-view.
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  amber,
  bone,
  bone2,
  bone3,
  fMono,
  fSans,
  ink2,
  ink3,
  rule,
  ruleStrong,
  rust,
  sage,
} from './tokens';
import { MonoLabel } from './atoms';

/** Bordered ink panel — the standard card surface in the workspace. */
export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: ink2,
        border: `1px solid ${rule}`,
        borderRadius: 4,
        padding: 24,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 6 }}>
      <MonoLabel size={9.5} color={bone3} tracking="0.18em">
        {children}
      </MonoLabel>
    </label>
  );
}

interface TextFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}

export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
}: TextFieldProps) {
  return (
    <input
      type={type}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '10px 12px',
        background: ink3,
        border: `1px solid ${ruleStrong}`,
        borderRadius: 3,
        color: bone,
        fontFamily: fSans,
        fontSize: 13.5,
        outline: 'none',
        opacity: disabled ? 0.5 : 1,
      }}
    />
  );
}

export function TextArea({ value, onChange, placeholder, disabled }: TextFieldProps) {
  return (
    <textarea
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
      style={{
        width: '100%',
        padding: '10px 12px',
        background: ink3,
        border: `1px solid ${ruleStrong}`,
        borderRadius: 3,
        color: bone,
        fontFamily: fSans,
        fontSize: 13.5,
        outline: 'none',
        resize: 'vertical',
        opacity: disabled ? 0.5 : 1,
      }}
    />
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
  style?: CSSProperties;
}

export function Button({ children, onClick, disabled, variant = 'primary', style }: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 18px',
        background: primary ? 'rgba(225,162,58,0.14)' : 'transparent',
        border: `1px solid ${primary ? amber : ruleStrong}`,
        borderRadius: 3,
        color: primary ? amber : bone2,
        fontFamily: fMono,
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Inline status line — error (rust), success (sage), or neutral. */
export function StatusLine({
  tone,
  children,
}: {
  tone: 'error' | 'ok' | 'muted';
  children: ReactNode;
}) {
  const color = tone === 'error' ? rust : tone === 'ok' ? sage : bone3;
  return (
    <div
      style={{
        marginTop: 12,
        fontFamily: fMono,
        fontSize: 11,
        letterSpacing: '0.04em',
        color,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span
        style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }}
      />
      <span>{children}</span>
    </div>
  );
}

export function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <MonoLabel size={10} color={amber}>
        {kicker}
      </MonoLabel>
      <div
        style={{
          marginTop: 6,
          fontFamily: fSans,
          fontSize: 17,
          fontWeight: 600,
          color: bone,
        }}
      >
        {title}
      </div>
    </div>
  );
}
