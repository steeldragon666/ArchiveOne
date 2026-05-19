'use client';

import { useState } from 'react';
import { EVIDENCE_TIMELINE, fmtAUD } from '@/lib/claimsure-data';
import type { EvidenceItem } from '@/lib/claimsure-data';
import {
  CsButton,
  CsChip,
  CsSectionHeader,
  CsSegmented,
  ConfidenceViz,
  CsAvatar,
} from '@/components/claimsure/primitives';
const KIND_LABELS: Record<string, string> = {
  hypothesis: 'Hypothesis',
  expenditure: 'Expenditure',
  evidence: 'Evidence',
  experiment: 'Experiment',
  consolidation: 'Consolidation',
};

const COLOR_MAP: Record<string, string> = {
  primary: 'var(--cs-primary-fixed-dim)',
  secondary: 'var(--cs-secondary-fixed-dim)',
  tertiary: 'var(--cs-tertiary-fixed-dim)',
  warn: 'var(--cs-warn)',
  success: 'var(--cs-success)',
};

export function TimelineClient() {
  const [view, setView] = useState('timeline');
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered =
    filter === 'all' ? EVIDENCE_TIMELINE : EVIDENCE_TIMELINE.filter((e) => e.kind === filter);

  return (
    <div className="max-w-[1200px] mx-auto space-y-10">
      <CsSectionHeader
        eyebrow="Contemporaneous Evidence"
        title={
          <>
            Evidence <span style={{ color: 'var(--cs-secondary-fixed-dim)' }}>&amp; Timeline</span>
          </>
        }
        sub="AI-indexed evidence chain for FY24-25. Each item is linked to an eligible R&D activity and assigned a confidence score."
        actions={
          <>
            <CsChip icon="verified" color="success">
              {EVIDENCE_TIMELINE.length} items indexed
            </CsChip>
            <CsButton icon="upload" variant="secondary" size="sm">
              Upload evidence
            </CsButton>
            <CsButton icon="auto_awesome" variant="ai" size="sm">
              AI Sweep
            </CsButton>
          </>
        }
      />

      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <CsSegmented value={view} onChange={setView} options={['timeline', 'grid', 'ledger']} />
        <div className="flex gap-2 flex-wrap">
          {['all', 'hypothesis', 'expenditure', 'evidence', 'experiment', 'consolidation'].map(
            (k) => (
              <CsChip
                key={k}
                color={filter === k ? 'primary' : 'default'}
                onClick={() => setFilter(k)}
                active={filter === k}
              >
                {k === 'all' ? 'All' : KIND_LABELS[k]}
              </CsChip>
            ),
          )}
        </div>
      </div>

      {view === 'timeline' && (
        <div className="relative">
          {/* Vertical line */}
          <div
            className="absolute left-[88px] top-0 bottom-0 w-px cs-timeline-line"
            style={{ opacity: 0.4 }}
          />
          <div className="space-y-6">
            {filtered.map((item) => (
              <TimelineCard
                key={item.id}
                item={item}
                expanded={expanded === item.id}
                onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {view === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => (
            <GridCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {view === 'ledger' && (
        <div className="cs-glass rounded-2xl overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {['Date', 'Kind', 'Title', 'Confidence', 'Amount'].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-semibold opacity-50"
                    style={{ color: 'var(--cs-on-surface-variant)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => (
                <tr
                  key={item.id}
                  style={{
                    borderBottom:
                      i < filtered.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                  }}
                  className="hover:bg-white/[0.02] transition-colors"
                >
                  <td
                    className="px-4 py-3 font-mono opacity-70"
                    style={{ color: 'var(--cs-on-surface-variant)' }}
                  >
                    {item.date}
                  </td>
                  <td className="px-4 py-3">
                    <CsChip
                      color={
                        item.color === 'primary'
                          ? 'primary'
                          : item.color === 'success'
                            ? 'success'
                            : item.color === 'warn'
                              ? 'warn'
                              : 'secondary'
                      }
                    >
                      {KIND_LABELS[item.kind]}
                    </CsChip>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--cs-on-surface)' }}>
                    {item.title}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="font-mono font-semibold"
                      style={{
                        color:
                          item.confidence >= 85
                            ? 'var(--cs-success)'
                            : item.confidence >= 70
                              ? 'var(--cs-warn)'
                              : 'var(--cs-error)',
                      }}
                    >
                      {item.confidence}%
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 font-mono"
                    style={{ color: 'var(--cs-tertiary-fixed-dim)' }}
                  >
                    {item.amount ? fmtAUD(item.amount) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TimelineCard({
  item,
  expanded,
  onToggle,
}: {
  item: EvidenceItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const color = COLOR_MAP[item.color] || COLOR_MAP.primary;

  return (
    <div className="flex gap-6">
      {/* Date stamp */}
      <div className="w-[72px] flex-shrink-0 text-right pt-4">
        <div className="font-mono font-bold text-[18px]" style={{ color }}>
          {item.monthLabel}
        </div>
        <div
          className="font-mono text-[11px] opacity-50"
          style={{ color: 'var(--cs-on-surface-variant)' }}
        >
          {item.year}
        </div>
      </div>

      {/* Dot */}
      <div className="relative flex-shrink-0 pt-5">
        <div
          className="w-4 h-4 rounded-full border-2 flex items-center justify-center z-10 relative"
          style={{
            background: 'var(--cs-surface)',
            borderColor: color,
            boxShadow: `0 0 10px ${color}60`,
          }}
        >
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        </div>
      </div>

      {/* Card */}
      <div
        className="flex-1 cs-glass rounded-2xl p-5 cursor-pointer transition-all hover:border-white/20"
        onClick={onToggle}
        style={
          expanded
            ? { border: `1px solid ${color}40`, boxShadow: `0 0 20px ${color}15` }
            : undefined
        }
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${color}18` }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18, color, fontVariationSettings: "'FILL' 1" }}
              >
                {item.icon}
              </span>
            </div>
            <div>
              <div className="font-semibold text-[14px]" style={{ color: 'var(--cs-on-surface)' }}>
                {item.title}
              </div>
              <div
                className="text-[12px] opacity-60 mt-0.5"
                style={{ color: 'var(--cs-on-surface-variant)' }}
              >
                {item.subtitle}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {item.amount && (
              <div className="text-right">
                <div
                  className="font-mono font-bold text-[14px]"
                  style={{ color: 'var(--cs-tertiary-fixed-dim)' }}
                >
                  {fmtAUD(item.amount)}
                </div>
              </div>
            )}
            <ConfidenceViz value={item.confidence} style="ring" compact />
            <span
              className="material-symbols-outlined transition-transform duration-200"
              style={{
                fontSize: 18,
                color: 'var(--cs-on-surface-variant)',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            >
              expand_more
            </span>
          </div>
        </div>

        {/* Tags */}
        {item.tags && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {item.tags.map((t) => (
              <CsChip key={t.label} icon={t.icon} color="secondary">
                {t.label}
              </CsChip>
            ))}
          </div>
        )}

        {/* Expanded */}
        {expanded && (
          <div className="mt-4 space-y-4 cs-page-in">
            {item.body && (
              <blockquote
                className="text-[13px] leading-relaxed pl-4 py-2 rounded-r-lg"
                style={{
                  color: 'var(--cs-on-surface-variant)',
                  borderLeft: `3px solid ${color}`,
                  background: `${color}08`,
                }}
              >
                {item.body}
              </blockquote>
            )}
            {item.people && (
              <div className="flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  {item.people.map((p) => (
                    <CsAvatar key={p} name={p} size={28} />
                  ))}
                </div>
                <span
                  className="text-[11px] opacity-50"
                  style={{ color: 'var(--cs-on-surface-variant)' }}
                >
                  {item.people.join(', ')}
                </span>
              </div>
            )}
            {item.stats && (
              <div className="flex gap-6">
                {item.stats.map((s) => (
                  <div key={s.label} className="text-center">
                    <div className="font-mono font-bold text-[18px]" style={{ color }}>
                      {s.value}
                    </div>
                    <div
                      className="text-[10px] uppercase tracking-wider opacity-50"
                      style={{ color: 'var(--cs-on-surface-variant)' }}
                    >
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <ConfidenceViz value={item.confidence} style="bar" label="Evidence confidence" />
          </div>
        )}
      </div>
    </div>
  );
}

function GridCard({ item }: { item: EvidenceItem }) {
  const color = COLOR_MAP[item.color] || COLOR_MAP.primary;
  return (
    <div className="cs-glass rounded-2xl p-5 space-y-3 hover:border-white/20 transition-all cursor-pointer">
      <div className="flex items-center justify-between">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: `${color}18` }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18, color, fontVariationSettings: "'FILL' 1" }}
          >
            {item.icon}
          </span>
        </div>
        <CsChip
          color={
            item.color === 'primary'
              ? 'primary'
              : item.color === 'success'
                ? 'success'
                : item.color === 'warn'
                  ? 'warn'
                  : 'secondary'
          }
        >
          {KIND_LABELS[item.kind]}
        </CsChip>
      </div>
      <div>
        <div className="font-semibold text-[13px]" style={{ color: 'var(--cs-on-surface)' }}>
          {item.title}
        </div>
        <div
          className="text-[11px] opacity-50 mt-1"
          style={{ color: 'var(--cs-on-surface-variant)' }}
        >
          {item.subtitle}
        </div>
      </div>
      {item.amount && (
        <div
          className="font-mono font-bold text-[14px]"
          style={{ color: 'var(--cs-tertiary-fixed-dim)' }}
        >
          {fmtAUD(item.amount)}
        </div>
      )}
      <ConfidenceViz value={item.confidence} style="bar" compact />
      <div
        className="font-mono text-[10px] opacity-40"
        style={{ color: 'var(--cs-on-surface-variant)' }}
      >
        {item.date}
      </div>
    </div>
  );
}
