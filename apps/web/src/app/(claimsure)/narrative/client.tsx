'use client';

import { useState } from 'react';
import { PROJECTS, NARRATIVE_DRAFT } from '@/lib/claimsure-data';
import {
  CsButton,
  CsChip,
  CsSectionHeader,
  ConfidenceViz,
} from '@/components/claimsure/primitives';
export function NarrativeClient() {
  const [selectedProject, setSelectedProject] = useState(PROJECTS[0]?.id ?? '');
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [regenerating, setRegenerating] = useState<number | null>(null);
  const [sectionText, setSectionText] = useState<Record<number, string>>({});

  function regenerate(idx: number) {
    setRegenerating(idx);
    setTimeout(() => setRegenerating(null), 2400);
  }

  const overallConfidence = Math.round(
    NARRATIVE_DRAFT.sections.reduce((s, sec) => s + sec.confidence, 0) /
      NARRATIVE_DRAFT.sections.length,
  );

  return (
    <div className="max-w-[1200px] mx-auto space-y-10">
      <CsSectionHeader
        eyebrow="Technical Narrative — Form 1A"
        title={
          <>
            Narrative <span style={{ color: 'var(--cs-tertiary-fixed-dim)' }}>Generator</span>
          </>
        }
        sub="AI-drafted AusIndustry Form 1A narrative. Each section is grounded in contemporaneous evidence and traceable to s.355-25 ITAA 1997 criteria."
        actions={
          <>
            <ConfidenceViz value={overallConfidence} style="badge" label="Overall confidence" />
            <CsButton icon="download" variant="secondary" size="sm">
              Export DOCX
            </CsButton>
            <CsButton icon="auto_awesome" variant="ai" size="sm">
              Regenerate all
            </CsButton>
          </>
        }
      />

      {/* Project picker */}
      <div className="flex gap-3 flex-wrap">
        {PROJECTS.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedProject(p.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all"
            style={
              selectedProject === p.id
                ? {
                    background: 'rgba(70,72,212,0.20)',
                    border: '1px solid rgba(70,72,212,0.35)',
                    color: 'var(--cs-primary-fixed-dim)',
                  }
                : {
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.09)',
                    color: 'var(--cs-on-surface-variant)',
                  }
            }
          >
            <span className="font-mono text-[11px] opacity-70">{p.code}</span>
            {p.name}
            <ConfidenceViz value={p.confidence} style="badge" compact />
          </button>
        ))}
      </div>

      {/* Document header */}
      <div
        className="rounded-2xl p-6"
        style={{
          background:
            'linear-gradient(135deg, rgba(70,72,212,0.12) 0%, rgba(79,219,200,0.06) 100%)',
          border: '1px solid rgba(70,72,212,0.22)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div
              className="text-[10px] uppercase tracking-[0.18em] font-bold mb-2"
              style={{ color: 'var(--cs-primary-fixed-dim)', opacity: 0.7 }}
            >
              AusIndustry · Form 1A · R&DTI Registration
            </div>
            <h2
              className="font-jakarta font-extrabold text-[22px]"
              style={{ color: 'var(--cs-on-surface)' }}
            >
              {NARRATIVE_DRAFT.project}
            </h2>
          </div>
          <CsChip icon="verified" color="success">
            AI Drafted
          </CsChip>
        </div>
      </div>

      {/* Narrative sections */}
      <div className="space-y-5">
        {NARRATIVE_DRAFT.sections.map((section, idx) => {
          const isEditing = editingSection === idx;
          const isRegenerating = regenerating === idx;
          const text = sectionText[idx] ?? section.body;

          return (
            <div
              key={idx}
              className="cs-glass rounded-2xl overflow-hidden transition-all"
              style={
                isEditing
                  ? {
                      border: '1px solid rgba(70,72,212,0.35)',
                      boxShadow: '0 0 24px rgba(70,72,212,0.10)',
                    }
                  : undefined
              }
            >
              {/* Section header */}
              <div
                className="flex items-center justify-between px-6 py-4"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center font-mono font-bold text-[12px] flex-shrink-0"
                    style={{
                      background: 'rgba(70,72,212,0.20)',
                      color: 'var(--cs-primary-fixed-dim)',
                    }}
                  >
                    {idx + 1}
                  </div>
                  <h3
                    className="font-semibold text-[14px]"
                    style={{ color: 'var(--cs-on-surface)' }}
                  >
                    {section.heading}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <ConfidenceViz value={section.confidence} style="ring" compact />
                  <button
                    onClick={() => regenerate(idx)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10"
                    style={{ color: 'var(--cs-primary-fixed-dim)' }}
                    title="Regenerate section"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      refresh
                    </span>
                  </button>
                  <button
                    onClick={() => setEditingSection(isEditing ? null : idx)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-white/10"
                    style={{
                      color: isEditing
                        ? 'var(--cs-primary-fixed-dim)'
                        : 'var(--cs-on-surface-variant)',
                    }}
                    title="Edit section"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      {isEditing ? 'check' : 'edit'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="px-6 py-5">
                {isRegenerating ? (
                  <div className="space-y-2">
                    {[100, 85, 70, 45].map((w) => (
                      <div
                        key={w}
                        className="h-3.5 rounded-full cs-shimmer"
                        style={{ width: `${w}%` }}
                      />
                    ))}
                  </div>
                ) : isEditing ? (
                  <textarea
                    value={text}
                    onChange={(e) => setSectionText((prev) => ({ ...prev, [idx]: e.target.value }))}
                    rows={6}
                    className="w-full bg-transparent text-[14px] leading-relaxed outline-none resize-none rounded-xl p-3"
                    style={{
                      color: 'var(--cs-on-surface)',
                      border: '1px solid rgba(70,72,212,0.25)',
                      background: 'rgba(70,72,212,0.05)',
                    }}
                  />
                ) : (
                  <p
                    className="text-[14px] leading-relaxed"
                    style={{ color: 'var(--cs-on-surface)', opacity: 0.85 }}
                  >
                    {text}
                  </p>
                )}

                {/* Citations */}
                <div className="flex flex-wrap gap-2 mt-4">
                  {section.citations.map((cite) => (
                    <CsChip key={cite} icon="link" color="secondary">
                      {cite}
                    </CsChip>
                  ))}
                </div>

                {/* Confidence bar */}
                <div className="mt-4">
                  <ConfidenceViz
                    value={section.confidence}
                    style="bar"
                    label="Section confidence"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Export footer */}
      <div className="cs-glass rounded-2xl p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 20,
              color: 'var(--cs-primary-fixed-dim)',
              fontVariationSettings: "'FILL' 1",
            }}
          >
            history_edu
          </span>
          <div>
            <div className="font-semibold text-[13px]" style={{ color: 'var(--cs-on-surface)' }}>
              Form 1A ready for review
            </div>
            <div
              className="text-[11px] opacity-50"
              style={{ color: 'var(--cs-on-surface-variant)' }}
            >
              {NARRATIVE_DRAFT.sections.length} sections · {overallConfidence}% overall confidence
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <CsButton icon="visibility" variant="secondary" size="sm">
            Preview
          </CsButton>
          <CsButton icon="download" variant="primary" size="sm">
            Export DOCX
          </CsButton>
        </div>
      </div>
    </div>
  );
}
