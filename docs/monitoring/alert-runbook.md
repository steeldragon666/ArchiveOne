# Alert Response Runbook — CPA Platform

**Last reviewed:** 2026-05-06
**Owner:** Aaron (founder / primary on-call)
**Next review:** 2026-08-06 (quarterly, or after any P1 incident)

This runbook defines response procedures for all production alerts. Read
`docs/monitoring/monitoring-architecture.md` for the full monitoring stack.

---

## Quick-reference severity matrix

| Severity | Definition | Acknowledge | War room | Status page |
|---|---|---|---|---|
| **P1 — Site down** | Platform unavailable or data integrity at risk | 5 min | 15 min | Immediately |
| **P2 — Degraded** | Significant but partial service degradation | 30 min | If escalated | Within 15 min |
| **P3 — Warning** | Below-threshold issue; no immediate customer impact | Next business day | No | No |

---

## P1 — Critical: Site down or data loss risk

### Triggers

- Grafana synthetic probes fail for 2+ consecutive checks (>2 min down)
- Sentry critical exception rate exceeds threshold (>5 unique errors in 5 min)
- Auth is completely broken (all `/v1/auth/me` requests returning 5xx)
- Database connection pool exhausted (no requests completing)
- WAL archiving stopped (data loss window growing past RPO)
- Backup restore drill missed and not re-run within grace period

### Step 1 — Acknowledge (within 5 minutes of page)

1. Acknowledge the PagerDuty alert on mobile app or web UI.
2. Post in the incident Slack channel (or equivalent): "ACK — investigating — [timestamp]".
3. Open Sentry (cpa-api and cpa-web dashboards) to identify the error.
4. Open Grafana dashboards: API health, Cloud Run infra, Supabase DB.

### Step 2 — Declare war room (within 15 minutes if not resolved)

If the issue is not resolved within 15 minutes of acknowledgement:

1. Open a dedicated incident channel: `#incident-YYYYMMDD-<short-description>`.
2. Copy the incident template from `docs/iso27001/incidents/post-incident-review-template.md`.
3. Assign roles (for solo: all = Aaron; designate a backup contact if available).
4. Notify any affected tenants via the status page (update `status.cpaplatform.com`).
5. Post an initial message: "P1 incident in progress. Impact: [describe]. ETA unknown. Updates every 10 min."

### Step 3 — Contain

Common P1 scenarios and first-response containment:

**Scenario A: Cloud Run service crashed / all instances restarting**

```bash
# Check Cloud Run revision status
gcloud run revisions list --service=cpa-api --region=australia-southeast1

# If the last deploy is bad, route traffic to the previous revision
gcloud run services update-traffic cpa-api \
  --region=australia-southeast1 \
  --to-revisions=PREVIOUS_REVISION_ID=100
```

**Scenario B: Database connection pool exhausted**

```sql
-- Check active connections (run via Supabase SQL editor)
SELECT count(*), state, wait_event_type, wait_event
FROM pg_stat_activity
WHERE datname = 'postgres'
GROUP BY state, wait_event_type, wait_event
ORDER BY count DESC;

-- Identify and terminate blocking long-running queries (>5 min)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'postgres'
  AND state != 'idle'
  AND query_start < now() - interval '5 minutes';
```

**Scenario C: High error rate from a recent deploy**

```bash
# Roll back to the last known-good revision
gcloud run services update-traffic cpa-api \
  --region=australia-southeast1 \
  --to-revisions=LAST_GOOD_REVISION=100

# Verify Sentry error rate drops within 60s
```

**Scenario D: Supabase platform outage (not our fault)**

1. Check status.supabase.com for active incidents.
2. Update the status page: "Platform degraded due to database provider incident. We are monitoring."
3. No action possible until provider resolves; continue updating customers every 30 min.

### Step 4 — Eradicate

Once the immediate customer impact is stopped:

1. Identify the root cause in Sentry + Grafana (trace the error back to a deployment, config change, or upstream change).
2. Implement the fix (code change, config rollback, or workaround).
3. Deploy the fix via CI (never hotfix-patch production manually unless absolutely unavoidable; document if so).
4. Verify: synthetic probes green, error rate back to baseline, Sentry issue resolved.

### Step 5 — Recover

1. Close the war room channel with a summary post.
2. Update the status page: "Incident resolved at [timestamp]. All systems operating normally."
3. Notify affected tenants directly if their sessions were affected.

### Step 6 — Post-incident (within 48 hours)

1. Fill in the post-incident review template: `docs/iso27001/incidents/post-incident-review-template.md`.
2. Log the incident in `docs/iso27001/incidents/incidents-log.md`.
3. Create follow-up issues for each preventive action identified.
4. If any ISO Annex A control failed or was absent, note it for the next SoA review.

---

## P2 — Degraded: significant but partial failure

### Triggers

- P95 API latency exceeds 1500ms for more than 10 minutes
- Error rate (5xx) between 0.5% and 1.0% sustained over 5 minutes
- Partial feature unavailability (e.g., narrative generation timing out, but auth works)
- Sentry: new issue or resolved-issue regression in a critical user path
- RIF classification cron missing 2+ consecutive runs
- Memory or CPU utilisation at warning threshold sustained for 10 minutes

