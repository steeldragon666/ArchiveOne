import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * EmptyState — shared empty-state treatment for all zero-data surfaces.
 *
 * Uses a small inline SVG illustration (patina-on-cream, single colour,
 * ~80px) paired with a Fraunces title + Inter Tight description + optional
 * primary CTA. Replaces dashed-border ad-hoc empty states across the app.
 *
 * Icon variants:
 *   ledger   — blank ledger page with folded corner (default)
 *   folder   — open empty folder
 *   ribbon   — unspooled audit ribbon / scroll
 *   users    — empty silhouette group
 *   file     — empty document with folded corner
 */

export type EmptyStateIcon = 'ledger' | 'folder' | 'ribbon' | 'users' | 'file';

export interface EmptyStateAction {
  label: string;
  /** When href is provided, renders an <a>. Otherwise renders a <button>. */
  href?: string;
  onClick?: () => void;
}

export interface EmptyStateProps {
  icon?: EmptyStateIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

// ---------- Inline SVG illustrations (patina-on-cream, ~80px) ----------

function LedgerIcon() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Page body */}
      <rect x="12" y="10" width="44" height="52" rx="2" fill="hsl(var(--brand-accent-subtle))" />
      {/* Folded corner */}
      <path d="M46 10L56 20H46V10Z" fill="hsl(var(--brand-accent))" opacity="0.35" />
      <path
        d="M46 10V20H56"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Ruled lines */}
      <line
        x1="20"
        y1="30"
        x2="46"
        y2="30"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1"
        opacity="0.5"
      />
      <line
        x1="20"
        y1="37"
        x2="46"
        y2="37"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1"
        opacity="0.35"
      />
      <line
        x1="20"
        y1="44"
        x2="40"
        y2="44"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1"
        opacity="0.25"
      />
      {/* Left margin rule */}
      <line
        x1="26"
        y1="24"
        x2="26"
        y2="52"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="0.75"
        opacity="0.3"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Folder back */}
      <path
        d="M10 26C10 24.3 11.3 23 13 23H32L36 28H59C60.7 28 62 29.3 62 31V54C62 55.7 60.7 57 59 57H13C11.3 57 10 55.7 10 54V26Z"
        fill="hsl(var(--brand-accent-subtle))"
      />
      {/* Tab */}
      <path
        d="M10 23H30L34 19H13C11.3 19 10 20.3 10 22V23Z"
        fill="hsl(var(--brand-accent))"
        opacity="0.3"
      />
      {/* Folder outline */}
      <path
        d="M10 26C10 24.3 11.3 23 13 23H32L36 28H59C60.7 28 62 29.3 62 31V54C62 55.7 60.7 57 59 57H13C11.3 57 10 55.7 10 54V26Z"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RibbonIcon() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Scroll body */}
      <rect x="16" y="18" width="40" height="36" rx="3" fill="hsl(var(--brand-accent-subtle))" />
      {/* Top and bottom roller */}
      <rect
        x="12"
        y="14"
        width="48"
        height="8"
        rx="4"
        fill="hsl(var(--brand-accent))"
        opacity="0.25"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1"
      />
      <rect
        x="12"
        y="50"
        width="48"
        height="8"
        rx="4"
        fill="hsl(var(--brand-accent))"
        opacity="0.25"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1"
      />
      {/* Ruled lines */}
      <line
        x1="24"
        y1="30"
        x2="48"
        y2="30"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1"
        opacity="0.45"
      />
      <line
        x1="24"
        y1="36"
        x2="48"
        y2="36"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1"
        opacity="0.3"
      />
      <line
        x1="24"
        y1="42"
        x2="40"
        y2="42"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1"
        opacity="0.2"
      />
    </svg>
  );
}

function UsersEmptyIcon() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Background person silhouette */}
      <circle
        cx="44"
        cy="26"
        r="9"
        fill="hsl(var(--brand-accent-subtle))"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        opacity="0.6"
      />
      <path
        d="M28 56C28 47.2 35.2 40 44 40C52.8 40 60 47.2 60 56"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* Foreground person silhouette */}
      <circle
        cx="28"
        cy="28"
        r="10"
        fill="hsl(var(--brand-accent-subtle))"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
      />
      <path
        d="M10 58C10 48.1 18.1 40 28 40C37.9 40 46 48.1 46 58"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Page body */}
      <path
        d="M14 12H44L58 26V60C58 61.1 57.1 62 56 62H16C14.9 62 14 61.1 14 60V14C14 12.9 14.9 12 16 12H14Z"
        fill="hsl(var(--brand-accent-subtle))"
      />
      <path
        d="M16 12H44L58 26V60C58 61.1 57.1 62 56 62H16C14.9 62 14 61.1 14 60V14C14 12.9 14.9 12 16 12Z"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Folded corner */}
      <path d="M44 12V26H58L44 12Z" fill="hsl(var(--brand-accent))" opacity="0.25" />
      <path
        d="M44 12V26H58"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Content lines */}
      <line
        x1="24"
        y1="36"
        x2="48"
        y2="36"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        opacity="0.4"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="43"
        x2="48"
        y2="43"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        opacity="0.3"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="50"
        x2="38"
        y2="50"
        stroke="hsl(var(--brand-accent))"
        strokeWidth="1.5"
        opacity="0.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ICON_MAP: Record<EmptyStateIcon, React.ComponentType> = {
  ledger: LedgerIcon,
  folder: FolderIcon,
  ribbon: RibbonIcon,
  users: UsersEmptyIcon,
  file: FileIcon,
};

// ---------- Component ----------

export function EmptyState({
  icon = 'ledger',
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const IconComponent = ICON_MAP[icon];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-14 px-6 text-center',
        'rounded border border-[hsl(var(--brand-hairline))] bg-[hsl(var(--brand-accent-subtle)/0.3)]',
        className,
      )}
    >
      <div className="mb-5 opacity-80">
        <IconComponent />
      </div>
      <h3 className="font-display text-xl font-medium text-foreground mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm leading-relaxed mb-5">{description}</p>
      )}
      {action && (
        <>
          {action.href ? (
            <a
              href={action.href}
              className="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {action.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {action.label}
            </button>
          )}
        </>
      )}
    </div>
  );
}
