import { cn } from '@/lib/utils';

/**
 * The 7 lifecycle stages a claim moves through. Mirrors the API's
 * `ClaimStage` union; kept locally so the component stays decoupled from
 * the @cpa/api package boundary (we don't import server types into the
 * web app — the API contract crosses a network).
 */
const STAGES: Array<{ id: string; label: string }> = [
  { id: 'engagement', label: 'Engagement' },
  { id: 'activity_capture', label: 'Activity capture' },
  { id: 'narrative_drafting', label: 'Narrative drafting' },
  { id: 'expenditure_schedule', label: 'Expenditure schedule' },
  { id: 'review', label: 'Review' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'audit_defence', label: 'Audit defence' },
];

interface Props {
  currentStage: string;
}

/**
 * Linear progress timeline (T-C12).
 *
 * Renders the 7 stages as numbered dots connected by line segments;
 * stages up to and including the current one render in primary color;
 * later stages render muted. The "current" dot gets a ring to draw the
 * eye. Server-component-friendly — pure presentation, no client state.
 *
 * Layout is responsive: stacked vertically on narrow screens (mobile
 * PWA), horizontal on tablet+. The Tailwind `md:` prefix toggles the
 * orientation.
 */
export function ClaimStageTimeline({ currentStage }: Props) {
  const currentIndex = Math.max(
    0,
    STAGES.findIndex((s) => s.id === currentStage),
  );

  return (
    <ol className="flex flex-col gap-3 md:flex-row md:items-center md:gap-0">
      {STAGES.map((stage, idx) => {
        const reached = idx <= currentIndex;
        const isCurrent = idx === currentIndex;
        return (
          <li key={stage.id} className="flex items-center gap-3 md:flex-1 md:flex-col md:gap-2">
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                reached
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground',
                isCurrent && 'ring-4 ring-primary/30',
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {idx + 1}
            </div>
            <div
              className={cn(
                'text-sm md:text-center',
                reached ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {stage.label}
            </div>
            {idx < STAGES.length - 1 && (
              <div
                className={cn(
                  'hidden md:block md:h-0.5 md:flex-1',
                  idx < currentIndex ? 'bg-primary' : 'bg-border',
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