### Response procedure (within 30 minutes)

1. Acknowledge the PagerDuty email/notification.
2. Update the status page within 15 minutes with a brief message: "Investigating degraded performance. Impact: [feature]. No data loss."
3. Open Sentry + Grafana to identify the root cause.
4. Follow the relevant containment steps from the P1 section above if applicable.
5. If resolution will take >2 hours, escalate to P1 and open a war room.
6. Resolve and update the status page with the resolution.
7. Log the incident in `docs/iso27001/incidents/incidents-log.md` within 24 hours.

### Common P2 scenarios

**Slow queries degrading API performance**

```sql
-- Identify the slow query via Supabase SQL editor
SELECT
  left(query, 200) AS query,
  calls,
  mean_exec_time::bigint AS mean_ms,
  total_exec_time::bigint AS total_ms
FROM pg_stat_statements
WHERE mean_exec_time > 200
ORDER BY total_exec_time DESC
LIMIT 10;

-- Check for missing index opportunities
EXPLAIN (ANALYZE, BUFFERS) <paste slow query here>;
```

**Memory pressure on Cloud Run instances**

```bash
# Check Cloud Run resource metrics in Grafana; if memory is spiking:
# 1. Check for recent deploys that could have introduced a leak
# 2. Increase min/max memory in Cloud Run service config if justified
# 3. Redeploy to trigger fresh instances
gcloud run services update cpa-api \
  --region=australia-southeast1 \
  --memory=1Gi  # increase if needed
```

---

## P3 — Warning: below-threshold anomaly

### Triggers

- CPU or memory at warning threshold (not sustained at critical)
- Sentry: high-severity issue with low frequency (not breaching rate threshold)
- Weekly digest cron missed
- DB disk usage approaching 80%
- Dependabot security alert (non-critical)
- Error budget at 25% consumed with >15 days remaining in the month

### Response procedure (next business day)

1. Review the alert in PagerDuty / Sentry / Grafana.
2. Triage and create a follow-up issue with appropriate priority.
3. No status page update required unless customer-visible.
4. No log entry required unless it turns out to be a symptom of a larger issue.

---

## Alert fatigue prevention

Alert fatigue is the primary cause of on-call burnout and missed real incidents. Apply these guidelines to maintain signal quality.

### Guidelines

1. **Page only for customer-impacting issues.** P3 warnings must never produce a phone call or push notification. If any P3 is paging, demote it.

2. **Every alert must have a runbook step.** If an alert fires and there is no clear action, either add the action or convert the alert to an informational dashboard panel.

3. **Review alert noise monthly.** During the monthly operational review, count false-positive pages (alerts that fired but resolved without human action). Target: <10% of all pages are false positives.

4. **Tune thresholds after every false positive.** A false positive is not evidence that the alert is bad; it is evidence that the threshold is wrong. Raise it. Document the change.

5. **Suppress flapping.** All alerts require 2+ consecutive failures before firing. Single-probe blips are not incidents.

6. **Group related alerts.** Sentry fingerprinting ensures related errors share one issue. PagerDuty deduplication ensures one page per active incident, not one per occurrence.

7. **Avoid alert overloading deploys.** New deployments temporarily elevate error counts while instances restart. Configure a 3-minute suppression window on error-rate alerts triggered by deploy events.

8. **Blameless postmortems.** When a real alert fires, the review question is "what would have prevented this page?" not "who caused this?". Runbooks improve through postmortems.

### Alert audit cadence

| Review | Frequency | Owner | Output |
|---|---|---|---|
| False-positive review | Monthly | Aaron | List of tuned thresholds |
| Alert coverage review | Quarterly | Aaron | New alerts for uncovered failure modes |
| Runbook accuracy review | After each P1 incident | Aaron | Runbook updates from learnings |
| Full alert audit | Annually | Aaron (+ fractional CISO for ISO evidence) | Signed-off alert register |

---

## Contact and escalation directory

| Role | Contact | Available |
|---|---|---|
| Primary on-call | Aaron | 24/7 via PagerDuty |
| Backup (designate before launch) | [TBD] | 24/7 via PagerDuty step 3 |
| Supabase support | support.supabase.com | Business hours; P1 SLA if on paid plan |
| Google Cloud support | cloud.google.com/support | 24/7 on Premium support |
| Sentry support | sentry.io/support | Business hours |
| PagerDuty support | pagerduty.com/support | Business hours |

---

## Linked references

- `docs/monitoring/monitoring-architecture.md` — Full monitoring stack documentation
- `docs/runbooks/on-call.md` — On-call procedures (T1.2 / T1.9)
- `docs/iso27001/incidents/incident-management-plan.md` — ISO A.5.24 formal plan
- `docs/iso27001/incidents/post-incident-review-template.md` — Post-incident template
- `tools/monitoring/health-check.sh` — Synthetic health check script
