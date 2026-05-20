'use client';

import { useState } from 'react';
import { ENGINEERS, PROJECTS, fmtAUD } from '@/lib/claimsure-data';
import {
  CsButton,
  CsChip,
  CsAvatar,
  CsSectionHeader,
  ConfidenceViz,
} from '@/components/claimsure/primitives';

type Engineer = (typeof ENGINEERS)[number] & { rdPctOverride?: number };

export function AllocationClient() {
  const [engineers, setEngineers] = useState<Engineer[]>(ENGINEERS);
  const [activeEng, setActiveEng] = useState<string | null>(null);

  function updateRdPct(id: string, pct: number) {
    setEngineers((prev) => prev.map((e) => (e.id === id ? { ...e, rdPctOverride: pct } : e)));
  }

  const totalRDSalary = engineers.reduce((sum, e) => {
    const pct = e.rdPctOverride ?? e.rdPct;
    return sum + Math.round((e.salary * pct) / 100);
  }, 0);

  return (
    <div className="max-w-[1300px] mx-auto space-y-10">
      <CsSectionHeader
        eyebrow="s.355-25 ITAA 1997"
        title={
          <>
            Activity <span style={{ color: 'var(--cs-secondary-fixed-dim)' }}>Allocation</span>
          </>
        }
        sub="Allocate engineer time between R&D core, supporting, and BAU activities. Changes recalculate the notional deduction in real time."
        actions={
          <>
            <CsChip icon="calculate" color="secondary">
              {fmtAUD(totalRDSalary, { compact: true })} R&D salary
            </CsChip>
            <CsButton icon="save" variant="secondary" size="sm">
              Save snapshot
            </CsButton>
            <CsButton icon="auto_awesome" variant="ai" size="sm">
              AI suggest
            </CsButton>
          </>
        }
      />

      {/* Summary bar */}
      <div className="cs-glass rounded-2xl p-5 grid grid-cols-3 gap-6">
        {[
          { label: 'Total engineers', value: String(ENGINEERS.length), sub: 'across all projects' },
          {
            label: 'Avg R&D allocation',
            value: `${Math.round(engineers.reduce((s, e) => s + (e.rdPctOverride ?? e.rdPct), 0) / engineers.length)}%`,
            sub: 'of total hours',
          },
          {
            label: 'Eligible salary pool',
            value: fmtAUD(totalRDSalary, { compact: true }),
            sub: 'subject to s.355-25',
          },
        ].map((item) => (
          <div key={item.label} className="text-center">
            <div
              className="font-jakarta font-extrabold text-[28px]"
              style={{ color: 'var(--cs-primary-fixed-dim)' }}
            >
              {item.value}
            </div>
            <div
              className="text-[11px] uppercase tracking-widest opacity-50 mt-0.5"
              style={{ color: 'var(--cs-on-surface-variant)' }}
            >
              {item.label}
            </div>
            <div
              className="text-[11px] opacity-40 mt-0.5"
              style={{ color: 'var(--cs-on-surface-variant)' }}
            >
              {item.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Engineer cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {engineers.map((eng) => {
          const pct = eng.rdPctOverride ?? eng.rdPct;
          const rdSalary = Math.round((eng.salary * pct) / 100);
          const isActive = activeEng === eng.id;

          return (
            <div
              key={eng.id}
              className="cs-glass rounded-2xl p-5 transition-all cursor-pointer"
              style={
                isActive
                  ? {
                      border: '1px solid rgba(70,72,212,0.40)',
                      boxShadow: '0 0 24px rgba(70,72,212,0.12)',
                    }
                  : undefined
              }
              onClick={() => setActiveEng(isActive ? null : eng.id)}
            >
              <div className="flex items-start gap-3 mb-4">
                <CsAvatar name={eng.name} size={40} />
                <div className="flex-1">
                  <div
                    className="font-semibold text-[14px]"
                    style={{ color: 'var(--cs-on-surface)' }}
                  >
                    {eng.name}
                  </div>
                  <div
                    className="text-[11px] opacity-50 mt-0.5"
                    style={{ color: 'var(--cs-on-surface-variant)' }}
                  >
                    {eng.role}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="font-mono font-bold text-[14px]"
                    style={{ color: 'var(--cs-primary-fixed-dim)' }}
                  >
                    {fmtAUD(rdSalary, { compact: true })}
                  </div>
                  <div
                    className="text-[10px] opacity-40 mt-0.5"
                    style={{ color: 'var(--cs-on-surface-variant)' }}
                  >
                    R&D portion
                  </div>
                </div>
              </div>

              {/* R&D allocation slider */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span
                    className="text-[11px] uppercase tracking-widest opacity-60"
                    style={{ color: 'var(--cs-on-surface-variant)' }}
                  >
                    R&D allocation
                  </span>
                  <span
                    className="font-mono font-bold text-[15px]"
                    style={{
                      color:
                        pct >= 70
                          ? 'var(--cs-success)'
                          : pct >= 50
                            ? 'var(--cs-warn)'
                            : 'var(--cs-error)',
                    }}
                  >
                    {pct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={pct}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    updateRdPct(eng.id, Number(e.target.value));
                  }}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--cs-primary-fixed-dim) ${pct}%, rgba(255,255,255,0.10) ${pct}%)`,
                    accentColor: 'var(--cs-primary-fixed-dim)',
                  }}
                />
                {/* Stacked bar */}
                <div className="h-2 w-full rounded-full overflow-hidden flex gap-0.5">
                  <div
                    className="rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: 'var(--cs-primary-fixed-dim)' }}
                  />
                  <div
                    className="rounded-full flex-1"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                  />
                </div>
                <div
                  className="flex justify-between text-[10px] opacity-40"
                  style={{ color: 'var(--cs-on-surface-variant)' }}
                >
                  <span>R&D {pct}%</span>
                  <span>BAU {100 - pct}%</span>
                </div>
              </div>

              {/* Expanded detail */}
              {isActive && (
                <div className="mt-4 space-y-3 cs-page-in">
                  <div
                    className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
                    style={{ background: 'rgba(70,72,212,0.07)' }}
                  >
                    <span
                      className="material-symbols-outlined flex-shrink-0 mt-0.5"
                      style={{
                        fontSize: 13,
                        color: 'var(--cs-primary-fixed-dim)',
                        fontVariationSettings: "'FILL' 1",
                      }}
                    >
                      auto_awesome
                    </span>
                    <p
                      className="text-[11px] leading-relaxed"
                      style={{ color: 'var(--cs-on-surface-variant)' }}
                    >
                      {eng.aiNote}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div
                      className="rounded-xl p-3"
                      style={{ background: 'rgba(255,255,255,0.04)' }}
                    >
                      <div
                        className="text-[10px] opacity-50 mb-1"
                        style={{ color: 'var(--cs-on-surface-variant)' }}
                      >
                        Total salary
                      </div>
                      <div
                        className="font-mono font-semibold text-[13px]"
                        style={{ color: 'var(--cs-on-surface)' }}
                      >
                        {fmtAUD(eng.salary)}
                      </div>
                    </div>
                    <div
                      className="rounded-xl p-3"
                      style={{ background: 'rgba(255,255,255,0.04)' }}
                    >
                      <div
                        className="text-[10px] opacity-50 mb-1"
                        style={{ color: 'var(--cs-on-surface-variant)' }}
                      >
                        R&D hours
                      </div>
                      <div
                        className="font-mono font-semibold text-[13px]"
                        style={{ color: 'var(--cs-on-surface)' }}
                      >
                        {eng.hours.toLocaleString()}h
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Activity method breakdown */}
      <div className="cs-glass rounded-2xl p-6">
        <h3
          className="font-jakarta font-bold text-[18px] mb-6"
          style={{ color: 'var(--cs-on-surface)' }}
        >
          Activity Method Breakdown
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PROJECTS.map((p) => (
            <div key={p.id} className="space-y-3">
              <div className="flex items-center gap-2">
                <CsChip color={p.color}>{p.code}</CsChip>
              </div>
              <div className="text-[12px] font-semibold" style={{ color: 'var(--cs-on-surface)' }}>
                {p.name}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: 'var(--cs-on-surface-variant)' }}>Core activities</span>
                  <span
                    className="font-mono font-semibold"
                    style={{ color: 'var(--cs-primary-fixed-dim)' }}
                  >
                    {p.coreActivities}
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: 'var(--cs-on-surface-variant)' }}>
                    Supporting activities
                  </span>
                  <span
                    className="font-mono font-semibold"
                    style={{ color: 'var(--cs-secondary-fixed-dim)' }}
                  >
                    {p.supportingActivities}
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: 'var(--cs-on-surface-variant)' }}>Evidence items</span>
                  <span
                    className="font-mono font-semibold"
                    style={{ color: 'var(--cs-on-surface)' }}
                  >
                    {p.contemporaneousEvidence}
                  </span>
                </div>
                <ConfidenceViz value={p.confidence} style="bar" compact />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
