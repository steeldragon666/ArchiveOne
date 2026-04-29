import type { ClaimStage } from '@cpa/schemas';

/**
 * Human-readable labels for each `ClaimStage`. Single source of truth for
 * any UI surface that renders a stage name (pipeline filter chips, kanban
 * column headers, table cells, claim-detail header badge, etc) so the
 * mapping doesn't fork per route.
 */
export const STAGE_LABELS: Record<ClaimStage, string> = {
  engagement: 'Engagement',
  activity_capture: 'Activity capture',
  narrative_drafting: 'Narrative drafting',
  expenditure_schedule: 'Expenditure schedule',
  review: 'Review',
  submitted: 'Submitted',
  audit_defence: 'Audit defence',
};
