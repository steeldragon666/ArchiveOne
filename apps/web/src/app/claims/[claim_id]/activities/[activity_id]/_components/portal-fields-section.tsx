'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Activity } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  editPortalFields,
  generatePortalFields,
  trimPortalField,
  type EditPortalFieldsResponse,
  type GeneratedPortalFields,
  type GeneratePortalFieldsResponse,
  type TrimPortalFieldResponse,
} from '../../_lib/api';

/**
 * AusIndustry portal-ready fields for an activity (draft-narrative@1.2.0).
 *
 * Three states:
 *   - Empty (`portal_fields = {}`): display CTA + Generate button.
 *   - Populated, view mode: read-only render of the 13/9 fields with
 *     Edit + Re-generate buttons.
 *   - Populated, edit mode: text fields become textareas with live char-
 *     count indicators; Save calls PATCH /portal-fields with the diff,
 *     Cancel discards.
 *
 * Editing scope: only top-level string fields and `dominant_purpose.explanation`
 * are editable here. Enum arrays (`outcome_unknown_methods`,
 * `evidence_kept_categories`), UUID arrays, dates, booleans, and the
 * `is_dominant_purpose: true` literal stay read-only — those need
 * dedicated control surfaces beyond this MVP. Numeric fields
 * (`expenditure_estimate_aud`) are editable as text and parsed at save.
 */
