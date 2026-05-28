'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Trial banner — P9.1.6.4.
 *
 * Shown at the top of every authenticated page while a tenant's trial is
 * active. Displays "X days remaining on your trial" + an upgrade CTA link.
 * Returns null for expired or converted tenants (banner disappears on
 * conversion so the user never sees a confusing "0 days remaining" flash).
 *
 * Usage:
 *   <TrialBanner
 *     trialStatus={session.trialStatus}   // 'active' | 'expired' | 'converted'
 *     trialEndsAt={session.trialEndsAt}   // ISO string or Date from the JWT
 *     upgradeHref="/billing/upgrade"      // optional, defaults to '/billing/upgrade'
 *   />
 *
 * Design: warm-amber/honey tinted strip matching the platform's cream base.
 * Accent `#5C7A6B` (patina green) for the CTA link. No heavy chrome.
 */

export interface TrialBannerProps {
  /** ISO string or Date representing when the trial expires. */
  trialEndsAt: Date | string;
  /** Current trial status from the tenant row. */
  trialStatus: 'active' | 'expired' | 'converted';
  /** CTA href — defaults to '/billing/upgrade'. */
  upgradeHref?: string;
  className?: string;
}

// ---------- Pure helpers (exported for unit tests) ----------

/**
 * Returns the number of whole days remaining until `trialEndsAt`, clamped to
 * a minimum of 0. Fractional days are floored (1.9 days → 1).
 */
export function daysRemaining(trialEndsAt: Date | string): number {
  const endsAt = typeof trialEndsAt === 'string' ? new Date(trialEndsAt) : trialEndsAt;
  const msRemaining = endsAt.getTime() - Date.now();
  return Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60 * 24)));
}

/** Returns the human-readable label for the days-remaining count. */
export function formatTrialLabel(days: number): string {
  const unit = days === 1 ? 'day' : 'days';
  return `${days} ${unit} remaining on your trial`;
}

// ---------- Component ----------

export function TrialBanner({
  trialEndsAt,
  trialStatus,
  upgradeHref,
  className,
}: TrialBannerProps) {
  // Only render while the trial is active.
  if (trialStatus !== 'active') return null;

  const days = daysRemaining(trialEndsAt);
  const label = formatTrialLabel(days);
  const href = upgradeHref ?? '/billing/upgrade';

  // Urgency tinting: ≤7 days gets a warmer amber background to draw attention.
  const isUrgent = days <= 7;

  return (
    <div
      role="banner"
      aria-label="Trial status"
      className={cn(
        'w-full px-4 py-2 text-sm font-body flex items-center justify-center gap-3',
        isUrgent
          ? 'bg-amber-950/40 border-b border-amber-700/50 text-amber-200'
          : 'bg-card border-b border-border text-foreground',
        className,
      )}
    >
      <span>{label}.</span>
      <a
        href={href}
        className="font-semibold underline underline-offset-2 text-primary hover:text-brand-accent-strong transition-colors"
      >
        Upgrade now
      </a>
    </div>
  );
}
