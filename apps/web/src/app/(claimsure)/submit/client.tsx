'use client';

import { useState } from 'react';
import {
  COMPANY,
  PROJECTS,
  TOTAL_NOTIONAL,
  REFUNDABLE_OFFSET,
  NET_BENEFIT,
  fmtAUD,
} from '@/lib/claimsure-data';
import {
  CsButton,
  CsChip,
  CsSectionHeader,
  ConfidenceViz,
} from '@/components/claimsure/primitives';
import { cn } from '@/lib/utils';

const STEPS = [
  { id: 'company', label: 'Company', icon: 'business', desc: 'Entity details & eligibility' },
  { id: 'core', label: 'Core', icon: 'science', desc: 'Core R&D activities (s.355-25)' },
  { id: 'supporting', label: 'Supporting', icon: 'hub', desc: 'Supporting activities' },
  {
    id: 'expenditure',
    label: 'Expenditure',
    icon: 'receipt_long',
    desc: 'Notional deduction calculation',
  },
  { id: 'evidence', label: 'Evidence', icon: 'verified', desc: 'Contemporaneous evidence review' },
  { id: 'lodge', label: 'Lodge', icon: 'send', desc: 'Final review & submission' },
];

export function SubmitClient() {
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) return <SubmittedScreen />;

  return (
    <div className="max-w-[1100px] mx-auto space-y-8">
      <CsSectionHeader
        eyebrow="AusIndustry Registration · ATO Lodgement"
        title={
          <>
            Submit <span style={{ color: 'var(--cs-primary-fixed-dim)' }}>Claim</span>
          </>
        }
        sub={`${COMPANY.name} · ${COMPANY.fy} · Registration deadline ${COMPANY.registrationDeadline}`}
      />

      {/* Step indicator */}
      <div className="cs-glass rounded-2xl p-5">
        <div className="flex items-center gap-0">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={s.id} className="flex items-center flex-1 last:flex-none">
                <button
                  onClick={() => i <= step && setStep(i)}
                  className="flex flex-col items-center gap-2 group flex-1"
                  disabled={i > step}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
                    style={
                      done
                        ? { background: 'var(--cs-success)', color: 'white' }
                        : active
                          ? {
                              background: 'var(--cs-primary)',
                              color: 'white',
                              boxShadow: '0 0 20px rgba(70,72,212,0.5)',
                            }
                          : {
                              background: 'rgba(255,255,255,0.06)',
                              color: 'var(--cs-on-surface-variant)',
                            }
                    }
                  >
                    {done ? (
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}
                      >
                        check
                      </span>
                    ) : (
                      <span
                        className="material-symbols-outlined"
                        style={{
                          fontSize: 18,
                          fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
                        }}
                      >
                        {s.icon}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-[9px] uppercase tracking-widest font-semibold"
                    style={{
                      color: active
                        ? 'var(--cs-primary-fixed-dim)'
                        : done
                          ? 'var(--cs-success)'
                          : 'var(--cs-on-surface-variant)',
                      opacity: active || done ? 1 : 0.5,
                    }}
                  >
                    {s.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className="flex-1 mx-1 h-px"
                    style={{
                      background: i < step ? 'var(--cs-success)' : 'rgba(255,255,255,0.08)',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step content */}
      <div className="cs-page-in">
        {step === 0 && <StepCompany />}
        {step === 1 && <StepCore />}
        {step === 2 && <StepSupporting />}
        {step === 3 && <StepExpenditure />}
        {step === 4 && <StepEvidence />}
        {step === 5 && <StepLodge onSubmit={() => setSubmitted(true)} />}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <CsButton
          icon="arrow_back"
          variant="secondary"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          Back
        </CsButton>
        <div className="text-[11px] opacity-40" style={{ color: 'var(--cs-on-surface-variant)' }}>
          Step {step + 1} of {STEPS.length} — {STEPS[step]?.desc}
        </div>
        {step < STEPS.length - 1 ? (
          <CsButton
            icon="arrow_forward"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          >
            Continue
          </CsButton>
        ) : (
          <CsButton icon="send" onClick={() => setSubmitted(true)}>
            Lodge Claim
          </CsButton>
        )}
      </div>
    </div>
  );
}

function FieldGroup({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-[10px] uppercase tracking-widest opacity-60"
        style={{ color: 'var(--cs-on-surface-variant)' }}
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div
          className="px-4 py-3 rounded-xl text-[14px] font-semibold flex-1"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.09)',
            color: 'var(--cs-on-surface)',
          }}
        >
          {value}
        </div>
        {badge && (
          <CsChip color="success" icon="check_circle">
            {badge}
          </CsChip>
        )}
      </div>
    </div>
  );
}

