# Monitoring Architecture — CPA Platform

**Last reviewed:** 2026-05-06
**Owner:** Aaron (founder)
**Next review:** 2026-08-06 (quarterly)

---

## Overview

The CPA Platform uses a three-layer monitoring stack to provide full observability across application errors, infrastructure health, database performance, uptime continuity, and on-call escalation. Each layer has a distinct concern; together they eliminate blind spots and provide sub-minute detection for critical failures.

```
                 ┌─────────────────────────────────────────────┐
                 │              PagerDuty                       │
                 │  On-call routing + escalation policies       │
                 └─────────────────┬───────────────────────────┘
                                   │ pages / emails
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
   ┌──────┴──────┐         ┌───────┴──────┐        ┌───────┴──────┐
   │   Sentry    │         │   Grafana    │         │  Sentry Cron │
   │  (errors,   │         │   Cloud      │         │ (heartbeats, │
   │  perf tracing│        │ (metrics,    │         │ missed jobs) │
   │  releases)  │         │  synthetics, │         └──────────────┘
   └──────┬──────┘         │  dashboards) │
          │                └───────┬──────┘
          │                        │
   ┌──────┴──────────────────────┐ │
   │  Application Layer          │ │
   │  Fastify API (Cloud Run)    │◄┘
   │  Next.js Web (Cloud Run)    │
   └─────────────────────────────┘
          │                 │
   ┌──────┴──────┐  ┌───────┴──────┐
   │  Supabase   │  │  OTLP traces │
   │  Postgres   │  │  → Grafana   │
   │  (pg_stat)  │  │  Tempo       │
   └─────────────┘  └──────────────┘
```

---

## Layer 1: Application Monitoring — Sentry

### Purpose

Sentry is the primary error tracking and performance monitoring tool. It captures unhandled exceptions, caught-but-notable errors, performance traces, and release-correlated regressions.

### Projects

| Project name | Service                       | DSN env var      |
| ------------ | ----------------------------- | ---------------- |
| `cpa-api`    | Fastify backend on Cloud Run  | `SENTRY_DSN_API` |
| `cpa-web`    | Next.js frontend on Cloud Run | `SENTRY_DSN_WEB` |

### Error capture policy

- **Unhandled exceptions**: automatically captured by SDK
- **Caught + notable errors**: manually `Sentry.captureException(err, { extra: { ... } })`
- **PII scrubbing**: `authorization` and `cookie` headers are stripped in `beforeSend`; Sentry default scrubbing handles common patterns (emails, IPs in query strings)
- **Fingerprinting**: custom fingerprints on known error classes prevent alert storms (e.g., all "connection pool exhausted" events share one fingerprint)

### Performance tracing

| Environment | `tracesSampleRate` | Rationale                                               |
| ----------- | ------------------ | ------------------------------------------------------- |
| production  | 0.10 (10%)         | Keeps cost predictable; enough for P95 latency trending |
| staging     | 0.50 (50%)         | Higher fidelity for pre-launch validation               |
| development | 1.00 (100%)        | Full visibility during local development                |

### Alerting rules (Sentry)

| Alert                                | Condition                                      | Notification    |
| ------------------------------------ | ---------------------------------------------- | --------------- |
| Critical exception rate              | >5 unique errors in 5 min                      | PagerDuty page  |
| New issue — unhandled                | Any first occurrence                           | PagerDuty email |
| Regression — resolved issue re-opens | Any                                            | PagerDuty email |
| P95 endpoint latency                 | >2000ms over 10-min window                     | PagerDuty email |
| Release spike                        | Error rate 2x baseline within 15 min of deploy | PagerDuty email |

### OpenTelemetry integration

The existing `packages/observability` OTLP setup sends traces to Grafana Tempo. Sentry's `@sentry/opentelemetry` adapter is configured as a parallel span processor so that Sentry errors include a `trace_id` that cross-links to Grafana Tempo. This gives full request-level correlation: Sentry error → Grafana trace → Pino log line.

### Sentry Cron monitors

