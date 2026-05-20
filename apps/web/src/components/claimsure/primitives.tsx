'use client';

import { cn } from '@/lib/utils';

// ── ConfidenceViz ─────────────────────────────────────────────────────────────
// Four swap-able visualisation styles: bar | ring | spark | badge
interface ConfidenceVizProps {
  value: number;
  style?: 'bar' | 'ring' | 'spark' | 'badge';
  compact?: boolean;
  label?: string;
  color?: string;
}

export function ConfidenceViz({
  value,
  style = 'bar',
  compact = false,
  label = 'AI confidence',
  color,
}: ConfidenceVizProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const c =
    color || (v >= 85 ? 'var(--cs-success)' : v >= 70 ? 'var(--cs-warn)' : 'var(--cs-error)');

  if (style === 'ring') {
    const r = 14,
      C = 2 * Math.PI * r;
    return (
      <div className="flex items-center gap-3" title={`${label}: ${v}%`}>
        <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90">
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            strokeWidth="3"
            stroke="rgba(255,255,255,0.08)"
          />
          <circle
            cx="18"
            cy="18"
            r={r}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            style={{
              stroke: c,
              strokeDasharray: C,
              strokeDashoffset: C - (C * v) / 100,
              transition: 'stroke-dashoffset .8s ease',
            }}
          />
        </svg>
        {!compact && (
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[13px] font-semibold" style={{ color: c }}>
              {v}%
            </span>
            <span className="text-[10px] uppercase tracking-widest text-[var(--cs-on-surface-variant)] opacity-60">
              {label}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (style === 'spark') {
    const seed = (v * 7) % 17;
    const pts = Array.from({ length: 12 }, (_, i) => {
      const x = i * 8;
      const noise = ((i * 13 + seed) % 7) - 3;
      const y = 24 - (v / 100) * 18 * (0.4 + (i / 11) * 0.6) + noise * 0.6;
      return `${x},${y.toFixed(1)}`;
    });
    return (
      <div className="flex items-center gap-3" title={`${label}: ${v}%`}>
        <svg width="90" height="28" viewBox="0 0 90 28">
          <defs>
            <linearGradient id={`spk${v}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={c} stopOpacity="0.2" />
              <stop offset="100%" stopColor={c} stopOpacity="1" />
            </linearGradient>
          </defs>
          <polyline
            fill="none"
            stroke={`url(#spk${v})`}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={pts.join(' ')}
          />
          <circle cx={11 * 8} cy={parseFloat(pts[11]?.split(',')[1] ?? '0')} r="2.4" fill={c} />
        </svg>
        {!compact && (
          <span className="font-mono text-[13px] font-semibold" style={{ color: c }}>
            {v}%
          </span>
        )}
      </div>
    );
  }

  if (style === 'badge') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold border"
        style={{
          color: c,
          borderColor: `color-mix(in oklab, ${c} 35%, transparent)`,
          background: `color-mix(in oklab, ${c} 10%, transparent)`,
        }}
        title={`${label}: ${v}%`}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}
        >
          verified
        </span>
        {v}%
      </span>
    );
  }

  // bar (default)
  return (
    <div className="flex flex-col gap-1.5" title={`${label}: ${v}%`}>
      {!compact && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] uppercase tracking-widest text-[var(--cs-on-surface-variant)] opacity-60">
            {label}
          </span>
          <span className="font-mono text-[13px] font-semibold" style={{ color: c }}>
            {v}%
          </span>
        </div>
      )}
      <div
        className="h-1.5 w-full rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.07)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${v}%`, background: c, boxShadow: `0 0 12px ${c}` }}
        />
      </div>
    </div>
  );
}

// ── Chip ─────────────────────────────────────────────────────────────────────
type ChipColor = 'default' | 'primary' | 'secondary' | 'tertiary' | 'warn' | 'success';

const CHIP_COLORS: Record<ChipColor, { bg: string; border: string; text: string }> = {
  default: {
    bg: 'rgba(255,255,255,0.05)',
    border: 'rgba(255,255,255,0.10)',
    text: 'var(--cs-on-surface)',
  },
  primary: {
    bg: 'rgba(70,72,212,0.10)',
    border: 'rgba(70,72,212,0.30)',
    text: 'var(--cs-primary-fixed-dim)',
  },
  secondary: {
    bg: 'rgba(79,219,200,0.10)',
    border: 'rgba(79,219,200,0.30)',
    text: 'var(--cs-secondary-fixed-dim)',
  },
  tertiary: {
    bg: 'rgba(255,183,131,0.10)',
    border: 'rgba(255,183,131,0.30)',
    text: 'var(--cs-tertiary-fixed-dim)',
  },
  warn: { bg: 'rgba(255,183,131,0.10)', border: 'rgba(255,183,131,0.30)', text: 'var(--cs-warn)' },
  success: {
    bg: 'rgba(79,219,200,0.10)',
    border: 'rgba(79,219,200,0.30)',
    text: 'var(--cs-success)',
  },
};

interface CsChipProps {
  icon?: string;
  children: React.ReactNode;
  color?: ChipColor;
  onClick?: () => void;
  active?: boolean;
}

export function CsChip({ icon, children, color = 'default', onClick, active }: CsChipProps) {
  const s = CHIP_COLORS[color];
  return (
    <span
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider border transition-all',
        onClick && 'cursor-pointer hover:scale-[1.03]',
        active && 'ring-1 ring-current',
      )}
      style={{ background: s.bg, borderColor: s.border, color: s.text }}
    >
      {icon && (
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

// ── CsButton ─────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'ai' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BTN_SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-[11px]',
  md: 'px-5 py-3 text-[12px]',
  lg: 'px-6 py-4 text-[13px]',
};

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--cs-primary)] text-white hover:shadow-[0_8px_24px_-6px_rgba(70,72,212,0.6)] hover:-translate-y-0.5',
  secondary:
    'bg-[var(--cs-surface-container-high)] text-[var(--cs-on-surface)] hover:bg-[var(--cs-surface-container-highest)] border border-[var(--cs-outline-variant)]',
  ghost:
    'bg-transparent text-[var(--cs-on-surface-variant)] hover:text-[var(--cs-on-surface)] hover:bg-white/5',
  ai: 'bg-[rgba(70,72,212,0.12)] text-[var(--cs-primary-fixed-dim)] border border-[rgba(70,72,212,0.30)] hover:bg-[rgba(70,72,212,0.20)]',
  danger:
    'bg-[rgba(255,107,107,0.15)] text-[var(--cs-error)] border border-[rgba(255,107,107,0.30)]',
};

