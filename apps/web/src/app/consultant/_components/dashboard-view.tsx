'use client';

import {
  amber,
  bone,
  bone2,
  bone3,
  bone4,
  fMono,
  fSans,
  fSerif,
  ink,
  ink2,
  rule,
  ruleStrong,
  rust,
} from './tokens';
import { Diamond, MonoLabel } from './atoms';
import Link from 'next/link';
import { useConsultantRecentChainBlocks } from '@/lib/hooks/use-consultant-recent-chain-blocks';
import { useConsultantSignals } from '@/lib/hooks/use-consultant-signals';
import { useConsultantKpis, type ConsultantKpisResponse } from '@/lib/hooks/use-consultant-kpis';
import { useWhoami } from '@/hooks/use-whoami';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstNameFromWhoami(displayName: string | null, email: string): string {
  if (displayName && displayName.length > 0) return displayName.split(/\s+/)[0] ?? displayName;
  // Fall back to the local-part of the email — never show the raw email on
  // the dashboard greeting (PII surface) but a stripped first token is
  // friendly enough.
  const local = email.split('@')[0] ?? '';
  // dotted/underscored emails (e.g. aaron.smith@x) → "Aaron"
  const token = local.split(/[._-]/)[0] ?? local;
  return token.length > 0 ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase() : 'there';
}

export function DashboardView() {
  return (
    <div style={{ padding: 28, color: bone, height: '100%', overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 26,
        }}
      >
        <DashboardHeader />
        <div style={{ display: 'flex', gap: 10 }}>
          <Link
            href="/subject-tenants"
            style={{
              padding: '10px 18px',
              background: 'transparent',
              color: bone,
              border: `1px solid ${ruleStrong}`,
              borderRadius: 3,
              fontFamily: fMono,
              fontSize: 11,
              letterSpacing: '0.18em',
              cursor: 'pointer',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            + Import client
          </Link>
          <Link
            href="/pipeline?action=new"
            style={{
              padding: '10px 18px',
              background: amber,
              color: ink,
              border: 'none',
              borderRadius: 3,
              fontFamily: fMono,
              fontSize: 11,
              letterSpacing: '0.18em',
              cursor: 'pointer',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            + New claim
          </Link>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <KpiStrip fy="FY26" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <ClaimsPanel />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <WatchPanel />
          <ChainPanel />
        </div>
      </div>
    </div>
  );
}

/**
 * DashboardHeader — dynamic greeting + live subhead.
 *
 * Replaces the static "Good morning, Anna. / Three signals overnight..."
 * placeholder. Greeting uses the session's display name (or email local-part
 * fallback) so a paying consultant sees their own name, not a fixture.
 * Subhead summarises the two real KPIs the consultant cares about on
 * page-load: today's regulatory signal count + at-risk claim count.
 */
function DashboardHeader() {
  const whoami = useWhoami();
  const { data: signalsData } = useConsultantSignals({ window: '24h' });
  const { data: kpis } = useConsultantKpis({ fy: 'FY26' });
  const name = whoami.data?.user
    ? firstNameFromWhoami(whoami.data.user.displayName, whoami.data.user.email)
    : 'there';
  const signalCount = signalsData?.signals.length ?? 0;
  const atRisk = kpis?.atRisk ?? 0;
  const subhead =
    signalCount === 0 && atRisk === 0
      ? 'No new regulatory signals overnight. Nothing flagged for review.'
      : `${signalCount} new signal${signalCount === 1 ? '' : 's'} overnight. ${atRisk} claim${atRisk === 1 ? '' : 's'} ${atRisk === 1 ? 'needs' : 'need'} your judgement today.`;

  return (
    <div>
      <MonoLabel size={10} color={bone3} tracking="0.22em">
        Dashboard · FY26
      </MonoLabel>
      <h1
        style={{
          fontFamily: fSerif,
          fontWeight: 300,
          fontSize: 44,
          lineHeight: 1.0,
          letterSpacing: '-0.025em',
          color: bone,
          margin: '10px 0 0',
        }}
      >
        {greeting()}, {name}.
      </h1>
      <p style={{ fontFamily: fSans, fontSize: 15, color: bone3, margin: '8px 0 0' }}>{subhead}</p>
    </div>
  );
}

interface KPIProps {
  k: string;
  big: string;
  suffix?: string;
  sub: string;
  /**
   * Trend string below the divider. When `null` the trend row is omitted
   * entirely — used when the server returns a `null` delta (e.g.
   * `atRiskVsYesterday` until the daily-snapshot job lands) or when the
   * prior FY had no comparable baseline.
   */
  trend: string | null;
  tone?: 'rust' | 'amber';
}

function KPI({ k, big, suffix, sub, trend, tone }: KPIProps) {
  const color = tone === 'rust' ? rust : tone === 'amber' ? amber : bone;
  return (
    <div
      style={{
        padding: '18px 20px',
        background: ink2,
        border: `1px solid ${ruleStrong}`,
        borderRadius: 4,
      }}
    >
      <MonoLabel size={9.5} color={bone3} tracking="0.2em">
        {k}
      </MonoLabel>
      <div
        style={{
          fontFamily: fSerif,
          fontWeight: 300,
          fontSize: 48,
          lineHeight: 1,
          letterSpacing: '-0.025em',
          color,
          marginTop: 14,
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
        }}
      >
        {big}
        {suffix && <span style={{ fontSize: 28, color: amber }}>{suffix}</span>}
      </div>
      <div style={{ fontFamily: fSans, fontSize: 12, color: bone3, marginTop: 8 }}>{sub}</div>
      {trend !== null && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: `1px solid ${rule}`,
            fontFamily: fMono,
            fontSize: 9,
            color: bone4,
            letterSpacing: '0.14em',
          }}
        >
          {trend}
        </div>
      )}
    </div>
  );
}

/**
 * Skeleton with the same vertical footprint as the loaded KPI card — label
 * row, big number (48px), sub row, divider + trend — so populating the
 * strip causes no visible layout shift on first paint.
 */
function KPISkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading KPI"
      style={{
        padding: '18px 20px',
        background: ink2,
        border: `1px solid ${ruleStrong}`,
        borderRadius: 4,
      }}
    >
      <div style={{ height: 12, width: 110, background: rule, borderRadius: 2 }} />
      <div
        style={{
          marginTop: 14,
          height: 48,
          width: 90,
          background: rule,
          borderRadius: 2,
        }}
      />
      <div style={{ marginTop: 8, height: 14, width: 140, background: rule, borderRadius: 2 }} />
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: `1px solid ${rule}`,
        }}
      >
        <div style={{ height: 10, width: 120, background: rule, borderRadius: 2 }} />
      </div>
    </div>
  );
}

