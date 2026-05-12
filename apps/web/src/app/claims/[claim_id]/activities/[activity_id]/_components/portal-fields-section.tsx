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
  type EditPortalFieldsResponse,
  type GeneratedPortalFields,
  type GeneratePortalFieldsResponse,
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
          generated={generated}
          onSave={(fields) => editMutation.mutate(fields)}
          onCancel={() => setIsEditing(false)}
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
          <dt className="font-display text-sm font-medium">{humaniseKey(key)}</dt>
          <dd className="text-sm">
            <PortalFieldValue value={value} pathKey={key} activityKind={generated.activity_kind} />
          </dd>
        </div>
      ))}
    </dl>
  );
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
// Editor — text fields only (MVP)
// ---------------------------------------------------------------------------

/**
 * Set of top-level keys whose value is a plain string for both kinds.
 * The editor renders these as textareas with live char-count indicators.
 * Anything not in this set stays read-only (enums, arrays, dates, nested
 * objects requiring dedicated controls).
 */
const EDITABLE_TEXT_KEYS = new Set([
  // Core
  'activity_name',
  'description',
  'sources_investigated',
  'why_competent_professional_couldnt_know',
  'hypothesis',
  'experiment',
  'evaluation',
  'conclusions',
  'new_knowledge_purpose',
  // Supporting
  'how_supports_core_rd',
  'evidence_kept',
]);

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
  generated,
  onSave,
  onCancel,
  isSaving,
}: {
  generated: GeneratedPortalFields;
  onSave: (fields: Record<string, unknown>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  // Local draft of every top-level key. We don't deep-clone — Object.values
  // are primitives (strings/numbers/bools) or arrays/objects that we re-
  // assign wholesale on edit, so structural sharing is fine.
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...generated.fields });
  // Local draft of the supporting-activity `dominant_purpose.explanation`
  // field. We surface it as its own textarea but persist by re-attaching
  // to the parent object on save.
  const initialExplanation = readDominantPurposeExplanation(generated.fields);
  const [explanation, setExplanation] = useState<string>(initialExplanation);

  const onTextChange = (key: string, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const onSubmit = () => {
    // Build the PATCH body: only changed keys.
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (generated.fields[k] !== v) changed[k] = v;
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
        const isEditableText = EDITABLE_TEXT_KEYS.has(key) && typeof value === 'string';
        if (isEditableText) {
          const current = (draft[key] ?? value) as string;
          const limit = lookupCharLimit(generated.activity_kind, key);
          return (
            <div key={key} className="space-y-1">
              <label className="font-display text-sm font-medium" htmlFor={`pf-${key}`}>
                {humaniseKey(key)}
              </label>
              <Textarea
                id={`pf-${key}`}
                value={current}
                onChange={(e) => onTextChange(key, e.target.value)}
                className="min-h-[100px]"
                data-testid={`portal-field-edit-${key}`}
              />
              {limit !== null ? <CharCountBadge length={current.length} limit={limit} /> : null}
            </div>
          );
        }
        // Special case: dominant_purpose.explanation (nested but text)
        if (key === 'dominant_purpose' && value && typeof value === 'object') {
          const limit = lookupCharLimit(generated.activity_kind, 'dominant_purpose.explanation');
          return (
            <div key={key} className="space-y-1">
              <label
                className="font-display text-sm font-medium"
                htmlFor="pf-dominant-purpose-explanation"
              >
                {humaniseKey(key)} (explanation)
              </label>
              <Textarea
                id="pf-dominant-purpose-explanation"
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                className="min-h-[100px]"
                data-testid="portal-field-edit-dominant-purpose-explanation"
              />
              {limit !== null ? <CharCountBadge length={explanation.length} limit={limit} /> : null}
              <p className="text-xs italic text-[hsl(var(--brand-ink-subtle))]">
                The dominant-purpose flag itself stays true — only the explanation is editable here.
              </p>
            </div>
          );
        }
        // Non-editable fields display the read-only renderer + a note.
        return (
          <div key={key} className="space-y-1 opacity-70">
            <div className="font-display text-sm font-medium">{humaniseKey(key)}</div>
            <PortalFieldValue value={value} pathKey={key} activityKind={generated.activity_kind} />
            <p className="text-xs italic text-[hsl(var(--brand-ink-subtle))]">
              Read-only in this editor. Re-generate to change.
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