interface CsButtonProps {
  children: React.ReactNode;
  icon?: string;
  variant?: ButtonVariant;
  onClick?: () => void;
  full?: boolean;
  size?: ButtonSize;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

export function CsButton({
  children,
  icon,
  variant = 'primary',
  onClick,
  full,
  size = 'md',
  disabled,
  type = 'button',
}: CsButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-bold uppercase tracking-widest transition-all active:scale-95',
        BTN_SIZES[size],
        BTN_VARIANTS[variant],
        full && 'w-full',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      {icon && (
        <span
          className="material-symbols-outlined"
          style={{ fontSize: size === 'lg' ? 20 : 16, fontVariationSettings: "'FILL' 1" }}
        >
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}

// ── KPICard ───────────────────────────────────────────────────────────────────
type KPIAccent = 'primary' | 'secondary' | 'tertiary' | 'success' | 'warn';

const KPI_ACCENT: Record<KPIAccent, string> = {
  primary: 'var(--cs-primary-fixed-dim)',
  secondary: 'var(--cs-secondary-fixed-dim)',
  tertiary: 'var(--cs-tertiary-fixed-dim)',
  success: 'var(--cs-success)',
  warn: 'var(--cs-warn)',
};

interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  trend?: number;
  icon?: string;
  accent?: KPIAccent;
  children?: React.ReactNode;
}

export function KPICard({
  label,
  value,
  sub,
  trend,
  icon,
  accent = 'primary',
  children,
}: KPICardProps) {
  const accentColor = KPI_ACCENT[accent];
  return (
    <div className="cs-glass rounded-2xl p-6 relative overflow-hidden group hover:border-white/20 transition-all">
      <div className="flex items-start justify-between mb-4">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--cs-on-surface-variant)] opacity-70 font-semibold">
          {label}
        </span>
        {icon && (
          <span
            className="material-symbols-outlined opacity-30 group-hover:opacity-60 transition-opacity"
            style={{ fontSize: 18 }}
          >
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span
          className="font-jakarta font-extrabold tracking-tight text-[34px]"
          style={{ color: accentColor }}
        >
          {value}
        </span>
        {trend !== undefined && (
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: accentColor }}>
            {trend > 0 ? 'trending_up' : 'trending_down'}
          </span>
        )}
      </div>
      {sub && <p className="text-[var(--cs-on-surface-variant)] text-[12px] opacity-70">{sub}</p>}
      {children}
    </div>
  );
}

