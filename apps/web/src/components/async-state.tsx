'use client';

import { Button } from '@/components/ui/button';

/**
 * Shared async-state primitives — one place to fix loading/error UX
 * instead of 30+ one-liners scattered across pages.
 *
 * Themed against System A tokens (bg-background / text-foreground /
 * text-muted-foreground / text-destructive) so they pick up the dark-ink
 * + bone palette automatically and never leak the retired System B
 * slate/red colors.
 */

export interface LoadingStateProps {
  /** Short message shown below the indicator. Defaults to "Loading…". */
  label?: string;
  /**
   * `inline` renders compact text-only (no full-height container) for
   * inside-panel use. `block` centers in the viewport for empty-page
   * waiting states.
   */
  variant?: 'inline' | 'block';
}

export function LoadingState({ label = 'Loading…', variant = 'block' }: LoadingStateProps) {
  if (variant === 'inline') {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {label}
      </p>
    );
  }
  return (
    <div
      className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-muted-foreground"
      aria-live="polite"
      aria-busy="true"
    >
      <span
        className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-primary"
        aria-hidden="true"
      />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export interface ErrorStateProps {
  /** Short message above the action. Defaults to a generic retry prompt. */
  title?: string;
  /** Underlying error or longer description. Truncated to one paragraph. */
  message?: string;
  /** Callback for the retry button. Omit to hide the button. */
  onRetry?: () => void;
  /** Label override for the retry button. */
  retryLabel?: string;
  variant?: 'inline' | 'block';
}

export function ErrorState({
  title = 'Something went wrong.',
  message,
  onRetry,
  retryLabel = 'Try again',
  variant = 'block',
}: ErrorStateProps) {
  const body = (
    <>
      <p className="text-sm font-medium text-destructive">{title}</p>
      {message && <p className="mt-1 max-w-md text-xs text-muted-foreground">{message}</p>}
      {onRetry && (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </>
  );

  if (variant === 'inline') {
    return <div role="alert">{body}</div>;
  }
  return (
    <div
      className="flex min-h-[240px] flex-col items-center justify-center gap-1 text-center"
      role="alert"
    >
      {body}
    </div>
  );
}
