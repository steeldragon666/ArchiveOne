'use client';

import type { WorkflowStepEntry } from '@cpa/schemas';
import type { CanAdvance } from '../_lib/workflow-client';

/**
 * Yellow warning banner shown when a wizard step was previously agreed
 * but can no longer advance (i.e. data has changed since the last
 * agreement). Implements Q5.b from the claim-wizard design doc.
 *
 * Renders nothing when:
 *   - the step was never agreed (`stepEntry === null`)
 *   - `canAdvance.ok === true` (step is still valid)
 */
export function StaleStepBanner({
  stepEntry,
  canAdvance,
}: {
  stepEntry: WorkflowStepEntry | null;
  canAdvance: CanAdvance;
}) {
  if (!stepEntry || canAdvance.ok) return null;

  const agreedDate = new Date(stepEntry.agreed_at).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    // TODO: replace raw yellow-* utilities with --brand-warning token once defined in design system
    <div
      className="rounded border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
      role="alert"
      data-testid="stale-step-banner"
    >
      Last agreed {agreedDate}. Data has changed since &mdash; review and re-Agree.
    </div>
  );
}
