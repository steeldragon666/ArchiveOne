'use client';

import type { WorkflowStepEntry } from '@cpa/schemas';
import { Circle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CanAdvance } from '../_lib/workflow-client';
import { StaleStepBanner } from './stale-step-banner';

/**
 * WizardStep5 — STUB.
 *
 * Document generation endpoints (POST /v1/claims/:id/documents/generate or
 * equivalent) do NOT exist yet. This component is intentionally a static
 * placeholder explaining what will happen once the backend lands.
 *
 * canAdvance(5, snapshot) is terminal per the F2 test pin
 * (apps/api/src/routes/claim-workflow.test.ts:687) — no agreeStep(5) is
 * called. Step 5 completion semantics will be defined when generation
 * lands; until then, "Generate" is permanently disabled.
 *
 * See: docs/plans/2026-05-12-claim-wizard.md Task 6.4 for the future scope.
 */

interface DocItem {
  label: string;
}

const PLANNED_DOCS: DocItem[] = [
  { label: 'Application Form (portal fields)' },
  { label: 'R&D Activities Schedule' },
  { label: 'Technical Report (PDF)' },
];

export function WizardStep5GenerateDocuments({
  claimId: _claimId,
  subjectTenantId: _subjectTenantId,
  stepEntry,
  canAdvance,
}: {
  claimId: string;
  subjectTenantId: string;
  stepEntry: WorkflowStepEntry | null;
  canAdvance: CanAdvance;
}) {
  return (
    <section className="space-y-6" data-testid="wizard-step-5">
      <StaleStepBanner stepEntry={stepEntry} canAdvance={canAdvance} />
      <header className="space-y-1">
        <h2 className="font-display text-xl font-semibold tracking-tight">Generate Documents</h2>
        <p className="text-sm text-muted-foreground">
          Generate the final R&amp;D Tax Incentive submission documents. This will create the
          Application Form, R&amp;D Activities Schedule, and supporting documentation.
        </p>
      </header>

      {/* Honest "Coming soon" panel — no simulated generation. */}
      <div className="rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-4 space-y-2">
        <p className="text-sm text-muted-foreground">
          Documents will be generated once the backend endpoints land. Coming soon.
        </p>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Generation backend pending
        </p>
      </div>

      {/* Generate button — permanently disabled until backend lands. */}
      <div>
        <Button
          size="lg"
          disabled
          aria-disabled
          title="Generation backend pending"
          className="gap-2"
        >
          <FileText className="h-4 w-4" />
          Generate all documents
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">Generation backend pending</p>
      </div>

      {/* Planned documents list (static — these will be generated when backend ships). */}
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Documents that will be generated
        </p>
        <ul className="space-y-2">
          {PLANNED_DOCS.map((doc) => (
            <li
              key={doc.label}
              className="flex items-center gap-3 rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] px-4 py-3"
            >
              <span className="flex h-5 w-5 items-center justify-center">
                <Circle className="h-5 w-5 text-muted-foreground/30" />
              </span>
              <span className="text-sm font-medium">{doc.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">Not yet available</span>
            </li>
          ))}
        </ul>
      </div>

      {/* No Next button — this is the final step. */}
      <div className="border-t border-[hsl(var(--brand-line))] pt-4">
        <p className="text-sm text-muted-foreground">
          This is the final step. Document generation will be enabled once the backend service
          ships.
        </p>
      </div>
    </section>
  );
}
