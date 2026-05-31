import type { CSSProperties } from 'react';
import { amber, amberSoft, bone2, fMono, ink, ruleStrong } from '../tokens';

/** Australian FY label: fiscal_year 2026 → "FY26". */
export function fyLabel(fiscalYear: number): string {
  return `FY${String(fiscalYear).slice(-2)}`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export function formatAud(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function primaryBtn(disabled: boolean): CSSProperties {
  return {
    padding: '9px 16px',
    background: disabled ? amberSoft : amber,
    color: ink,
    border: 'none',
    borderRadius: 3,
    fontFamily: fMono,
    fontSize: 11,
    letterSpacing: '0.16em',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

export function ghostBtn(disabled: boolean): CSSProperties {
  return {
    padding: '9px 14px',
    background: 'transparent',
    color: bone2,
    border: `1px solid ${ruleStrong}`,
    borderRadius: 3,
    fontFamily: fMono,
    fontSize: 11,
    letterSpacing: '0.16em',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}
