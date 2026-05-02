/**
 * Segment validator for Agent C's δ hybrid audit anchor.
 *
 * The narrative drafter streams output via repeated `emit_segment`
 * tool calls. The orchestrator's validate-and-correct loop runs
 * `validateSegment` on EACH call: accept the segment and append it
 * to the running draft, or reject it, surface `reason` back to the
 * model, and ask it to retry that one segment. Per-segment
 * validation keeps retries cheap (no whole-section restream) and
 * gives the model immediate, localised feedback.
 *
 * ## Why claim segments must cite events (the δ hybrid audit anchor)
 *
 * The δ hybrid design splits narrative into two segment kinds:
 *
 * - **`claim`** — a factual assertion that, under audit, must be
 *   anchored to source evidence. Every claim therefore MUST carry
 *   one or more `citing_events`, each of which is the id of an
 *   event already in the parent activity's clustered set. The
 *   assurance report renders these as the evidence drawer beneath
 *   each claim; the auditor uses the chain of events to reconstruct
 *   what the consultant saw.
 *
 * - **`prose`** — definitions, statutory bridges, transitions, and
 *   other connective tissue that does not state activity-specific
 *   facts and therefore needs no audit anchor. Prose is left
 *   unrestricted on purpose: forcing citations on definitional or
 *   linking text would inflate the citation graph with meaningless
 *   edges or push the model toward citing irrelevant events.
 *
 * ## Citation scope: only events in this activity's cluster
 *
 * `clusteredEventIds` is the set of `event.id`s drawn from the
 * parent activity's `ACTIVITY_REGISTER_DRAFTED` cluster. A claim
 * may only cite events INSIDE that set — out-of-scope citations
 * would let one activity's narrative anchor itself to another
 * activity's evidence, breaking the per-activity audit trail and
 * the assurance-report drawer rendering.
 *
 * ## Soft-warn case: prose with unexpected `citing_events`
 *
 * The Zod wire schema for `emit_segment` (see
 * `prompts/segment-schema.ts`) uses `.strict()` on each variant, so
 * the parser already rejects a `prose` payload that carries
 * `citing_events`. A defensively-validated post-parse value should
 * therefore never reach this branch in production. We still check
 * it: the spec says "warn but not fail — soft-rejected at
 * orchestrator level", so the validator surfaces a non-fatal
 * `warnings` entry on the success result rather than failing.
 * Failing here would make the model fight a structural signal the
 * schema layer already neutralised; the orchestrator (Task 5.4)
 * can record it as telemetry.
 *
 * ## Local type declaration
 *
 * The shape mirrors `NarrativeSegment` from `@cpa/schemas/event.ts`
 * but is redeclared here because `@cpa/agents` deliberately does
 * not depend on `@cpa/schemas` (see `package.json` deps and the
 * comment in `./types.ts`). Keep this in sync with the persisted
 * segment shape if either side changes.
 *
 * ## Purity
 *
 * Pure function: no DB access, no I/O, no mutation of the input
 * set. The `ReadonlySet` parameter type makes the no-mutate
 * contract explicit at the type level.
 */

/** Local mirror of `NarrativeSegment` from `@cpa/schemas/event.ts`. */
export type NarrativeSegment =
  | { type: 'prose'; text: string }
  | { type: 'claim'; text: string; citing_events: readonly string[] };

/**
 * Result of validating a single `NarrativeSegment` against an
 * activity's clustered-event scope.
 *
 * - `ok: true` — segment passed structural + scope checks. May
 *   carry soft `warnings` (non-fatal observations the orchestrator
 *   can record as telemetry without rejecting the segment).
 * - `ok: false` — segment violated a hard rule. `reason` is a
 *   short human-readable string suitable for both logs and the
 *   model-facing retry prompt in the validate-and-correct loop.
 */
export type SegmentValidation = { ok: true; warnings?: string[] } | { ok: false; reason: string };

/**
 * Validate ONE narrative segment against the parent activity's
 * clustered-event id set.
 *
 * @param seg                The segment emitted by the drafter.
 * @param clusteredEventIds  The activity's clustered event id set
 *                           (read-only). Must contain every event
 *                           a claim segment cites.
 * @returns                  `{ ok: true }` (optionally with
 *                           `warnings`) on success, or
 *                           `{ ok: false, reason }` on failure.
 */
export function validateSegment(
  seg: NarrativeSegment,
  clusteredEventIds: ReadonlySet<string>,
): SegmentValidation {
  if (seg.type === 'claim') {
    if (!seg.citing_events || seg.citing_events.length === 0) {
      return { ok: false, reason: 'claim segment missing citing_events' };
    }
    for (const id of seg.citing_events) {
      if (!clusteredEventIds.has(id)) {
        return {
          ok: false,
          reason: `cites event ${id} outside this activity's clustered_events`,
        };
      }
    }
    return { ok: true };
  }

  // prose — soft-warn on unexpected citing_events, never fail.
  // The `.strict()` Zod parse upstream should have stripped/rejected
  // this, but we defend against post-parse mutation and ad-hoc
  // callers passing raw payloads.
  const stray = (seg as { citing_events?: readonly string[] }).citing_events;
  if (stray && stray.length > 0) {
    return {
      ok: true,
      warnings: [
        `prose segment carried ${stray.length} unexpected citing_events; orchestrator may strip or telemeter`,
      ],
    };
  }

  return { ok: true };
}
