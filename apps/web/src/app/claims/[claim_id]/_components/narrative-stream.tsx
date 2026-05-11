'use client';

/**
 * "Building narrative" section of the Live Analysis panel.
 *
 * Renders the synthesised prose narrative paragraph by paragraph with
 * inline citation superscripts (¹, ²…) and a footnote footer.
 *
 * Two modes:
 *
 *   live=true  — paragraphs fade in with a 200ms stagger between them,
 *                giving the impression the AI is writing in real time.
 *                Used when the user has just hit Re-run.
 *
 *   live=false — all paragraphs render immediately at full opacity.
 *                Used on initial load when classifications already exist.
 *
 * Data source priority:
 *   1. Real narrative from narrative-drafter agent: present when any
 *      classified event carries classification.payload.narrative or
 *      classification.payload.narrative_segments. This is the eventual
 *      steady-state — the narrative-drafter writes this, the panel
 *      surfaces it verbatim.
 *   2. Synthetic fallback: client-side derivation via deriveSyntheticNarrative()
 *      in analysis-api.ts. Used when (1) is not available. Documented inline
 *      so the swap-in point is clear — when the narrative-drafter output
 *      arrives, remove the synthetic fallback and consume (1) directly.
 *
 * Citation superscripts link to either:
 *   - An activity detail page (/claims/<id>/activities/<aid>), or
 *   - An event drawer (via onOpenEventDetail callback).
 *
 * The footnote anchor text is verbatim from Citation.label — no AI
 * transformation (Body-by-Michael compliance: narrative text rendered
 * here comes from the stored narrative_segment.text or from the pure
 * deriveSyntheticNarrative() aggregation, neither of which is an LLM
 * call at render time).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AnalysisEvent, Citation, SyntheticNarrative } from '../_lib/analysis-api';
import { deriveSyntheticNarrative } from '../_lib/analysis-api';

// Convert 1-based citation index to Unicode superscript string.
const SUPERSCRIPTS = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
function toSuperscript(n: number): string {
  return SUPERSCRIPTS[n - 1] ?? `[${n}]`;
}

// -------------------------------------------------------------------------
// Paragraph renderer — inserts citation anchors into prose
// -------------------------------------------------------------------------

/**
 * Render prose text with [N] citation markers replaced by superscript links.
 * Pattern: [1], [2] etc. in the text are replaced with ¹²… anchors.
 */
