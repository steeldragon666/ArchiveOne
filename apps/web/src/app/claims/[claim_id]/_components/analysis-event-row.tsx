'use client';

/**
 * Per-evidence row for the "Reading evidence" section of the Live Analysis panel.
 *
 * States:
 *   queued     — ◌ grey, filename muted, no chip
 *   reading    — ⟳ terracotta (spinning), filename normal, "Reading…" label
 *   classified — ✓ patina green, filename bold, kind chip + confidence %
 *   error      — ✗ clay red, "Classification failed"
 *
 * Hover: tooltip over the row showing extracted facts (dates, amounts,
 * parties) from classification.extracted_facts.
 *
 * Click: calls onOpenDetail so the parent can open a drawer/modal with
 * the full classification + raw text.
 *
 * Icon shape varies by classified kind — these map to Unicode glyphs
 * that approximate physical document shapes without pulling in an icon
 * library (no new deps constraint).
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { AnalysisEvent, ClassifiableKind } from '../_lib/analysis-api';

// -------------------------------------------------------------------------
// Kind → document icon
// -------------------------------------------------------------------------

const KIND_ICON: Record<ClassifiableKind, string> = {
  HYPOTHESIS: '🔬',
  DESIGN: '📐',
  EXPERIMENT: '⚗️',
  OBSERVATION: '🔭',
  ITERATION: '🔁',
  NEW_KNOWLEDGE: '💡',
  UNCERTAINTY: '❓',
  TIME_LOG: '⏱',
  ASSOCIATE_FLAG: '🏷',
  EXPENDITURE_NOTE: '🧾',
  SUPPORTING: '📎',
  INELIGIBLE: '🚫',
};

const KIND_LABEL: Record<ClassifiableKind, string> = {
  HYPOTHESIS: 'Hypothesis',
  DESIGN: 'Design',
  EXPERIMENT: 'Experiment',
  OBSERVATION: 'Observation',
  ITERATION: 'Iteration',
  NEW_KNOWLEDGE: 'New knowledge',
  UNCERTAINTY: 'Uncertainty',
  TIME_LOG: 'Time log',
  ASSOCIATE_FLAG: 'Associate flag',
  EXPENDITURE_NOTE: 'Expenditure',
  SUPPORTING: 'Supporting',
  INELIGIBLE: 'Ineligible',
};

// -------------------------------------------------------------------------
// Kind chip
// -------------------------------------------------------------------------

// Static class map — Tailwind needs literal strings at build time.
const KIND_CHIP_STYLES: Record<ClassifiableKind, string> = {
  HYPOTHESIS: 'bg-blue-50 text-blue-700 border-blue-200',
  DESIGN: 'bg-blue-50 text-blue-700 border-blue-200',
  UNCERTAINTY: 'bg-blue-50 text-blue-700 border-blue-200',
  EXPERIMENT:
    'bg-[hsl(var(--brand-accent-subtle))] text-[hsl(var(--brand-accent-strong))] border-[hsl(var(--brand-hairline-strong))]',
  OBSERVATION:
    'bg-[hsl(var(--brand-accent-subtle))] text-[hsl(var(--brand-accent-strong))] border-[hsl(var(--brand-hairline-strong))]',
  ITERATION:
    'bg-[hsl(var(--brand-accent-subtle))] text-[hsl(var(--brand-accent-strong))] border-[hsl(var(--brand-hairline-strong))]',
  NEW_KNOWLEDGE:
    'bg-[hsl(var(--brand-accent-subtle))] text-[hsl(var(--brand-accent-strong))] border-[hsl(var(--brand-hairline-strong))]',
  TIME_LOG: 'bg-amber-50 text-amber-700 border-amber-200',
  ASSOCIATE_FLAG: 'bg-amber-50 text-amber-700 border-amber-200',
  EXPENDITURE_NOTE: 'bg-amber-50 text-amber-700 border-amber-200',
  SUPPORTING: 'bg-amber-50 text-amber-700 border-amber-200',
  INELIGIBLE: 'bg-red-50 text-red-700 border-red-200',
};

function KindChip({ kind, confidence }: { kind: ClassifiableKind; confidence: number }) {
  const pct = Math.round(confidence * 100);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium font-mono tabular-nums',
        KIND_CHIP_STYLES[kind],
      )}
    >
      {KIND_LABEL[kind]}
      <span className="opacity-70">{pct}%</span>
    </span>
  );
}

// -------------------------------------------------------------------------
// State indicator
// -------------------------------------------------------------------------

function StateIndicator({ state }: { state: AnalysisEvent['state'] }) {
  if (state === 'queued') {
    return (
      <span
        aria-label="Queued"
        className="flex h-5 w-5 items-center justify-center rounded-full border border-[hsl(var(--brand-hairline-strong))] text-[hsl(var(--brand-ink-subtle))]"
      >
        <span className="h-2 w-2 rounded-full border border-current" />
      </span>
    );
  }
  if (state === 'reading') {
    return (
      <span
        aria-label="Reading"
        className="flex h-5 w-5 items-center justify-center text-[hsl(var(--brand-warning))]"
        style={{ animation: 'spin 1s linear infinite' }}
      >
        ⟳
      </span>
    );
  }
  if (state === 'classified') {
    return (
      <span
        aria-label="Classified"
        className="flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--brand-accent-subtle))] text-[hsl(var(--brand-accent-strong))] text-xs font-bold"
      >
        ✓
      </span>
    );
  }
  // error
  return (
    <span
      aria-label="Error"
      className="flex h-5 w-5 items-center justify-center rounded-full bg-red-50 text-red-600 text-xs font-bold"
    >
      ✗
    </span>
  );
}

// -------------------------------------------------------------------------
// Extracted-facts tooltip
// -------------------------------------------------------------------------

function FactsTooltip({ ae }: { ae: AnalysisEvent }) {
  const facts = ae.classification?.extracted_facts;
  if (!facts) return null;

  const rows: Array<[string, string]> = [];
  if (facts.dates?.length) rows.push(['Dates', facts.dates.slice(0, 3).join(', ')]);
  if (facts.amounts?.length) rows.push(['Amounts', facts.amounts.slice(0, 3).join(', ')]);
  if (facts.parties?.length) rows.push(['Parties', facts.parties.slice(0, 3).join(', ')]);
  if (facts.hypothesis_formed_at) rows.push(['Hypothesis', facts.hypothesis_formed_at]);

  if (rows.length === 0) return null;

  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded border border-[hsl(var(--brand-hairline))] bg-[hsl(var(--brand-base))] px-2.5 py-2 text-xs shadow-sm">
      {rows.map(([label, value]) => (
        <>
          <dt key={`dt-${label}`} className="text-[hsl(var(--brand-ink-muted))] whitespace-nowrap">
            {label}
          </dt>
          <dd key={`dd-${label}`} className="font-mono text-[hsl(var(--brand-ink))]">
            {value}
          </dd>
        </>
      ))}
    </dl>
  );
}

// -------------------------------------------------------------------------
// Main component
// -------------------------------------------------------------------------

export interface AnalysisEventRowProps {
  ae: AnalysisEvent;
  /** Called when the user clicks the row to open the detail drawer. */
  onOpenDetail: (ae: AnalysisEvent) => void;
  /** Stagger delay for the appearing animation (ms). */
  appearDelay?: number;
}

