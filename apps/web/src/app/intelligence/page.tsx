'use client';
import { AppShell } from '@/components/app-shell';
import { IntelligenceEventList } from './_components/intelligence-event-list';
import { IntelligenceStaleBanner } from './_components/intelligence-stale-banner';

/**
 * /intelligence — Regulatory Intelligence Feed (P7 Theme D Task D.12).
 */
export default function IntelligencePage() {
  return (
    <AppShell>
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Workspace
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Regulatory Intelligence
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Events from ATO, AustLII, ISA, and industry sources classified by the RIF agent. High
            and medium severity events generate prompt suggestions automatically.
          </p>
        </header>
        <IntelligenceStaleBanner />
        <IntelligenceEventList />
      </div>
    </AppShell>
  );
}