Cron jobs emit heartbeat check-ins. A missed heartbeat triggers a PagerDuty email (not page, unless it's the backup restore cron which is P1).

| Monitor                | Schedule               | Grace period | Severity if missed |
| ---------------------- | ---------------------- | ------------ | ------------------ |
| Backup restore drill   | Monthly                | 4 h          | P1 (page)          |
| Weekly digest email    | Weekly, Mon 09:00 AEST | 2 h          | P3 (email)         |
| RIF classification job | Every 15 min           | 5 min        | P2 (email)         |

---

## Layer 2: Infrastructure Monitoring — Grafana Cloud

### Metrics stack

The platform uses the existing OTLP→Grafana pipeline in `packages/observability`. Metrics are exported from the Fastify API via OpenTelemetry SDK. Cloud Run also emits native metrics to Google Cloud Monitoring which are federated into Grafana via the GCP data source plugin.

### Key dashboards

| Dashboard        | Panels                                                          | Alert threshold           |
| ---------------- | --------------------------------------------------------------- | ------------------------- |
| API health       | Request rate, error rate, P50/P95/P99 latency, active instances | Error rate >1% over 5 min |
| Cloud Run infra  | CPU utilisation, memory, instance count, cold-start rate        | CPU >80% sustained 10 min |
| Supabase DB      | Connection pool usage, query rate, pg_stat active queries       | Pool >90% for 2 min       |
| Synthetic uptime | Success rate, response time per probe                           | <100% over 5 min          |

### Synthetic uptime probes

Three probes run from Grafana Synthetic Monitoring, 1-minute interval, from Sydney region (closest to AEST customers):

| Probe          | URL                                                                | Method | Auth          | Threshold         |
| -------------- | ------------------------------------------------------------------ | ------ | ------------- | ----------------- |
| Health check   | `https://api.cpaplatform.com/healthz`                              | GET    | None          | <500ms; HTTP 200  |
| Auth me        | `https://api.cpaplatform.com/v1/auth/me`                           | GET    | Synthetic JWT | <1000ms; HTTP 200 |
| Audit timeline | `https://api.cpaplatform.com/v1/audit/activity/<test-id>/timeline` | GET    | Synthetic JWT | <2000ms; HTTP 200 |

All probes alert after 2 consecutive failures. Alert sends to PagerDuty with P1 severity.

### Infrastructure alert thresholds

| Signal                   | Warning       | Critical      | Action                                         |
| ------------------------ | ------------- | ------------- | ---------------------------------------------- |
| CPU utilisation          | 70% for 5 min | 85% for 5 min | Scale Cloud Run min instances                  |
| Memory utilisation       | 75% for 5 min | 90% for 5 min | Investigate memory leak; redeploy              |
| Request latency P95      | 1500ms        | 3000ms        | Check downstream DB; check Sentry traces       |
| Error rate (5xx)         | 0.5%          | 1.0%          | Check Sentry; recent deploy regression likely  |
| Cloud Run instance count | >8            | >12           | Cost anomaly; possible traffic spike or loop   |
| DB connection pool       | 80%           | 90%           | Check slow queries; add read replica if needed |

---

## Layer 3: Database Monitoring — Supabase + pg_stat_statements

### Supabase dashboard

The Supabase project dashboard provides:

- Real-time query performance (slow query log, top queries by total time)
- Connection pool status (pgBouncer metrics)
- Database size and table bloat indicators
- Replication lag (if read replicas are configured)

### pg_stat_statements

`pg_stat_statements` is enabled on the Supabase project. Key queries for weekly review:

```sql
-- Top 10 queries by total execution time (run weekly)
SELECT
  left(query, 100)         AS query_snippet,
  calls,
  total_exec_time::bigint  AS total_ms,
  mean_exec_time::bigint   AS mean_ms,
  rows / calls             AS rows_per_call
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;

-- Queries with high mean execution time (potential missing indexes)
SELECT
  left(query, 100)         AS query_snippet,
  calls,
  mean_exec_time::bigint   AS mean_ms,
  stddev_exec_time::bigint AS stddev_ms
FROM pg_stat_statements
WHERE mean_exec_time > 100   -- ms
  AND calls > 10
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### Database alert thresholds

| Signal                     | Threshold                   | Response                                        |
| -------------------------- | --------------------------- | ----------------------------------------------- |
| Slow query                 | P99 > 500ms sustained 5 min | Investigate; likely missing index or N+1        |
| Connection pool saturation | >90% for 2 min              | Emergency: increase pool size or shed load      |
| Table bloat                | Dead tuples >20% of live    | Schedule VACUUM ANALYZE                         |
| WAL lag                    | >5 min behind on replica    | Investigate replica connectivity                |
| DB disk usage              | >80%                        | Provision more storage; review retention policy |

### Retention

- Application query logs: Supabase default retention (7 days; upgrade to extend)
- `audit_log` table: 7 years (append-only, as per architecture rules)
- `pg_stat_statements`: reset weekly via `SELECT pg_stat_statements_reset()`; results exported to Grafana before reset

---

## Uptime Monitoring and SLO

### Service Level Objectives

| SLO                  | Target  | Measurement window | Measurement method                 |
| -------------------- | ------- | ------------------ | ---------------------------------- |
| API availability     | 99.9%   | Rolling 30 days    | Grafana synthetic `/healthz` probe |
| Web availability     | 99.9%   | Rolling 30 days    | Grafana synthetic home-page probe  |
| API P95 latency      | <1500ms | Rolling 7 days     | Grafana API latency dashboard      |
| Successful auth rate | >99.5%  | Rolling 7 days     | Sentry auth-error rate             |

### Error budget

99.9% over 30 days = 43.8 minutes of allowed downtime per month.

When the error budget is >50% consumed in the first half of the month, trigger a P2 incident review and freeze non-critical deploys.

### Status page

A public status page at `status.cpaplatform.com` (Betterstack or equivalent) is updated automatically by Grafana synthetic monitoring. Customer-facing incidents are communicated here within 15 minutes of a P1 declaration.

---

## On-Call and PagerDuty Integration

### PagerDuty service

**Service name:** CPA Platform Production
**Escalation policy:** CPA Platform On-Call

| Step | Responder                                | Contact method                | Delay                       |
| ---- | ---------------------------------------- | ----------------------------- | --------------------------- |
| 1    | Aaron                                    | PagerDuty mobile push + phone | Immediate                   |
| 2    | Aaron                                    | Email + SMS                   | +15 min if not acknowledged |
| 3    | Backup contact (designate before launch) | Phone                         | +30 min if not acknowledged |

### Integration sources

| Source      | Event types                              | PagerDuty severity |
| ----------- | ---------------------------------------- | ------------------ |
| Sentry      | Critical exceptions, error rate spikes   | P1 (page)          |
| Sentry      | New issues, regressions, latency alerts  | P2 (email)         |
| Grafana     | Synthetic probe failure (2+ consecutive) | P1 (page)          |
| Grafana     | CPU/memory/latency threshold breach      | P2 (email)         |
| Sentry Cron | Backup restore drill missed              | P1 (page)          |
| Sentry Cron | Other cron heartbeat missed              | P3 (email)         |

### Severity definitions

| Severity | Definition                                                         | Response SLO                                            |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| P1       | Site down, data loss risk, auth completely broken                  | Acknowledge in 5 min; war room in 15 min                |
| P2       | Degraded performance, partial feature failure, high error rate     | Respond within 30 min; status page update within 15 min |
| P3       | Non-customer-impacting warning, missed job, anomaly to investigate | Triage next business day                                |

---

## Observability Verification Checklist

Run this checklist after any major infrastructure change or once per quarter:

- [ ] Synthetic probe failures correctly page on-call via PagerDuty
- [ ] Sentry receives errors from both `cpa-api` and `cpa-web` projects
- [ ] Sentry trace IDs appear in Grafana Tempo (cross-linking working)
- [ ] PagerDuty escalation fires at step 2 if step 1 is not acknowledged within 15 min
- [ ] `pg_stat_statements` query available in Supabase SQL editor
- [ ] Cloud Run metrics visible in Grafana GCP data source dashboard
- [ ] Sentry Cron monitor for backup drill shows last check-in within expected window
- [ ] Status page reflects current synthetic probe state

---

## Related documents

- `docs/monitoring/alert-runbook.md` — Alert response procedures and escalation playbooks
- `docs/runbooks/on-call.md` — On-call procedures (T1.2 / T1.9)
- `docs/runbooks/backup-restore.md` — Backup and DR procedures (T1.1)
- `packages/observability/src/tracer.ts` — OTLP tracer configuration
- `tools/monitoring/sentry-config.ts` — Sentry SDK initialisation reference
- `tools/monitoring/health-check.sh` — Synthetic health check script
