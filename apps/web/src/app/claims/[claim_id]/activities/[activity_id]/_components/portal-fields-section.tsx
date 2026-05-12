'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Activity } from '@cpa/schemas';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  generatePortalFields,
  type GeneratedPortalFields,
  type GeneratePortalFieldsResponse,
} from '../../_lib/api';

/**
 * AusIndustry portal-ready fields for an activity (draft-narrative@1.2.0).
 *
 * Two states:
 *   - Empty (`portal_fields = {}`): display CTA + Generate button.
 *   - Populated: render the 13 core / 9 supporting fields with a
 *     Re-generate button.
 *
 * Generation is long-running (~50-75s with Sonnet 4.5) — the button
 * goes into pending state and a toast surfaces success / failure.
 * On success, the activity query is invalidated so the display
 * re-fetches the canonical row and re-renders with the new fields.
 *
 * The display is **read-only** in this iteration. Editing the portal
 * fields server-side requires a PATCH route + an audit decision about
 * whether human edits should be versioned alongside agent generations;
 * that's a follow-up commit.
 */
export function PortalFieldsSection({ activity }: { activity: Activity }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isPopulated = isPortalFieldsPopulated(activity.portal_fields);
  const generated = isPopulated ? coercePortalFields(activity.portal_fields) : null;

  const mutation = useMutation<GeneratePortalFieldsResponse, Error>({
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

  return (
    <section className="space-y-4" data-testid="portal-fields-section">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-medium">AusIndustry portal fields</h2>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          data-testid="generate-portal-fields"
        >
          {mutation.isPending
            ? 'Generating… (~60s)'
            : generated
              ? 'Re-generate'
              : 'Generate portal fields'}
        </Button>
      </div>

      {!generated && !mutation.isPending ? (
        <p className="text-sm text-[hsl(var(--brand-ink-subtle))]">
          The portal-fields agent emits the {activity.kind === 'core' ? '13 core' : '9 supporting'}{' '}
          fields required by the AusIndustry registration form. Generation reads this
          activity&apos;s classified evidence and produces structured output ready to paste into the
          portal.
        </p>
      ) : null}

      {mutation.isPending ? (
        <p className="text-sm italic text-[hsl(var(--brand-ink-subtle))]">
          Calling Sonnet — this typically takes 50-75 seconds for {activity.kind} activities. The
          request will not be cancelled if you navigate away.
        </p>
      ) : null}

      {generated ? <PortalFieldsDisplay generated={generated} /> : null}
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
            <PortalFieldValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PortalFieldValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="italic text-[hsl(var(--brand-ink-subtle))]">(empty)</span>;
  }
  if (typeof value === 'string') {
    // Long strings get whitespace-pre-wrap so paragraph breaks survive.
    return <p className="whitespace-pre-wrap">{value}</p>;
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
            <PortalFieldValue value={item} />
          </li>
        ))}
      </ul>
    );
  }
  // Nested objects (e.g. `dates_conducted: {start, end}`,
  // `dominant_purpose: {is_dominant_purpose, explanation}`).
  return (
    <div className="ml-4 space-y-1">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="text-xs uppercase text-[hsl(var(--brand-ink-subtle))]">
            {humaniseKey(k)}:
          </span>
          <PortalFieldValue value={v} />
        </div>
      ))}
    </div>
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
