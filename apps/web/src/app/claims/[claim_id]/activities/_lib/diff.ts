import type { Activity, UpdateActivityBody } from '@cpa/schemas';

/**
 * Helpers for the activity-detail editor (T-A5) — pure functions, no
 * React, so they're testable via apps/web's node:test runner without
 * jsdom (the editor component itself is exercised end-to-end via
 * Playwright in T-A10).
 *
 * The form represents the seven editable narrative fields as always-
 * strings (empty string == "cleared"). The {@link Activity} row stores
 * `title` as a non-null string and the other six narratives as
 * `string | null`. These helpers translate between the two:
 *
 *   - {@link activityToFormValues}: nullable → '' for use as the form's
 *     `defaultValues` (avoids React controlled/uncontrolled flips).
 *   - {@link computeChangedFields}: form → PATCH body diff. Empty-string
 *     narratives map to `null` so the audit-chain field-diff matches
 *     the DB nullable storage representation rather than reading
 *     "from text → to ''".
 */
export interface ActivityFormValues {
  title: string;
  description: string;
  hypothesis: string;
  technical_uncertainty: string;
  experimentation_log: string;
  expected_outcome: string;
  actual_outcome: string;
}

const NARRATIVE_KEYS = [
  'description',
  'hypothesis',
  'technical_uncertainty',
  'experimentation_log',
  'expected_outcome',
  'actual_outcome',
] as const;

export function activityToFormValues(activity: Activity): ActivityFormValues {
  return {
    title: activity.title,
    description: activity.description ?? '',
    hypothesis: activity.hypothesis ?? '',
    technical_uncertainty: activity.technical_uncertainty ?? '',
    experimentation_log: activity.experimentation_log ?? '',
    expected_outcome: activity.expected_outcome ?? '',
    actual_outcome: activity.actual_outcome ?? '',
  };
}

export function computeChangedFields(
  original: Activity,
  current: ActivityFormValues,
): UpdateActivityBody {
  const patch: UpdateActivityBody = {};
  if (current.title !== original.title) {
    patch.title = current.title;
  }
  for (const key of NARRATIVE_KEYS) {
    const originalVal = original[key] ?? '';
    if (current[key] !== originalVal) {
      // Empty string maps to null so a "cleared" narrative field reads
      // as null in the audit chain (matches DB nullable storage). A
      // non-empty value is sent as the string.
      patch[key] = current[key] === '' ? null : current[key];
    }
  }
  return patch;
}