export function AnalysisEventRow({ ae, onOpenDetail, appearDelay = 0 }: AnalysisEventRowProps) {
  const [showFacts, setShowFacts] = useState(false);

  const isQueued = ae.state === 'queued';
  const isReading = ae.state === 'reading';
  const isClassified = ae.state === 'classified';

  const icon = ae.classification ? KIND_ICON[ae.classification.kind] : '📄';

  return (
    <li
      className="group relative"
      style={{
        opacity: isQueued ? 0.45 : 1,
        transition: `opacity 300ms ease ${appearDelay}ms`,
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (isClassified) onOpenDetail(ae);
        }}
        onMouseEnter={() => setShowFacts(true)}
        onMouseLeave={() => setShowFacts(false)}
        disabled={!isClassified}
        aria-label={`${ae.filename} — ${ae.state}`}
        className={cn(
          'flex w-full items-center gap-3 rounded px-2 py-1.5 text-left transition-colors',
          isClassified && 'hover:bg-[hsl(var(--brand-accent-subtle)/0.4)] cursor-pointer',
          !isClassified && 'cursor-default',
        )}
      >
        {/* Document type icon */}
        <span className="flex-none w-5 text-center text-sm select-none" aria-hidden>
          {isQueued ? '📄' : icon}
        </span>

        {/* Filename */}
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-sm font-mono',
            isQueued && 'text-[hsl(var(--brand-ink-subtle))]',
            isReading && 'text-[hsl(var(--brand-warning))]',
            isClassified && 'text-[hsl(var(--brand-ink))] font-medium',
            ae.state === 'error' && 'text-[hsl(var(--brand-error))]',
          )}
        >
          {ae.filename}
        </span>

        {/* Classification chip or status label */}
        <span className="flex-none">
          {isQueued && (
            <span className="text-[10px] text-[hsl(var(--brand-ink-subtle))] font-mono">
              Queued
            </span>
          )}
          {isReading && (
            <span className="text-[10px] text-[hsl(var(--brand-warning))] font-mono animate-pulse">
              Reading…
            </span>
          )}
          {isClassified && ae.classification && (
            <KindChip kind={ae.classification.kind} confidence={ae.classification.confidence} />
          )}
          {ae.state === 'error' && (
            <span className="text-[10px] text-[hsl(var(--brand-error))] font-mono">Failed</span>
          )}
        </span>

        {/* State dot */}
        <span className="flex-none">
          <StateIndicator state={ae.state} />
        </span>
      </button>

      {/* Extracted facts tooltip — appears on hover for classified items */}
      {showFacts && isClassified && (
        <div className="absolute left-8 top-full z-10 w-72">
          <FactsTooltip ae={ae} />
        </div>
      )}
    </li>
  );
}