function formatActiveClaimsTrend(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return 'no change vs last FY';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta)} vs last FY`;
}

function formatEvidenceTrend(pct: number | null): string | null {
  if (pct === null) return null;
  if (pct === 0) return 'flat YoY';
  const arrow = pct > 0 ? '↑' : '↓';
  return `${arrow} ${Math.abs(pct)}%`;
}

function formatAtRiskTrend(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return 'no change since yesterday';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta)} since yesterday`;
}

function formatCoverageTrend(pts: number | null): string | null {
  if (pts === null) return null;
  if (pts === 0) return 'flat YoY';
  const sign = pts > 0 ? '+' : '−';
  return `${sign}${Math.abs(pts)}pts YoY`;
}

function formatBig(n: number): string {
  return n.toLocaleString('en-AU');
}

function KpiStrip({ fy }: { fy: string }) {
  const { data, isLoading } = useConsultantKpis({ fy });

  if (isLoading || !data) {
    return (
      <>
        <KPISkeleton />
        <KPISkeleton />
        <KPISkeleton />
        <KPISkeleton />
      </>
    );
  }

  const k: ConsultantKpisResponse = data;
  return (
    <>
      <KPI
        k="ACTIVE CLAIMS"
        big={formatBig(k.activeClaims)}
        sub="this FY"
        trend={formatActiveClaimsTrend(k.deltas.activeClaimsVsLastFy)}
      />
      <KPI
        k="EVIDENCE INDEXED"
        big={formatBig(k.evidenceIndexed)}
        sub="artifacts this FY"
        trend={formatEvidenceTrend(k.deltas.evidenceIndexedPctYoY)}
      />
      <KPI
        k="AT-RISK"
        big={formatBig(k.atRisk)}
        sub="needs your judgement"
        tone="rust"
        trend={formatAtRiskTrend(k.deltas.atRiskVsYesterday)}
      />
      <KPI
        k="CHAIN COVERAGE"
        big={formatBig(k.chainCoveragePct)}
        suffix="%"
        sub={`of ${fy} claims`}
        tone="amber"
        trend={formatCoverageTrend(k.deltas.chainCoveragePtsYoY)}
      />
    </>
  );
}

