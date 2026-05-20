'use client';
/**
 * /financing — Financing tab (top-tab nav).
 *
 * PR #1: coming-soon placeholder. This is the surface for Product 1.3 — the
 * financier pillar that turns the proprietary Claim Quality Score (CQS) into
 * a lender-underwriting primitive for advance-against-refund finance.
 *
 * Spec: docs/product/financier-pillar-plan-summary.md
 * Gated: only unlocks for claimants who are on Product 1.2 (client app),
 * which itself only unlocks for claimants on Product 1.1 (consultant app).
 */
import { AppShell } from '@/components/app-shell';
import { Wallet, Lock } from 'lucide-react';

export default function FinancingPage() {
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-16">
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-6">
            <Wallet className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight mb-3">Financing</h1>
          <p className="text-lg text-muted-foreground mb-2">Coming soon — Product 1.3</p>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            Advance against your next quarterly R&amp;DTI refund at 80–85% LTV, 16% APR daily
            compounded, underwritten by lender partners using the proprietary Claim Quality Score.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <FeatureCard
            title="80–85% LTV advances"
            body="Tranches aligned with BAS quarterly cycles. Q1 (9-month), Q2 (6-month), Q3 (3-month)."
          />
          <FeatureCard
            title="Claim Quality Score"
            body="Six-component composite (advisor, evidence, BBM/UVI, hypothesis, contemporaneous, sector) — refreshes per claim event."
          />
          <FeatureCard
            title="GST/BAS layer"
            body="Capital and leasing spend strengthens next-quarter financing position via 10% GST credits."
          />
          <FeatureCard
            title="Labour on-costs"
            body="Super, payroll tax, workers' comp, leave loading — all claimable for R&D-allocated labour. Salary-heavy R&D unlocks ~94% qualifying ratio."
          />
        </div>

        <div className="mt-12 rounded-md border border-dashed border-border p-6 bg-muted/20">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium mb-1">Gating — Product 1.3</p>
              <p className="text-sm text-muted-foreground">
                Financing requires Product 1.2 (client-side app) for the claimant, which itself
                requires Product 1.1 (this consultant app). The three tiers compound: each deepens
                the underwriting data the lender pillar relies on.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-border p-4 bg-background">
      <p className="font-medium text-sm mb-1.5">{title}</p>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