export function PortalFieldsSection({ activity }: { activity: Activity }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);

  const isPopulated = isPortalFieldsPopulated(activity.portal_fields);
  const generated = isPopulated ? coercePortalFields(activity.portal_fields) : null;

  const generateMutation = useMutation<GeneratePortalFieldsResponse, Error>({
    mutationFn: () => generatePortalFields(activity.id),
    onSuccess: (result) => {
      toast({
        title: 'Portal fields generated',
        description: `${result.meta.tokens_in.toLocaleString()} in / ${result.meta.tokens_out.toLocaleString()} out tokens, ${(result.meta.elapsed_ms / 1000).toFixed(1)}s · ${result.meta.events_count} events`,
      });
      // Re-fetch the activity so the new portal_fields hydrate the UI.
      void queryClient.invalidateQueries({ queryKey: ['activity', activity.id] });
    },
    onError: (err) => {
      toast({
        variant: 'destructive',
        title: 'Generation failed',
        description: err.message,
      });
    },
  });

  const editMutation = useMutation<EditPortalFieldsResponse, Error, Record<string, unknown>>({
    mutationFn: (fields) => editPortalFields(activity.id, fields),
    onSuccess: () => {
      toast({ title: 'Portal fields saved' });
      setIsEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['activity', activity.id] });
    },
    onError: (err) => {
      toast({ variant: 'destructive', title: 'Save failed', description: err.message });
    },
  });

  return (
    <section className="space-y-4" data-testid="portal-fields-section">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-medium">AusIndustry portal fields</h2>
        <div className="flex gap-2">
          {generated && !isEditing && !generateMutation.isPending ? (
            <Button
              variant="outline"
              onClick={() => setIsEditing(true)}
              data-testid="edit-portal-fields"
            >
              Edit
            </Button>
          ) : null}
          {!isEditing ? (
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="generate-portal-fields"
            >
              {generateMutation.isPending
                ? 'Generating… (~60s)'
                : generated
                  ? 'Re-generate'
                  : 'Generate portal fields'}
            </Button>
          ) : null}
        </div>
      </div>

      {!generated && !generateMutation.isPending ? (
        <p className="text-sm text-[hsl(var(--brand-ink-subtle))]">
          The portal-fields agent emits the {activity.kind === 'core' ? '13 core' : '9 supporting'}{' '}
          fields required by the AusIndustry registration form. Generation reads this
          activity&apos;s classified evidence and produces structured output ready to paste into the
          portal.
        </p>
      ) : null}

      {generateMutation.isPending ? (
        <p className="text-sm italic text-[hsl(var(--brand-ink-subtle))]">
          Calling Sonnet — this typically takes 50-75 seconds for {activity.kind} activities. The
          request will not be cancelled if you navigate away.
        </p>
      ) : null}

      {generated && !isEditing ? <PortalFieldsDisplay generated={generated} /> : null}

      {generated && isEditing ? (
        <PortalFieldsEditor
          activityId={activity.id}
          generated={generated}
          onSave={(fields) => editMutation.mutate(fields)}
          onCancel={() => setIsEditing(false)}
          isSaving={editMutation.isPending}
        />
      ) : null}

      {!isEditing && activity.portal_fields_history && activity.portal_fields_history.length > 0 ? (
        <PortalFieldsHistoryPanel
          history={activity.portal_fields_history}
          onRestore={(restored) =>
            editMutation.mutate((restored.portal_fields['fields'] ?? {}) as Record<string, unknown>)
          }
          isSaving={editMutation.isPending}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function PortalFieldsDisplay({ generated }: { generated: GeneratedPortalFields }) {
  const entries = Object.entries(generated.fields);
  return (
    <dl className="space-y-3 rounded-md border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-4">
      <div className="text-xs uppercase tracking-wide text-[hsl(var(--brand-ink-subtle))]">
        {generated.activity_kind === 'core' ? 's.355-25 core' : 's.355-30 supporting'} ·{' '}
        {entries.length} fields
      </div>
      {entries.map(([key, value]) => (
        <div key={key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="font-display text-sm font-medium">{humaniseKey(key)}</dt>
            <CopyFieldButton value={value} fieldKey={key} />
          </div>
          <dd className="text-sm">
            <PortalFieldValue value={value} pathKey={key} activityKind={generated.activity_kind} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Small affordance per field: copy the value to the clipboard in a form
 * suitable for pasting straight into the AusIndustry portal field box.
 *
 * Format rules:
 *   - strings        → verbatim
 *   - numbers/bools  → String(value)
 *   - arrays         → newline-separated (one item per line; nested objects
 *                      serialised as JSON since the portal generally expects
 *                      flat lists, but consultants can paste-then-edit)
 *   - dates_conducted / dominant_purpose / other nested → JSON.stringify
 *
 * Uses navigator.clipboard.writeText (async). On success the button briefly
 * shows "Copied"; on failure (HTTP context, permissions denied) we fall back
 * to a toast with the raw value selected for manual copy.
 */
function CopyFieldButton({ value, fieldKey }: { value: unknown; fieldKey: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const serialised = serialiseForClipboard(value);
    try {
      await navigator.clipboard.writeText(serialised);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // navigator.clipboard requires a secure context (https or localhost)
      // and a user-gesture handler; both true here, but defensively
      // surface the failure so the consultant isn't left guessing.
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: err instanceof Error ? err.message : 'clipboard unavailable',
      });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="text-xs text-[hsl(var(--brand-ink-subtle))] hover:text-[hsl(var(--brand-ink))] underline-offset-2 hover:underline"
      data-testid={`copy-portal-field-${fieldKey}`}
      aria-label={`Copy ${fieldKey} to clipboard`}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function serialiseForClipboard(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return (value as unknown[])
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join('\n');
  }
  // Nested objects (dates_conducted, dominant_purpose, …). Pretty-print so
  // the consultant can read it before pasting — most portal fields take
  // plain text and an object's `JSON.stringify` is at least human-legible.
  return JSON.stringify(value, null, 2);
}

function PortalFieldValue({
  value,
  pathKey,
  activityKind,
}: {
  value: unknown;
  /**
   * Dot-pathed key (e.g. `'description'`, `'dominant_purpose.explanation'`)
   * used to look up the AusIndustry character limit. Set to `null` for
   * array items (no per-item limit applies) and for the top-level
   * recursive call from PortalFieldsDisplay if a limit isn't relevant.
   */
  pathKey: string | null;
  activityKind: 'core' | 'supporting';
}) {
  if (value === null || value === undefined) {
    return <span className="italic text-[hsl(var(--brand-ink-subtle))]">(empty)</span>;
  }
  if (typeof value === 'string') {
    // Long strings get whitespace-pre-wrap so paragraph breaks survive.
    const limit = pathKey ? lookupCharLimit(activityKind, pathKey) : null;
    return (
      <div className="space-y-1">
        <p className="whitespace-pre-wrap">{value}</p>
        {limit !== null ? <CharCountBadge length={value.length} limit={limit} /> : null}
      </div>
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    // TS's Array.isArray narrows to `any[]` (not `unknown[]`), so eslint's
    // no-unsafe-assignment flags `item`. Re-narrow via cast so each child
    // receives an explicit `unknown` and recurses safely.
    const items: unknown[] = value;
    if (items.length === 0) {
      return <span className="italic text-[hsl(var(--brand-ink-subtle))]">(none)</span>;
    }
    return (
      <ul className="ml-4 list-disc space-y-0.5">
        {items.map((item, i) => (
          <li key={i}>
            {/* Array items don't have their own char limit — pass null. */}
            <PortalFieldValue value={item} pathKey={null} activityKind={activityKind} />
          </li>
        ))}
      </ul>
    );
  }
  // Nested objects (e.g. `dates_conducted: {start, end}`,
  // `dominant_purpose: {is_dominant_purpose, explanation}`).
  // Build a child path so nested string fields can still find their limit
  // (e.g. `dominant_purpose.explanation` → 4000 chars).
  return (
    <div className="ml-4 space-y-1">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        const childPath = pathKey ? `${pathKey}.${k}` : k;
        return (
          <div key={k} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <span className="text-xs uppercase text-[hsl(var(--brand-ink-subtle))]">
                {humaniseKey(k)}:
              </span>
              <PortalFieldValue value={v} pathKey={childPath} activityKind={activityKind} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Character-limit lookup + badge
// ---------------------------------------------------------------------------

/**
 * Returns the AusIndustry portal character limit for a field path, or
 * `null` if the field has no defined cap (e.g. arrays, numbers, dates).
 *
 * Hardcoded to mirror `PortalFieldCharacterLimits` in
 * `@cpa/schemas/portal-fields.ts` because the limits constant uses flat
 * keys (e.g. `dominant_purpose_explanation`) while the rendered data is
 * nested (`dominant_purpose.explanation`); a path-aware map is clearer
 * than re-deriving it at render time. Activity-name caps at 200 for
 * both kinds (set directly by Char200 in the Zod schemas; not in the
 * limits constant).
 */
function lookupCharLimit(activityKind: 'core' | 'supporting', path: string): number | null {
  if (path === 'activity_name') return 200;
  if (activityKind === 'core') {
    switch (path) {
      case 'description':
      case 'sources_investigated':
      case 'why_competent_professional_couldnt_know':
      case 'hypothesis':
      case 'experiment':
      case 'evaluation':
      case 'conclusions':
      case 'new_knowledge_purpose':
        return 4000;
      default:
        return null;
    }
  }
  // supporting
  switch (path) {
    case 'description':
    case 'how_supports_core_rd':
    case 'evidence_kept':
    case 'dominant_purpose.explanation':
      return 4000;
    default:
      return null;
  }
}

function CharCountBadge({ length, limit }: { length: number; limit: number }) {
  // Three states: comfortable (≤80%), warning (80–100%), over-limit (>100%).
  // Brand vars stay consistent with the rest of the surface; over-limit
  // uses text-destructive so it stands out clearly to a reviewing consultant.
  const ratio = length / limit;
  const tone =
    ratio > 1
      ? 'text-destructive font-medium'
      : ratio > 0.8
        ? 'text-[hsl(var(--brand-ink))] font-medium'
        : 'text-[hsl(var(--brand-ink-subtle))]';
  return (
    <span className={`text-xs ${tone}`} data-testid="portal-field-char-count">
      {length.toLocaleString()} / {limit.toLocaleString()} chars
      {ratio > 1 ? ' — over portal limit' : null}
    </span>
  );
}

/** snake_case → "Snake case" for human-readable field labels. */
function humaniseKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b(rd|aud|id|ids)\b/gi, (m) => m.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Type guard for the empty-default `{}` state. The DB column defaults to
 * `{}` and the API returns it as a regular Record, so a populated payload
 * has at least `activity_kind` set.
 */
function isPortalFieldsPopulated(pf: Record<string, unknown>): boolean {
  return typeof pf['activity_kind'] === 'string' && typeof pf['fields'] === 'object';
}

/**
 * Narrow the loose `Record<string, unknown>` from the API to our shape.
 * Caller has already verified via {@link isPortalFieldsPopulated}.
 */
function coercePortalFields(pf: Record<string, unknown>): GeneratedPortalFields {
  return {
    activity_kind: pf['activity_kind'] as 'core' | 'supporting',
    fields: (pf['fields'] ?? {}) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Editor — field descriptors
// ---------------------------------------------------------------------------

/**
 * Enum values for the AusIndustry portal multi-/single-select fields.
 * Mirrors the Zod enums in `@cpa/schemas/portal-fields.ts`. Kept inline
 * (not imported) so the web bundle doesn't drag the agents/schemas
 * Zod runtime over the workspace boundary — these are stable wire
 * literals and updating both places at once is the same edit cost.
 */
const OUTCOME_UNKNOWN_METHODS = [
  'no_applicable_literature',
  'expert_advice',
  'no_adaptable_solutions',
  'other',
  'did_not_investigate',
] as const;

const EVIDENCE_KEPT_CATEGORIES = [
  'hypothesis_design',
  'results_evaluation',
  'experiment_revisions',
  'knowledge_searches',
  'systematic_progression',
  'other',
  'no_records_kept',
] as const;

const WHO_PERFORMED_WORK = [
  'r_and_d_company_only',
  'r_and_d_company_and_others',
  'subsidiary_or_group_or_others',
  'others_only',
] as const;

type FieldDescriptor =
  | { type: 'text' }
  | { type: 'number'; min?: number }
  | { type: 'enum-multi'; options: readonly string[] }
  | { type: 'enum-single'; options: readonly string[] }
  | { type: 'date-range' }
  | { type: 'boolean' }
  | { type: 'dominant-purpose' }
  | { type: 'uuid-array' }; // read-only for now — cross-activity picker is out of scope

/**
 * What kind of editor control to render for each top-level portal-field key.
 * Keys absent from this map are rendered read-only with a note.
 */
const FIELD_DESCRIPTORS: Record<string, FieldDescriptor> = {
  // Common to core + supporting
  activity_name: { type: 'text' },
  description: { type: 'text' },
  expenditure_estimate_aud: { type: 'number', min: 0 },
  // Core-only
  sources_investigated: { type: 'text' },
  why_competent_professional_couldnt_know: { type: 'text' },
  hypothesis: { type: 'text' },
  experiment: { type: 'text' },
  evaluation: { type: 'text' },
  conclusions: { type: 'text' },
  new_knowledge_purpose: { type: 'text' },
  outcome_unknown_methods: { type: 'enum-multi', options: OUTCOME_UNKNOWN_METHODS },
  evidence_kept_categories: { type: 'enum-multi', options: EVIDENCE_KEPT_CATEGORIES },
  related_supporting_activity_ids: { type: 'uuid-array' },
  // Supporting-only
  how_supports_core_rd: { type: 'text' },
  evidence_kept: { type: 'text' },
  supports_core_activity_ids: { type: 'uuid-array' },
  who_performed_work: { type: 'enum-single', options: WHO_PERFORMED_WORK },
  dates_conducted: { type: 'date-range' },
  produces_good_or_service: { type: 'boolean' },
  dominant_purpose: { type: 'dominant-purpose' },
};

/**
 * Editor for the generated portal_fields payload.
 *
 * Builds a local `draft` Record that mirrors `generated.fields`. Each text
 * field has a controlled textarea; on save, the editor diffs against the
 * originals and submits only the changed keys (smaller PATCH payload +
 * smaller audit footprint).
 *
 * Validation feedback: char-count badges turn destructive when over the
 * portal cap. The server re-validates on PATCH; if a field is still over
 * limit, the toast surfaces the issue list and the editor stays open.
 *
 * `dominant_purpose.explanation` is editable as a special-case because
 * supporting activities need it; the editor sends the entire
 * `dominant_purpose` object back (server merge is shallow on top-level
 * keys, so partial nested edits aren't supported by design).
 */
function PortalFieldsEditor({
  activityId,
  generated,
  onSave,
  onCancel,
  isSaving,
}: {
  activityId: string;
  generated: GeneratedPortalFields;
  onSave: (fields: Record<string, unknown>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  // Local draft of every top-level key. We don't deep-clone — Object.values
  // are primitives (strings/numbers/bools) or arrays/objects that we
  // reassign wholesale on edit, so structural sharing is fine.
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...generated.fields });
  // Local draft of the supporting-activity `dominant_purpose.explanation`
  // field. We surface it as its own textarea but persist by re-attaching
  // to the parent object on save.
  const initialExplanation = readDominantPurposeExplanation(generated.fields);
  const [explanation, setExplanation] = useState<string>(initialExplanation);

  const onSubmit = () => {
    // Build the PATCH body: only changed keys. Reference equality is
    // fine for primitive values, but arrays/objects must be compared by
    // JSON serialisation since edit handlers re-assign new instances.
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) {
      const original = generated.fields[k];
      const isSame =
        v === original ||
        (v !== null && original !== null && typeof v === 'object' && typeof original === 'object'
          ? JSON.stringify(v) === JSON.stringify(original)
          : false);
      if (!isSame) changed[k] = v;
    }
    // Dominant-purpose explanation: send the whole dominant_purpose object
    // (shallow merge on the server can't reach into nested keys).
    if (explanation !== initialExplanation) {
      const dp = (generated.fields['dominant_purpose'] ?? {}) as Record<string, unknown>;
      changed['dominant_purpose'] = { ...dp, explanation };
    }
    if (Object.keys(changed).length === 0) {
      onCancel();
      return;
    }
    onSave(changed);
  };

  const entries = Object.entries(generated.fields);

  return (
    <form
      className="space-y-4 rounded-md border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      data-testid="portal-fields-editor"
    >
      <div className="text-xs uppercase tracking-wide text-[hsl(var(--brand-ink-subtle))]">
        Editing · {generated.activity_kind === 'core' ? 's.355-25 core' : 's.355-30 supporting'}
      </div>

      {entries.map(([key, value]) => {
        const descriptor = FIELD_DESCRIPTORS[key];
        const current = draft[key] ?? value;
        const onChange = (next: unknown) => setDraft((d) => ({ ...d, [key]: next }));

        if (!descriptor) {
          // Unknown key — render read-only with note.
          return (
            <div key={key} className="space-y-1 opacity-70">
              <div className="font-display text-sm font-medium">{humaniseKey(key)}</div>
              <PortalFieldValue
                value={value}
                pathKey={key}
                activityKind={generated.activity_kind}
              />
              <p className="text-xs italic text-[hsl(var(--brand-ink-subtle))]">
                Unrecognised field — read-only in this editor.
              </p>
            </div>
          );
        }

        if (descriptor.type === 'text' && typeof current === 'string') {
          const limit = lookupCharLimit(generated.activity_kind, key);
          return (
            <TextFieldEditor
              key={key}
              activityId={activityId}
              fieldKey={key}
              value={current}
              limit={limit}
              onChange={(next) => onChange(next)}
            />
          );
        }

        if (descriptor.type === 'number') {
          const num = typeof current === 'number' ? current : Number(current ?? 0);
          return (
            <div key={key} className="space-y-1">
              <label className="font-display text-sm font-medium" htmlFor={`pf-${key}`}>
                {humaniseKey(key)}
              </label>
              <input
                id={`pf-${key}`}
                type="number"
                min={descriptor.min}
                value={Number.isFinite(num) ? num : 0}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full rounded-md border border-[hsl(var(--brand-line))] bg-background text-foreground px-3 py-2 text-sm"
                data-testid={`portal-field-edit-${key}`}
              />
            </div>
          );
        }

        if (descriptor.type === 'boolean') {
          const bool = current === true;
          return (
            <div key={key} className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bool}
                  onChange={(e) => onChange(e.target.checked)}
                  className="h-4 w-4 rounded border-[hsl(var(--brand-line))]"
                  data-testid={`portal-field-edit-${key}`}
                />
                <span className="font-display font-medium">{humaniseKey(key)}</span>
              </label>
            </div>
          );
        }

        if (descriptor.type === 'enum-single') {
          const selected = typeof current === 'string' ? current : '';
          return (
            <div key={key} className="space-y-1">
              <label className="font-display text-sm font-medium" htmlFor={`pf-${key}`}>
                {humaniseKey(key)}
              </label>
              <select
                id={`pf-${key}`}
                value={selected}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-md border border-[hsl(var(--brand-line))] bg-background text-foreground px-3 py-2 text-sm"
                data-testid={`portal-field-edit-${key}`}
              >
                {descriptor.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {humaniseKey(opt)}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (descriptor.type === 'enum-multi') {
          const selectedArr: string[] = Array.isArray(current)
            ? (current as unknown[]).filter((x): x is string => typeof x === 'string')
            : [];
          const toggle = (opt: string) => {
            const next = selectedArr.includes(opt)
              ? selectedArr.filter((x) => x !== opt)
              : [...selectedArr, opt];
            onChange(next);
          };
          return (
            <fieldset key={key} className="space-y-1">
              <legend className="font-display text-sm font-medium">{humaniseKey(key)}</legend>
              <div className="space-y-1">
                {descriptor.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedArr.includes(opt)}
                      onChange={() => toggle(opt)}
                      className="h-4 w-4 rounded border-[hsl(var(--brand-line))]"
                      data-testid={`portal-field-edit-${key}-${opt}`}
                    />
                    <span>{humaniseKey(opt)}</span>
                  </label>
                ))}
              </div>
              {selectedArr.length === 0 ? (
                <p className="text-xs italic text-destructive">
                  At least one value is required by the AusIndustry schema.
                </p>
              ) : null}
            </fieldset>
          );
        }

        if (descriptor.type === 'date-range') {
          const obj = (current ?? {}) as { start?: unknown; end?: unknown };
          const start = typeof obj.start === 'string' ? obj.start : '';
          const end = typeof obj.end === 'string' ? obj.end : '';
          const updatePair = (which: 'start' | 'end', dateStr: string) =>
            onChange({ ...obj, [which]: dateStr });
          return (
            <div key={key} className="space-y-1">
              <div className="font-display text-sm font-medium">{humaniseKey(key)}</div>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={start}
                  onChange={(e) => updatePair('start', e.target.value)}
                  className="rounded-md border border-[hsl(var(--brand-line))] bg-background text-foreground px-2 py-1 text-sm"
                  data-testid={`portal-field-edit-${key}-start`}
                />
                <span className="self-center text-sm text-[hsl(var(--brand-ink-subtle))]">to</span>
                <input
                  type="date"
                  value={end}
                  onChange={(e) => updatePair('end', e.target.value)}
                  className="rounded-md border border-[hsl(var(--brand-line))] bg-background text-foreground px-2 py-1 text-sm"
                  data-testid={`portal-field-edit-${key}-end`}
                />
              </div>
            </div>
          );
        }

        if (descriptor.type === 'dominant-purpose') {
          const limit = lookupCharLimit(generated.activity_kind, 'dominant_purpose.explanation');
          return (
            <div key={key} className="space-y-1">
              <TextFieldEditor
                activityId={activityId}
                fieldKey="dominant_purpose.explanation"
                value={explanation}
                limit={limit}
                onChange={(next) => setExplanation(next)}
                labelOverride={`${humaniseKey(key)} (explanation)`}
              />
              <p className="text-xs italic text-[hsl(var(--brand-ink-subtle))]">
                The dominant-purpose flag itself stays true — only the explanation is editable here.
              </p>
            </div>
          );
        }

        // uuid-array — read-only for now (cross-activity picker out of scope).
        return (
          <div key={key} className="space-y-1 opacity-70">
            <div className="font-display text-sm font-medium">{humaniseKey(key)}</div>
            <PortalFieldValue value={value} pathKey={key} activityKind={generated.activity_kind} />
            <p className="text-xs italic text-[hsl(var(--brand-ink-subtle))]">
              UUID arrays (activity bindings) need a cross-activity picker — not yet implemented.
            </p>
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving} data-testid="save-portal-fields">
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

/** Read the nested `dominant_purpose.explanation` string or empty. */
function readDominantPurposeExplanation(fields: Record<string, unknown>): string {
  const dp = fields['dominant_purpose'];
  if (dp && typeof dp === 'object' && 'explanation' in dp) {
    const explanation = (dp as { explanation?: unknown }).explanation;
    if (typeof explanation === 'string') return explanation;
  }
  return '';
}

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

type HistoryEntry = NonNullable<Activity['portal_fields_history']>[number];

/**
 * Collapsible "version history" panel.
 *
 * Renders entries newest-first (the server stores oldest-first, so we
 * `.slice().reverse()`). Each entry has a "Restore" action that re-uses
 * the existing PATCH endpoint — restoring a prior version is just an
 * edit whose body happens to be the historical `fields` object. This
 * means the restored entry also gets pushed onto history (recursive
 * provenance), so the consultant can always undo a restore.
 */
function PortalFieldsHistoryPanel({
  history,
  onRestore,
  isSaving,
}: {
  history: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
  isSaving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const reversed = [...history].reverse();

  return (
    <div className="rounded-md border border-[hsl(var(--brand-line))] p-3">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium"
        data-testid="portal-fields-history-toggle"
        aria-expanded={expanded}
      >
        <span>
          Version history ·{' '}
          <span className="text-[hsl(var(--brand-ink-subtle))]">
            {history.length} prior {history.length === 1 ? 'version' : 'versions'}
          </span>
        </span>
        <span className="text-xs text-[hsl(var(--brand-ink-subtle))]">
          {expanded ? '▾ collapse' : '▸ expand'}
        </span>
      </button>

      {expanded ? (
        <ul className="mt-3 space-y-2" data-testid="portal-fields-history-list">
          {reversed.map((entry, i) => {
            const fields = (entry.portal_fields['fields'] ?? {}) as Record<string, unknown>;
            const fieldsCount = Object.keys(fields).length;
            const date = new Date(entry.saved_at);
            return (
              <li
                key={`${entry.saved_at}-${i}`}
                className="flex items-center justify-between gap-3 rounded-sm border border-[hsl(var(--brand-line))] bg-[hsl(var(--brand-paper))] px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    {formatHistoryTimestamp(date)} ·{' '}
                    <span className="text-[hsl(var(--brand-ink-subtle))]">
                      {entry.source === 'agent' ? 'agent regenerated' : 'consultant edited'}
                    </span>
                  </span>
                  <span className="text-xs text-[hsl(var(--brand-ink-subtle))]">
                    {fieldsCount} fields captured
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRestore(entry)}
                  disabled={isSaving}
                  data-testid={`restore-portal-fields-${i}`}
                >
                  Restore
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TextFieldEditor — textarea + char-count badge + "Suggest shorter" button
// ---------------------------------------------------------------------------

/**
 * Reusable text-field editor for the portal-fields editor. Used both for
 * top-level text fields (description, hypothesis, …) and the special-cased
 * `dominant_purpose.explanation` nested field. When the draft exceeds the
 * portal char limit, a "Suggest shorter" button appears that calls the
 * trim endpoint and replaces the textarea value on success.
 *
 * The trim suggestion is a stateless transform — accepting it just updates
 * the local draft. The consultant still has to click Save to PATCH.
 */
function TextFieldEditor({
  activityId,
  fieldKey,
  value,
  limit,
  onChange,
  labelOverride,
}: {
  activityId: string;
  fieldKey: string;
  value: string;
  limit: number | null;
  onChange: (next: string) => void;
  labelOverride?: string;
}) {
  const { toast } = useToast();
  const overCap = limit !== null && value.length > limit;

  const trimMutation = useMutation<
    TrimPortalFieldResponse,
    Error,
    { current_text: string; target_max: number }
  >({
    mutationFn: ({ current_text, target_max }) =>
      trimPortalField(activityId, { field_key: fieldKey, current_text, target_max }),
    onSuccess: (result) => {
      // Apply the suggestion regardless of whether it perfectly hit the
      // cap — the consultant sees the new length via the char badge and
      // can iterate further or hand-edit. We toast a small caveat if the
      // model returned something longer than the target.
      onChange(result.trimmed);
      if (!result.meta.fits_cap || !result.meta.is_shorter) {
        toast({
          title: 'Suggestion applied — still over cap',
          description: `Model returned ${result.meta.trimmed_length} chars (target ${result.meta.target_max}). Try again or trim manually.`,
        });
      } else {
        toast({
          title: 'Trimmed',
          description: `${result.meta.original_length} → ${result.meta.trimmed_length} chars in ${(result.meta.elapsed_ms / 1000).toFixed(1)}s`,
        });
      }
    },
    onError: (err) => {
      toast({ variant: 'destructive', title: 'Trim suggestion failed', description: err.message });
    },
  });

  const onTrimClick = () => {
    if (limit === null) return;
    trimMutation.mutate({ current_text: value, target_max: limit });
  };

  return (
    <div className="space-y-1">
      <label className="font-display text-sm font-medium" htmlFor={`pf-${fieldKey}`}>
        {labelOverride ?? humaniseKey(fieldKey)}
      </label>
      <Textarea
        id={`pf-${fieldKey}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[100px]"
        data-testid={`portal-field-edit-${fieldKey}`}
      />
      <div className="flex items-center justify-between gap-2">
        {limit !== null ? <CharCountBadge length={value.length} limit={limit} /> : <span />}
        {overCap ? (
          <button
            type="button"
            onClick={onTrimClick}
            disabled={trimMutation.isPending}
            className="text-xs text-[hsl(var(--brand-ink))] underline underline-offset-2 hover:no-underline disabled:opacity-50"
            data-testid={`portal-field-trim-${fieldKey}`}
          >
            {trimMutation.isPending ? 'Asking Haiku…' : 'Suggest shorter version'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Compact relative+absolute timestamp. "5m ago · 09:14" reads better than
 * either format alone for a panel where consultants are scanning to find
 * a specific earlier version.
 */
function formatHistoryTimestamp(d: Date): string {
  const now = Date.now();
  const deltaSec = Math.max(0, Math.round((now - d.getTime()) / 1000));
  const rel =
    deltaSec < 60
      ? 'just now'
      : deltaSec < 3600
        ? `${Math.floor(deltaSec / 60)}m ago`
        : deltaSec < 86_400
          ? `${Math.floor(deltaSec / 3600)}h ago`
          : `${Math.floor(deltaSec / 86_400)}d ago`;
  const abs = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${rel} · ${abs}`;
}