/**
 * ClaimsPanel — Active claims summary.
 *
 * Previously rendered a hardcoded mock list (Vantage Industries, Borealis
 * Bio, etc.) that any paying consultant logging in would see as another
 * firm's data. This empty-state version is the honest stop-gap until a
 * dedicated `/v1/consultant/active-claims` endpoint ships. The /pipeline
 * route already serves the canonical claims list with full filtering, so
 * the panel funnels there rather than reimplementing the table.
 */
function ClaimsPanel() {
  const { data: kpis } = useConsultantKpis({ fy: 'FY26' });
  const activeClaims = kpis?.activeClaims ?? null;
  return (
    <div
      style={{
        background: ink2,
        border: `1px solid ${ruleStrong}`,
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${rule}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Diamond size={8} />
          <span style={{ fontFamily: fSerif, fontSize: 18, color: bone, fontWeight: 500 }}>
            Active claims
          </span>
          <MonoLabel size={10} color={bone3}>
            · FY26 BOOK
          </MonoLabel>
        </div>
        <Link
          href="/pipeline"
          style={{
            fontFamily: fMono,
            fontSize: 10.5,
            color: amber,
            letterSpacing: '0.14em',
            textDecoration: 'none',
          }}
        >
          OPEN PIPELINE →
        </Link>
      </div>
      <div style={{ padding: '36px 24px', textAlign: 'center' }}>
        {activeClaims === null ? (
          <p style={{ fontFamily: fSans, fontSize: 13, color: bone3, margin: 0 }}>
            Loading active claims…
          </p>
        ) : activeClaims === 0 ? (
          <>
            <p
              style={{
                fontFamily: fSerif,
                fontSize: 20,
                color: bone,
                margin: '0 0 6px',
                fontWeight: 300,
              }}
            >
              No active claims yet.
            </p>
            <p style={{ fontFamily: fSans, fontSize: 13, color: bone3, margin: '0 0 20px' }}>
              Start your first claim from the pipeline to begin capturing R&amp;D evidence.
            </p>
            <Link
              href="/pipeline?action=new"
              style={{
                padding: '10px 18px',
                background: amber,
                color: ink,
                borderRadius: 3,
                fontFamily: fMono,
                fontSize: 11,
                letterSpacing: '0.18em',
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              + Start a claim
            </Link>
          </>
        ) : (
          <>
            <p
              style={{
                fontFamily: fSerif,
                fontSize: 28,
                color: bone,
                margin: '0 0 4px',
                fontWeight: 300,
              }}
            >
              {activeClaims} active claim{activeClaims === 1 ? '' : 's'} this FY
            </p>
            <p style={{ fontFamily: fSans, fontSize: 13, color: bone3, margin: '0 0 20px' }}>
              Open the pipeline for full stage filters, drag-drop, and bulk actions.
            </p>
            <Link
              href="/pipeline"
              style={{
                padding: '10px 18px',
                background: 'transparent',
                color: bone,
                border: `1px solid ${ruleStrong}`,
                borderRadius: 3,
                fontFamily: fMono,
                fontSize: 11,
                letterSpacing: '0.18em',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Open pipeline →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function WatchPanel() {
  const { data } = useConsultantSignals({ window: '24h' });
  const signals = data?.signals ?? [];

  return (
    <div
      style={{
        background: ink2,
        border: `1px solid ${ruleStrong}`,
        borderRadius: 4,
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${rule}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Diamond size={7} />
          <span style={{ fontFamily: fSerif, fontSize: 16, color: bone, fontWeight: 500 }}>
            Watch
          </span>
        </div>
        <MonoLabel size={9} color={bone3}>
          {`TODAY · ${signals.length} SIGNAL${signals.length !== 1 ? 'S' : ''}`}
        </MonoLabel>
      </div>
      {signals.length === 0 && (
        <div
          style={{
            padding: '24px 18px',
            fontFamily: fSans,
            fontSize: 13,
            color: bone3,
            textAlign: 'center',
          }}
        >
          Watch is quiet — no new signals in the last 24h
        </div>
      )}
      {signals.map((s, i) => (
        <Link
          key={s.code}
          href={`/consultant/watch?signal=${encodeURIComponent(s.code)}`}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
          <div
            style={{
              padding: '14px 18px',
              borderBottom: i < signals.length - 1 ? `1px solid ${rule}` : 'none',
              background: s.exposure >= 3 ? 'rgba(225,162,58,0.04)' : 'transparent',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 8,
              }}
            >
              <MonoLabel size={10}>{s.src}</MonoLabel>
              <span
                style={{
                  fontFamily: fMono,
                  fontSize: 9.5,
                  color: bone4,
                  letterSpacing: '0.14em',
                }}
              >
                {s.when}
              </span>
            </div>
            <div
              style={{
                fontFamily: fMono,
                fontSize: 9.5,
                color: bone4,
                letterSpacing: '0.14em',
                marginBottom: 4,
              }}
            >
              {s.tag} · <span style={{ color: bone3 }}>{s.code}</span>
            </div>
            <div style={{ fontFamily: fSans, fontSize: 13.5, color: bone, lineHeight: 1.4 }}>
              {s.title}
            </div>
            {s.exposure > 0 && (
              <div
                style={{
                  marginTop: 10,
                  padding: '4px 8px',
                  border: `1px solid ${s.exposure >= 3 ? amber : ruleStrong}`,
                  background: s.exposure >= 3 ? 'rgba(225,162,58,0.08)' : 'transparent',
                  fontFamily: fMono,
                  fontSize: 10,
                  color: s.exposure >= 3 ? amber : bone2,
                  letterSpacing: '0.12em',
                  display: 'inline-block',
                }}
              >
                {s.exposure} CLAIM{s.exposure > 1 ? 'S' : ''} EXPOSED
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * Format an ISO-8601 timestamp as a local HH:MM string for the chain
 * panel's right-aligned "when" column. Returns the raw input on parse
 * failure (defensive — keeps the layout intact rather than rendering
 * "Invalid Date" or "NaN:NaN" if the API ever returns garbage).
 */
function formatChainWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Format the chain head height as a thousands-separated count.
 * Mirrors the mocked "3,247" aesthetic without hardcoding the value.
 */
function formatHeight(h: number): string {
  return h.toLocaleString('en-US');
}

function ChainPanel() {
  const { data, isLoading } = useConsultantRecentChainBlocks({ limit: 4 });
  const blocks = data?.blocks ?? [];
  const height = data?.height ?? 0;

  return (
    <div style={{ background: ink2, border: `1px solid ${ruleStrong}`, borderRadius: 4 }}>
      <div
        style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${rule}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Diamond size={7} />
          <span style={{ fontFamily: fSerif, fontSize: 16, color: bone, fontWeight: 500 }}>
            Recent chain blocks
          </span>
        </div>
        <MonoLabel size={9} color={bone3}>
          HEIGHT · {formatHeight(height)}
        </MonoLabel>
      </div>
      {isLoading && (
        <div
          style={{
            padding: '24px 18px',
            textAlign: 'center',
            fontFamily: fMono,
            fontSize: 11,
            color: bone3,
            letterSpacing: '0.14em',
          }}
        >
          Loading…
        </div>
      )}
      {!isLoading && blocks.length === 0 && (
        <div
          style={{
            padding: '24px 18px',
            textAlign: 'center',
            fontFamily: fSans,
            fontSize: 13,
            color: bone3,
          }}
        >
          Chain quiet — no blocks today
        </div>
      )}
      {!isLoading &&
        blocks.map((b, i) => (
          <Link
            key={b.id + b.when}
            href={`/consultant/chain?block=${encodeURIComponent(b.id)}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '110px 1fr 70px',
              padding: '12px 18px',
              alignItems: 'center',
              gap: 12,
              borderBottom: i < blocks.length - 1 ? `1px solid ${rule}` : 'none',
              textDecoration: 'none',
              color: 'inherit',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                fontFamily: fMono,
                fontSize: 11.5,
                color: amber,
                letterSpacing: '0.08em',
              }}
            >
              #{b.id}
            </span>
            <div>
              <div
                style={{
                  fontFamily: fMono,
                  fontSize: 10,
                  color: bone3,
                  letterSpacing: '0.16em',
                }}
              >
                {b.kind}
              </div>
              <div
                style={{
                  fontFamily: fMono,
                  fontSize: 10.5,
                  color: bone,
                  letterSpacing: '0.04em',
                  marginTop: 2,
                }}
              >
                {b.claim}
              </div>
            </div>
            <span
              style={{
                fontFamily: fMono,
                fontSize: 10.5,
                color: bone3,
                textAlign: 'right',
              }}
            >
              {formatChainWhen(b.when)}
            </span>
          </Link>
        ))}
    </div>
  );
}
