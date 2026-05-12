'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorkflowStepEntry } from '@cpa/schemas';
import { Loader2, Circle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CanAdvance } from '../_lib/workflow-client';
import { StaleStepBanner } from './stale-step-banner';

/**
 * Wizard Step 5 -- Generate Documents.
 *
 * Final step: triggers generation of R&DTI submission documents. The
 * actual generation endpoints are not wired yet, so the component uses
 * local state to simulate a generation flow. When the backend ships,
 * replace the simulation with real POST calls and streaming status
 * updates.
 *
 * Documents:
 *   1. Application Form (portal fields)
 *   2. R&D Activities Schedule
 *   3. Technical Report (PDF)
 */

type DocStatus = 'pending' | 'generating' | 'unavailable';

interface DocItem {
  label: string;
  status: DocStatus;
}

const INITIAL_DOCS: DocItem[] = [
  { label: 'Application Form (portal fields)', status: 'pending' },
  { label: 'R&D Activities Schedule', status: 'pending' },
  { label: 'Technical Report (PDF)', status: 'pending' },
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
  const [docs, setDocs] = useState<DocItem[]>(INITIAL_DOCS);
  const [hasTriggered, setHasTriggered] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  const isGenerating = docs.some((d) => d.status === 'generating');
  const allUnavailable = hasTriggered && docs.every((d) => d.status === 'unavailable');

  const handleGenerate = () => {
    setHasTriggered(true);
    setDocs((prev) => prev.map((d) => ({ ...d, status: 'generating' as const })));

    // Simulate backend delay — replace with real POST calls when endpoints ship.
    timeoutRef.current = setTimeout(() => {
      setDocs((prev) => prev.map((d) => ({ ...d, status: 'unavailable' as const })));
    }, 2000);
  };

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

      {/* NOTE: Step 5 does NOT call agreeStep(5). The reducer treats step 5 as
         terminal (canAdvance(5) === { ok: false, reason: 'Step 5 is terminal' }).
         Completion semantics for Step 5 will be defined when the real document
         generation endpoints land (see TODO at workflow.ts:101). Until then, this
         step renders a stub. */}
      {/* Generate button */}
      <div>
        <Button
          size="lg"
          onClick={handleGenerate}
          disabled={isGenerating || allUnavailable}
          className="gap-2"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <FileText className="h-4 w-4" />
              Generate all documents
            </>
          )}
        </Button>
      </div>

      {/* Document status list */}
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Document status
        </p>
        <ul className="space-y-2">
          {docs.map((doc) => (
            <li
              key={doc.label}
              className="flex items-center gap-3 rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] px-4 py-3"
            >
              <StatusIndicator status={doc.status} />
              <span className="text-sm font-medium">{doc.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {doc.status === 'pending' && 'Pending'}
                {doc.status === 'generating' && 'Generating...'}
                {doc.status === 'unavailable' && 'Not yet available'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Unavailable notice */}
      {allUnavailable && (
        <div className="rounded border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-4 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Document generation endpoints are not yet connected. Once the backend generation service
            ships, documents will be created automatically and available for download here.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Check back after the next deployment
          </p>
        </div>
      )}

      {/* No Next button -- this is the final step */}
      {!hasTriggered && (
        <div className="border-t border-[hsl(var(--brand-line))] pt-4">
          <p className="text-sm text-muted-foreground">
            This is the final step. Click &ldquo;Generate all documents&rdquo; above to create your
            submission package.
          </p>
        </div>
      )}
    </section>
  );
}

function StatusIndicator({ status }: { status: DocStatus }) {
  switch (status) {
    case 'pending':
      return (
        <span className="flex h-5 w-5 items-center justify-center">
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
        </span>
      );
    case 'generating':
      return <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--brand-accent))]" />;
    case 'unavailable':
      return <Circle className="h-5 w-5 text-muted-foreground/30" />;
    default:
      return null;
  }
}