function ProseWithCitations({
  text,
  citations,
  claimId,
  onCitationClick,
}: {
  text: string;
  citations: Citation[];
  claimId: string;
  onCitationClick: (citation: Citation) => void;
}) {
  const citationMap = new Map<number, Citation>(citations.map((c) => [c.index, c]));
  // Split on [N] markers
  const parts = text.split(/(\[\d+\])/g);

  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const idx = parseInt(match[1]!, 10);
          const citation = citationMap.get(idx);
          if (!citation) {
            return (
              <sup key={i} className="text-[hsl(var(--brand-ink-subtle))] text-[9px]">
                {toSuperscript(idx)}
              </sup>
            );
          }
          // If citation has an activity_id, link to the activity page.
          if (citation.activity_id) {
            return (
              <Link
                key={i}
                href={`/claims/${claimId}/activities/${citation.activity_id}`}
                className="text-[hsl(var(--brand-accent))] hover:text-[hsl(var(--brand-accent-strong))] transition-colors"
                title={citation.label}
              >
                <sup className="text-[9px] underline underline-offset-1">{toSuperscript(idx)}</sup>
              </Link>
            );
          }
          // Otherwise trigger the event detail drawer.
          return (
            <button
              key={i}
              type="button"
              onClick={() => onCitationClick(citation)}
              className="text-[hsl(var(--brand-accent))] hover:text-[hsl(var(--brand-accent-strong))] transition-colors"
              title={citation.label}
            >
              <sup className="text-[9px] underline underline-offset-1">{toSuperscript(idx)}</sup>
            </button>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// -------------------------------------------------------------------------
// Citation footer
// -------------------------------------------------------------------------

function CitationFooter({
  citations,
  claimId,
  onEventClick,
}: {
  citations: Citation[];
  claimId: string;
  onEventClick: (citation: Citation) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-4 border-t border-[hsl(var(--brand-hairline))] pt-3 space-y-1">
      {citations.map((c) => (
        <div key={c.index} className="flex items-baseline gap-2 text-xs">
          <span className="flex-none text-[hsl(var(--brand-ink-muted))] font-mono w-4 text-right">
            {toSuperscript(c.index)}
          </span>
          <span className="flex-1 text-[hsl(var(--brand-ink-muted))]">{c.label}</span>
          {c.activity_id ? (
            <Link
              href={`/claims/${claimId}/activities/${c.activity_id}`}
              className="flex-none text-[hsl(var(--brand-accent))] hover:underline whitespace-nowrap"
            >
              view →
            </Link>
          ) : c.event_id ? (
            <button
              type="button"
              onClick={() => onEventClick(c)}
              className="flex-none text-[hsl(var(--brand-accent))] hover:underline whitespace-nowrap"
            >
              view →
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------------
// Main component
// -------------------------------------------------------------------------

export interface NarrativeStreamProps {
  claimId: string;
  events: AnalysisEvent[];
  /** When true, paragraphs animate in with a 200ms stagger. */
  live: boolean;
  /** Called when user clicks a citation that links to an event (not an activity). */
  onCitationEventClick?: (citation: Citation) => void;
}

export function NarrativeStream({
  claimId,
  events,
  live,
  onCitationEventClick,
}: NarrativeStreamProps) {
  // Derive narrative — real or synthetic.
  // Priority:
  //   1. Real narrative segments from any classified event's payload
  //      (narrative-drafter output). When this path is taken, the
  //      synthetic fallback is bypassed.
  //   2. Synthetic client-side derivation.
  //
  // TODO: when narrative-drafter output is available in
  //   event.classification.payload.narrative_segments
  // replace this block with a direct read of those segments and remove
  // the deriveSyntheticNarrative() call. The CitationFooter/ProseWithCitations
  // components already accept the Citation[] shape that narrative-drafter
  // emits, so the swap is a data-source change only.
  const realNarrative: SyntheticNarrative | null = (() => {
    for (const ae of events) {
      const segs = ae.classification?.narrative_segments;
      if (segs && segs.length > 0) {
        // Flatten narrative-drafter segments into our SyntheticNarrative shape.
        const allCitations: Citation[] = segs.flatMap((s) => s.citations);
        return {
          paragraphs: segs.map((s) => ({
            text: s.text,
            citationIndices: s.citations.map((c) => c.index),
          })),
          citations: allCitations,
        };
      }
    }
    return null;
  })();

  const narrative = realNarrative ?? deriveSyntheticNarrative(events);

  // Visibility state for each paragraph (live stagger).
  // In non-live mode, all paragraphs are visible immediately.
  const [visibleCount, setVisibleCount] = useState(live ? 0 : narrative.paragraphs.length);

  useEffect(() => {
    if (!live) {
      setVisibleCount(narrative.paragraphs.length);
      return;
    }
    // Reset and stagger in
    setVisibleCount(0);
    let i = 0;
    const tick = () => {
      i++;
      setVisibleCount(i);
      if (i < narrative.paragraphs.length) {
        setTimeout(tick, 200);
      }
    };
    // First paragraph appears after a short lead-in so the section
    // heading has a moment to settle.
    const leadIn = setTimeout(tick, 400);
    return () => {
      clearTimeout(leadIn);
    };
  }, [live, narrative.paragraphs.length]);

  if (narrative.paragraphs.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--brand-ink-subtle))] italic">
        Narrative will populate as evidence is classified.
      </p>
    );
  }

  return (
    <div>
      <div className="space-y-3">
        {narrative.paragraphs.map((para, idx) => {
          const visible = idx < visibleCount;
          return (
            <p
              key={idx}
              className="text-sm text-[hsl(var(--brand-ink))] leading-relaxed"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(4px)',
                transition: 'opacity 300ms ease, transform 300ms ease',
              }}
            >
              <ProseWithCitations
                text={para.text}
                citations={narrative.citations}
                claimId={claimId}
                onCitationClick={(c) => onCitationEventClick?.(c)}
              />
            </p>
          );
        })}
      </div>

      <CitationFooter
        citations={narrative.citations}
        claimId={claimId}
        onEventClick={(c) => onCitationEventClick?.(c)}
      />
    </div>
  );
}