function StepCompany() {
  return (
    <div className="cs-glass rounded-2xl p-7 space-y-6">
      <h3 className="font-jakarta font-bold text-[20px]" style={{ color: 'var(--cs-on-surface)' }}>
        Company Details
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <FieldGroup label="Registered entity name" value={COMPANY.name} badge="Verified" />
        <FieldGroup label="ABN" value={COMPANY.abn} badge="Active" />
        <FieldGroup label="Income year" value={COMPANY.fy} badge="Confirmed" />
        <FieldGroup
          label="Aggregate turnover"
          value={fmtAUD(COMPANY.aggTurnover)}
          badge="< A$20M"
        />
        <FieldGroup label="Registration deadline" value={COMPANY.registrationDeadline} />
        <FieldGroup label="Offset rate" value="43.5% refundable" badge="Eligible" />
      </div>
      <div
        className="flex items-start gap-3 p-4 rounded-xl"
        style={{ background: 'rgba(79,219,200,0.08)', border: '1px solid rgba(79,219,200,0.20)' }}
      >
        <span
          className="material-symbols-outlined flex-shrink-0"
          style={{ fontSize: 18, color: 'var(--cs-success)', fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
        <p
          className="text-[12px] leading-relaxed"
          style={{ color: 'var(--cs-on-surface-variant)' }}
        >
          {COMPANY.name} is eligible for the{' '}
          <strong style={{ color: 'var(--cs-success)' }}>refundable 43.5% offset</strong> based on
          aggregate turnover below A$20M. R&DTI registration must be lodged with AusIndustry by{' '}
          {COMPANY.registrationDeadline}.
        </p>
      </div>
    </div>
  );
}

function StepCore() {
  return (
    <div className="cs-glass rounded-2xl p-7 space-y-6">
      <h3 className="font-jakarta font-bold text-[20px]" style={{ color: 'var(--cs-on-surface)' }}>
        Core R&D Activities (s.355-25)
      </h3>
      <p className="text-[13px] opacity-70" style={{ color: 'var(--cs-on-surface-variant)' }}>
        Each core activity must satisfy: (a) new knowledge sought; (b) systematic investigation; (c)
        hypothesis → experimentation → evaluation.
      </p>
      <div className="space-y-4">
        {PROJECTS.filter((p) => p.coreActivities > 0).map((p) => (
          <div
            key={p.id}
            className="rounded-2xl p-5"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CsChip color={p.color}>{p.code}</CsChip>
                <span
                  className="font-semibold text-[13px]"
                  style={{ color: 'var(--cs-on-surface)' }}
                >
                  {p.name}
                </span>
              </div>
              <CsChip color="primary">
                {p.coreActivities} core {p.coreActivities === 1 ? 'activity' : 'activities'}
              </CsChip>
            </div>
            <ConfidenceViz value={p.confidence} style="bar" label="Eligibility confidence" />
            <div
              className="mt-3 flex items-start gap-2 px-3 py-2 rounded-xl"
              style={{ background: 'rgba(70,72,212,0.07)' }}
            >
              <span
                className="material-symbols-outlined flex-shrink-0 mt-0.5"
                style={{
                  fontSize: 12,
                  color: 'var(--cs-primary-fixed-dim)',
                  fontVariationSettings: "'FILL' 1",
                }}
              >
                auto_awesome
              </span>
              <p className="text-[11px]" style={{ color: 'var(--cs-on-surface-variant)' }}>
                {p.aiNote}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepSupporting() {
  return (
    <div className="cs-glass rounded-2xl p-7 space-y-6">
      <h3 className="font-jakarta font-bold text-[20px]" style={{ color: 'var(--cs-on-surface)' }}>
        Supporting Activities (s.355-30)
      </h3>
      <p className="text-[13px] opacity-70" style={{ color: 'var(--cs-on-surface-variant)' }}>
        Supporting activities are directly related to core R&D activities and not conducted on
        behalf of an associate entity.
      </p>
      <div className="space-y-4">
        {PROJECTS.filter((p) => p.supportingActivities > 0).map((p) => (
          <div
            key={p.id}
            className="rounded-2xl p-5 flex items-center justify-between"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div className="flex items-center gap-3">
              <CsChip color={p.color}>{p.code}</CsChip>
              <div>
                <div
                  className="font-semibold text-[13px]"
                  style={{ color: 'var(--cs-on-surface)' }}
                >
                  {p.name}
                </div>
                <div
                  className="text-[11px] opacity-50"
                  style={{ color: 'var(--cs-on-surface-variant)' }}
                >
                  {p.supportingActivities} supporting{' '}
                  {p.supportingActivities === 1 ? 'activity' : 'activities'}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div
                className="font-mono font-bold text-[15px]"
                style={{ color: 'var(--cs-secondary-fixed-dim)' }}
              >
                {fmtAUD(p.supportSpend)}
              </div>
              <div
                className="text-[10px] opacity-40"
                style={{ color: 'var(--cs-on-surface-variant)' }}
              >
                supporting spend
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepExpenditure() {
  const rows = [
    {
      label: 'Total core R&D expenditure',
      value: PROJECTS.reduce((s, p) => s + p.coreSpend, 0),
      note: 'Direct salary, contractor, materials',
    },
    {
      label: 'Total supporting R&D expenditure',
      value: PROJECTS.reduce((s, p) => s + p.supportSpend, 0),
      note: 'Apportioned overheads + cloud compute',
    },
    {
      label: 'Notional deduction (total)',
      value: TOTAL_NOTIONAL,
      note: 'Core + supporting',
      bold: true,
    },
    {
      label: 'Refundable offset (43.5%)',
      value: REFUNDABLE_OFFSET,
      note: 'Applied at tax lodgement',
      highlight: 'success',
    },
    {
      label: 'Less: company tax credit (25%)',
      value: -Math.round(TOTAL_NOTIONAL * 0.25),
      note: 'Standard rate, turnover <A$20M',
      dim: true,
    },
    {
      label: 'Net cash benefit',
      value: NET_BENEFIT,
      note: 'Expected refund / offset credit',
      highlight: 'primary',
      bold: true,
    },
  ];
  return (
    <div className="cs-glass rounded-2xl p-7 space-y-6">
      <h3 className="font-jakarta font-bold text-[20px]" style={{ color: 'var(--cs-on-surface)' }}>
        Notional Deduction Calculation
      </h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between px-4 py-3 rounded-xl"
            style={{
              background: row.bold ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
              border: row.bold ? '1px solid rgba(255,255,255,0.10)' : '1px solid transparent',
            }}
          >
            <div>
              <div
                className={cn('text-[13px]', row.bold && 'font-semibold')}
                style={{ color: 'var(--cs-on-surface)' }}
              >
                {row.label}
              </div>
              <div
                className="text-[10px] opacity-40"
                style={{ color: 'var(--cs-on-surface-variant)' }}
              >
                {row.note}
              </div>
            </div>
            <div
              className={cn('font-mono text-[15px]', row.bold && 'font-extrabold text-[18px]')}
              style={{
                color:
                  row.highlight === 'success'
                    ? 'var(--cs-success)'
                    : row.highlight === 'primary'
                      ? 'var(--cs-primary-fixed-dim)'
                      : row.dim
                        ? 'var(--cs-on-surface-variant)'
                        : 'var(--cs-on-surface)',
              }}
            >
              {row.value < 0 ? '−' : ''}
              {fmtAUD(Math.abs(row.value))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepEvidence() {
  return (
    <div className="cs-glass rounded-2xl p-7 space-y-6">
      <h3 className="font-jakarta font-bold text-[20px]" style={{ color: 'var(--cs-on-surface)' }}>
        Evidence Review
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: 'Total evidence items',
            value: '300',
            icon: 'description',
            color: 'var(--cs-primary-fixed-dim)',
          },
          {
            label: 'High confidence (≥85%)',
            value: '241',
            icon: 'verified',
            color: 'var(--cs-success)',
          },
          { label: 'Needs review (<70%)', value: '47', icon: 'pending', color: 'var(--cs-warn)' },
          { label: 'Missing', value: '12', icon: 'error_outline', color: 'var(--cs-error)' },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl p-4 text-center"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 24, color: item.color, fontVariationSettings: "'FILL' 1" }}
            >
              {item.icon}
            </span>
            <div
              className="font-jakarta font-extrabold text-[28px] mt-1"
              style={{ color: item.color }}
            >
              {item.value}
            </div>
            <div
              className="text-[10px] uppercase tracking-wider opacity-50 mt-1"
              style={{ color: 'var(--cs-on-surface-variant)' }}
            >
              {item.label}
            </div>
          </div>
        ))}
      </div>
      {PROJECTS.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between px-4 py-3 rounded-xl"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <div className="flex items-center gap-3">
            <CsChip color={p.color}>{p.code}</CsChip>
            <span className="text-[13px]" style={{ color: 'var(--cs-on-surface)' }}>
              {p.contemporaneousEvidence} contemporaneous items
            </span>
          </div>
          <ConfidenceViz value={p.confidence} style="badge" />
        </div>
      ))}
    </div>
  );
}

function StepLodge({ onSubmit }: { onSubmit: () => void }) {
  return (
    <div className="cs-glass rounded-2xl p-7 space-y-6">
      <h3 className="font-jakarta font-bold text-[20px]" style={{ color: 'var(--cs-on-surface)' }}>
        Final Review & Lodge
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            label: 'Notional deduction',
            value: fmtAUD(TOTAL_NOTIONAL, { compact: true }),
            icon: 'receipt_long',
            color: 'var(--cs-primary-fixed-dim)',
          },
          {
            label: 'Expected refund',
            value: fmtAUD(NET_BENEFIT, { compact: true }),
            icon: 'savings',
            color: 'var(--cs-success)',
          },
          {
            label: 'Projects included',
            value: String(PROJECTS.length),
            icon: 'folder_special',
            color: 'var(--cs-secondary-fixed-dim)',
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl p-5 text-center"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 26, color: item.color, fontVariationSettings: "'FILL' 1" }}
            >
              {item.icon}
            </span>
            <div
              className="font-jakarta font-extrabold text-[26px] mt-2"
              style={{ color: item.color }}
            >
              {item.value}
            </div>
            <div
              className="text-[11px] uppercase tracking-widest opacity-50 mt-1"
              style={{ color: 'var(--cs-on-surface-variant)' }}
            >
              {item.label}
            </div>
          </div>
        ))}
      </div>
      <div
        className="flex items-start gap-3 p-4 rounded-xl"
        style={{ background: 'rgba(70,72,212,0.08)', border: '1px solid rgba(70,72,212,0.22)' }}
      >
        <span
          className="material-symbols-outlined flex-shrink-0 mt-0.5"
          style={{
            fontSize: 18,
            color: 'var(--cs-primary-fixed-dim)',
            fontVariationSettings: "'FILL' 1",
          }}
        >
          info
        </span>
        <p
          className="text-[12px] leading-relaxed"
          style={{ color: 'var(--cs-on-surface-variant)' }}
        >
          By lodging, you confirm this R&DTI registration is accurate and complete. The registration
          will be transmitted to AusIndustry. ATO income tax return integration occurs at next
          lodgement.
        </p>
      </div>
      <div className="flex justify-center pt-2">
        <CsButton icon="send" size="lg" onClick={onSubmit}>
          Lodge with AusIndustry
        </CsButton>
      </div>
    </div>
  );
}

function SubmittedScreen() {
  return (
    <div className="max-w-[700px] mx-auto text-center space-y-8 py-16 cs-page-in">
      <div
        className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto"
        style={{
          background: 'linear-gradient(135deg, rgba(79,219,200,0.25), rgba(70,72,212,0.20))',
          border: '1px solid rgba(79,219,200,0.30)',
          boxShadow: '0 0 60px rgba(79,219,200,0.20)',
        }}
      >
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 48, color: 'var(--cs-success)', fontVariationSettings: "'FILL' 1" }}
        >
          task_alt
        </span>
      </div>
      <div>
        <div className="font-jakarta font-extrabold text-[40px] cs-gradient-text mb-3">
          Claim Lodged!
        </div>
        <p className="text-[16px] opacity-70" style={{ color: 'var(--cs-on-surface-variant)' }}>
          Your R&DTI registration for {COMPANY.name} ({COMPANY.fy}) has been transmitted to
          AusIndustry. You'll receive a reference number within 2 business days.
        </p>
      </div>
      <div className="cs-glass rounded-2xl p-6 grid grid-cols-3 gap-6 text-center">
        <div>
          <div
            className="font-mono font-extrabold text-[22px]"
            style={{ color: 'var(--cs-primary-fixed-dim)' }}
          >
            {fmtAUD(TOTAL_NOTIONAL, { compact: true })}
          </div>
          <div
            className="text-[10px] uppercase tracking-widest opacity-50 mt-1"
            style={{ color: 'var(--cs-on-surface-variant)' }}
          >
            Notional deduction
          </div>
        </div>
        <div>
          <div
            className="font-mono font-extrabold text-[22px]"
            style={{ color: 'var(--cs-success)' }}
          >
            {fmtAUD(NET_BENEFIT, { compact: true })}
          </div>
          <div
            className="text-[10px] uppercase tracking-widest opacity-50 mt-1"
            style={{ color: 'var(--cs-on-surface-variant)' }}
          >
            Net cash benefit
          </div>
        </div>
        <div>
          <div
            className="font-mono font-extrabold text-[22px]"
            style={{ color: 'var(--cs-secondary-fixed-dim)' }}
          >
            {PROJECTS.length}
          </div>
          <div
            className="text-[10px] uppercase tracking-widest opacity-50 mt-1"
            style={{ color: 'var(--cs-on-surface-variant)' }}
          >
            Projects registered
          </div>
        </div>
      </div>
    </div>
  );
}
