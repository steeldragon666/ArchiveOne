'use client';

import { useState } from 'react';
import {
  COMPANY,
  PROJECTS,
  ENGINEERS,
  EXPENDITURE_CATEGORIES,
  TOTAL_NOTIONAL,
  REFUNDABLE_OFFSET,
  NET_BENEFIT,
  fmtAUD,
} from '@/lib/claimsure-data';
import {
  KPICard,
  CsChip,
  CsButton,
  ConfidenceViz,
  CsAvatar,
  CsSectionHeader,
  CsSegmented,
} from '@/components/claimsure/primitives';

const PROJECT_ACCENT_MAP = {
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  warn: 'warn',
} as const;

export function DashboardClient() {
  const [view, setView] = useState('overview');

  const registrationDaysLeft = Math.ceil(
    (new Date('2026-04-30').getTime() - Date.now()) / 86_400_000,
  );

  return (
    <div className="max-w-[1400px] mx-auto space-y-10">
      {/* Header */}
      <CsSectionHeader
        eyebrow="FY24-25 R&D Tax Incentive"
        title={
          <>
            Claim <span style={{ color: 'var(--cs-primary-fixed-dim)' }}>Dashboard</span>
          </>
        }
        sub={`${COMPANY.name} · ABN ${COMPANY.abn} · Income year ending ${COMPANY.fyEnd}`}
        actions={
          <>
            <CsChip icon="schedule" color="warn">
              {registrationDaysLeft}d to registration
            </CsChip>
            <CsButton icon="refresh" variant="secondary" size="sm">
              Refresh
            </CsButton>
            <CsButton icon="auto_awesome" variant="ai" size="sm">
              Run AI Sweep
            </CsButton>
          </>
        }
      />

      {/* AI insight banner */}
      <div
        className="rounded-2xl p-5 flex items-start gap-4"
        style={{
          background:
            'linear-gradient(135deg, rgba(70,72,212,0.18) 0%, rgba(79,219,200,0.08) 100%)',
          border: '1px solid rgba(70,72,212,0.28)',
        }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(70,72,212,0.25)' }}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 22,
              fontVariationSettings: "'FILL' 1",
              color: 'var(--cs-primary-fixed-dim)',
            }}
          >
            auto_awesome
          </span>
        </div>
        <div className="flex-1">
          <div
            className="font-jakarta font-bold text-[14px] mb-1"
            style={{ color: 'var(--cs-primary-fixed-dim)' }}
          >
            Atlas · AI Insight
          </div>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--cs-on-surface)' }}>
            I've finished sweeping FY24-25 evidence. Total notional deduction is tracking at{' '}
            <strong>{fmtAUD(TOTAL_NOTIONAL, { compact: true })}</strong> — that's a{' '}
            <strong style={{ color: 'var(--cs-success)' }}>
              {fmtAUD(NET_BENEFIT, { compact: true })} net cash benefit
            </strong>{' '}
            after the 43.5% refundable offset and 25% base-rate company tax. RD-003 needs attention
            before filing.
          </p>
        </div>
        <CsButton icon="chevron_right" variant="ai" size="sm">
          View details
        </CsButton>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Notional Deduction"
          value={fmtAUD(TOTAL_NOTIONAL, { compact: true })}
          sub="Total eligible expenditure"
          icon="receipt_long"
          accent="primary"
          trend={1}
        />
        <KPICard
          label="Refundable Offset"
          value={fmtAUD(REFUNDABLE_OFFSET, { compact: true })}
          sub="43.5% · turnover <A$20M"
          icon="savings"
          accent="success"
          trend={1}
        />
        <KPICard
          label="Net Cash Benefit"
          value={fmtAUD(NET_BENEFIT, { compact: true })}
          sub="After 25% company tax credit"
          icon="account_balance_wallet"
          accent="secondary"
          trend={1}
        />
        <KPICard
          label="Active Projects"
          value={String(PROJECTS.length)}
          sub={`${PROJECTS.filter((p) => p.status === 'active').length} active · ${PROJECTS.filter((p) => p.status === 'review').length} review · ${PROJECTS.filter((p) => p.status === 'draft').length} draft`}
          icon="folder_special"
          accent="tertiary"
        />
      </div>

      {/* Projects + expenditure */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Projects list */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <h3
              className="font-jakarta font-bold text-[18px]"
              style={{ color: 'var(--cs-on-surface)' }}
            >
              R&D Projects
            </h3>
            <CsSegmented
              value={view}
              onChange={setView}
              options={['overview', 'spend', 'confidence']}
            />
          </div>
          <div className="space-y-3">
            {PROJECTS.map((project) => (
              <div
                key={project.id}
                className="cs-glass rounded-2xl p-5 transition-all hover:border-white/20 cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CsChip
                        color={PROJECT_ACCENT_MAP[project.color]}
                        icon={
                          project.status === 'active'
                            ? 'check_circle'
                            : project.status === 'review'
                              ? 'pending'
                              : 'edit_note'
                        }
                      >
                        {project.code}
                      </CsChip>
                      <CsChip
                        color={
                          project.status === 'active'
                            ? 'success'
                            : project.status === 'review'
                              ? 'warn'
                              : 'default'
                        }
                      >
                        {project.status}
                      </CsChip>
                    </div>
                    <div
                      className="font-semibold text-[14px]"
                      style={{ color: 'var(--cs-on-surface)' }}
                    >
                      {project.name}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div
                      className="font-mono font-bold text-[15px]"
                      style={{ color: 'var(--cs-primary-fixed-dim)' }}
                    >
                      {fmtAUD(project.coreSpend + project.supportSpend, { compact: true })}
                    </div>
                    <div
                      className="text-[10px] opacity-50"
                      style={{ color: 'var(--cs-on-surface-variant)' }}
                    >
                      total spend
                    </div>
                  </div>
                </div>

                {view === 'confidence' && <ConfidenceViz value={project.confidence} style="bar" />}

                {view === 'spend' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div
                      className="rounded-xl px-3 py-2"
                      style={{ background: 'rgba(70,72,212,0.08)' }}
                    >
                      <div
                        className="text-[10px] opacity-50 mb-0.5"
                        style={{ color: 'var(--cs-on-surface-variant)' }}
                      >
                        Core spend
                      </div>
                      <div
                        className="font-mono font-semibold text-[13px]"
                        style={{ color: 'var(--cs-primary-fixed-dim)' }}
                      >
                        {fmtAUD(project.coreSpend)}
                      </div>
                    </div>
                    <div
                      className="rounded-xl px-3 py-2"
                      style={{ background: 'rgba(79,219,200,0.08)' }}
                    >
                      <div
                        className="text-[10px] opacity-50 mb-0.5"
                        style={{ color: 'var(--cs-on-surface-variant)' }}
                      >
                        Supporting spend
                      </div>
                      <div
                        className="font-mono font-semibold text-[13px]"
                        style={{ color: 'var(--cs-secondary-fixed-dim)' }}
                      >
                        {fmtAUD(project.supportSpend)}
                      </div>
                    </div>
                  </div>
                )}

                {view === 'overview' && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-1.5">
                        {project.owners.map((o) => (
                          <CsAvatar key={o} name={o} size={24} />
                        ))}
                      </div>
                      <span
                        className="text-[11px] opacity-50"
                        style={{ color: 'var(--cs-on-surface-variant)' }}
                      >
                        {project.contemporaneousEvidence} evidence items
                      </span>
                    </div>
                    <ConfidenceViz value={project.confidence} style="badge" />
                  </div>
                )}

                {/* AI note */}
                <div
                  className="mt-3 flex items-start gap-2 px-3 py-2 rounded-xl"
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
                    {project.aiNote}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Expenditure mix */}
        <div className="lg:col-span-2 space-y-4">
          <h3
            className="font-jakarta font-bold text-[18px]"
            style={{ color: 'var(--cs-on-surface)' }}
          >
            Expenditure Mix
          </h3>
          <div className="cs-glass rounded-2xl p-5 space-y-4">
            {EXPENDITURE_CATEGORIES.map((cat) => (
              <div key={cat.id}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[12px]" style={{ color: 'var(--cs-on-surface-variant)' }}>
                    {cat.label}
                  </span>
                  <span
                    className="font-mono text-[12px] font-semibold"
                    style={{ color: 'var(--cs-on-surface)' }}
                  >
                    {fmtAUD(cat.amount, { compact: true })}
                  </span>
                </div>
                <div
                  className="h-1.5 w-full rounded-full overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.07)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${cat.pct}%`,
                      background:
                        cat.pct > 30
                          ? 'var(--cs-primary-fixed-dim)'
                          : cat.pct > 15
                            ? 'var(--cs-secondary-fixed-dim)'
                            : 'var(--cs-tertiary-fixed-dim)',
                    }}
                  />
                </div>
                <div
                  className="text-right text-[10px] mt-0.5 font-mono opacity-50"
                  style={{ color: 'var(--cs-on-surface-variant)' }}
                >
                  {cat.pct}%
                </div>
              </div>
            ))}

            <div className="pt-3 mt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex justify-between items-center">
                <span
                  className="text-[11px] uppercase tracking-wider font-semibold opacity-60"
                  style={{ color: 'var(--cs-on-surface-variant)' }}
                >
                  Total notional
                </span>
                <span
                  className="font-jakarta font-extrabold text-[20px]"
                  style={{ color: 'var(--cs-primary-fixed-dim)' }}
                >
                  {fmtAUD(TOTAL_NOTIONAL, { compact: true })}
                </span>
              </div>
            </div>
          </div>

          {/* Engineer allocation summary */}
          <h3
            className="font-jakarta font-bold text-[18px] pt-2"
            style={{ color: 'var(--cs-on-surface)' }}
          >
            Key Engineers
          </h3>
          <div className="cs-glass rounded-2xl p-4 space-y-3">
            {ENGINEERS.slice(0, 4).map((eng) => (
              <div key={eng.id} className="flex items-center gap-3">
                <CsAvatar name={eng.name} size={32} />
                <div className="flex-1 min-w-0">
                  <div
                    className="font-semibold text-[12px] truncate"
                    style={{ color: 'var(--cs-on-surface)' }}
                  >
                    {eng.name}
                  </div>
                  <div
                    className="text-[10px] opacity-50 truncate"
                    style={{ color: 'var(--cs-on-surface-variant)' }}
                  >
                    {eng.role}
                  </div>
                </div>
                <ConfidenceViz value={eng.rdPct} style="badge" label="R&D %" />
              </div>
            ))}
            <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <CsButton variant="ghost" size="sm" full icon="arrow_forward">
                View all engineers
              </CsButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
