'use client';

import type { WorkflowStepEntry } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import { UploadEvidenceButton } from '@/app/subject-tenants/[id]/_components/upload-evidence-button';
import { EventFeed } from '@/app/subject-tenants/[id]/_components/event-feed';
import type { CanAdvance } from '../_lib/workflow-client';
import { StaleStepBanner } from './stale-step-banner';

/**
 * Wizard Step 1 — Upload Evidence.
 *
 * Wraps the existing UploadEvidenceButton and EventFeed components in
 * a wizard-step shell. The "Next" button is enabled only when the
 * parent orchestrator signals `canAdvance.ok === true` (i.e. at least
 * one evidence file exists on the claimant chain).
 */
export function WizardStep1UploadEvidence({
  subjectTenantId,
  stepEntry,
  canAdvance,
  onNext,
}: {
  subjectTenantId: string;
  stepEntry: WorkflowStepEntry | null;
  canAdvance: CanAdvance;
  onNext: () => void;
}) {
  return (
    <section className="space-y-6" data-testid="wizard-step-1">
      <StaleStepBanner stepEntry={stepEntry} canAdvance={canAdvance} />
      <header className="space-y-1">
        <h2 className="font-display text-xl font-semibold tracking-tight">Upload Evidence</h2>
        <p className="text-sm text-muted-foreground">
          Attach source documents — lab notebooks, emails, contracts, invoices — so the platform can
          classify and attribute them to R&amp;D activities.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <UploadEvidenceButton subjectTenantId={subjectTenantId} />
      </div>

      <EventFeed subjectTenantId={subjectTenantId} />

      <div className="flex items-center justify-end gap-3 border-t border-[hsl(var(--brand-line))] pt-4">
        {!canAdvance.ok && (
          <p className="mr-auto text-sm text-muted-foreground">{canAdvance.reason}</p>
        )}
        <Button onClick={onNext} disabled={!canAdvance.ok}>
          Next: Review Activities &rarr;
        </Button>
      </div>
    </section>
  );
}