// ── AIThinking ────────────────────────────────────────────────────────────────
export function AIThinking({ label = 'Reasoning' }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[rgba(70,72,212,0.10)] border border-[rgba(70,72,212,0.25)]">
      <span className="relative inline-block w-2 h-2 rounded-full bg-[var(--cs-primary)] cs-ai-pulse" />
      <span className="text-[11px] font-semibold tracking-wider uppercase text-[var(--cs-primary-fixed-dim)]">
        {label}
      </span>
      <span className="flex gap-0.5">
        <span
          className="w-1 h-1 rounded-full bg-[var(--cs-primary-fixed-dim)] cs-typing-dot"
          style={{ animationDelay: '0s' }}
        />
        <span
          className="w-1 h-1 rounded-full bg-[var(--cs-primary-fixed-dim)] cs-typing-dot"
          style={{ animationDelay: '.15s' }}
        />
        <span
          className="w-1 h-1 rounded-full bg-[var(--cs-primary-fixed-dim)] cs-typing-dot"
          style={{ animationDelay: '.3s' }}
        />
      </span>
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────
export function CsAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-[11px] flex-shrink-0 border border-white/10"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, oklch(0.55 0.12 ${h}), oklch(0.40 0.10 ${(h + 60) % 360}))`,
        color: 'white',
      }}
    >
      {initials}
    </div>
  );
}

// ── SectionHeader ─────────────────────────────────────────────────────────────
interface SectionHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  sub?: string;
  actions?: React.ReactNode;
}

export function CsSectionHeader({ eyebrow, title, sub, actions }: SectionHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
      <div className="space-y-3">
        {eyebrow && (
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[rgba(70,72,212,0.10)] border border-[rgba(70,72,212,0.22)] text-[var(--cs-primary-fixed-dim)]">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] font-bold">{eyebrow}</span>
          </div>
        )}
        <h2
          className="font-jakarta font-extrabold tracking-tight cs-gradient-text"
          style={{ fontSize: 48, lineHeight: 1.05 }}
        >
          {title}
        </h2>
        {sub && <p className="text-[var(--cs-on-surface-variant)] text-[16px] max-w-2xl">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 flex-wrap">{actions}</div>}
    </div>
  );
}

// ── Segmented control ─────────────────────────────────────────────────────────
interface SegmentedOption {
  value: string;
  label: string;
}
interface SegmentedProps {
  value: string;
  onChange: (v: string) => void;
  options: Array<string | SegmentedOption>;
}

export function CsSegmented({ value, onChange, options }: SegmentedProps) {
  return (
    <div className="inline-flex bg-[var(--cs-surface-variant)] border border-[var(--cs-outline-variant)] rounded-xl p-1">
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-[11px] uppercase tracking-widest font-semibold transition-all',
              value === v
                ? 'bg-[rgba(70,72,212,0.18)] text-[var(--cs-primary-fixed-dim)] border border-[rgba(70,72,212,0.30)] shadow-sm'
                : 'text-[var(--cs-on-surface-variant)] hover:text-[var(--cs-on-surface)]',
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
