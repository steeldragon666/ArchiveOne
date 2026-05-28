'use client';

import { AuthGuard } from '@/components/auth-guard';

/**
 * P9 Phase 3 — Financier portal route-group layout.
 *
 * Minimal chrome, read-only layout for financier partners viewing
 * shared claim data via federation_share. No admin navigation,
 * no edit surfaces — read-only by design.
 *
 * Design system: System A dark broadcast theme — ink base, bone text,
 * amber accent, Fraunces serif headings (via font-display utility).
 */
export default function FinancierLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-card/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-display font-semibold text-primary">ArchiveOne</h1>
              <p className="text-xs text-muted-foreground font-body">Financier Portal</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              Read-only
            </span>
          </div>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
      </div>
    </AuthGuard>
  );
}
