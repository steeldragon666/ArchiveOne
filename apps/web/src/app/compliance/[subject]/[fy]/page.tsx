'use client';

import Link from 'next/link';
import { use } from 'react';
import { AppShell } from '@/components/app-shell';
import { FormCompletenessGauge } from './_components/form-completeness-gauge';
import { BeneficialOwnershipPanel } from './_components/beneficial-ownership-panel';
import { KnowledgeSearchPanel } from './_components/knowledge-search-panel';
import { FacilitiesPanel } from './_components/facilities-panel';
import { ForecastPanel } from './_components/forecast-panel';
import { SimilarityDashboardPanel } from './_components/similarity-dashboard-panel';

export default function CompliancePage({
  params,
}: {
  params: Promise<{ subject: string; fy: string }>;
}) {
  const { subject, fy } = use(params);
  return (
    <AppShell>
      <Inner subject={subject} fy={fy} />
    </AppShell>
  );
}

function Inner({ subject, fy }: { subject: string; fy: string }) {
  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/subject-tenants/${subject}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to claimant
        </Link>
      </div>

      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Compliance
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Compliance Dashboard</h1>
        <p className="text-muted-foreground">
          Form readiness for <span className="font-mono text-xs tabular-nums">{fy}</span>
        </p>
      </header>

      <FormCompletenessGauge subject={subject} fy={fy} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BeneficialOwnershipPanel subject={subject} fy={fy} />
        <KnowledgeSearchPanel subject={subject} fy={fy} />
        <FacilitiesPanel subject={subject} fy={fy} />
        <ForecastPanel subject={subject} fy={fy} />
        <SimilarityDashboardPanel subject={subject} fy={fy} />
      </div>
    </div>
  );
}
