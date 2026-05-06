# P9 Implementation Plan — Commercialization + Federation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the platform to first paying tenant via SaaS-grade billing on production GCP + extend with minimum-viable federation primitives across 4 sequenced PRs.

**Architecture:** Four phases, four PRs, ~9 weeks total. Phase 0 = production deployment on GCP `australia-southeast1`. Phase 1 = Stripe billing LIVE (revenue gate). Phase 2 = SaaS-grade billing operations. Phase 3 = federation primitives. Each phase ships independently; later phases deferrable without breaking earlier ones.

**Tech Stack:** GCP (Cloud Run, Cloud SQL Postgres 16, Secret Manager) | Stripe (production + Stripe Tax for AU GST) | Resend (email, from P8) | Sentry + PagerDuty (monitoring, from P8) | Existing TypeScript/Fastify/Next.js/postgres-js stack.

**Design reference:** `docs/plans/2026-05-05-p9-design.md` — comprehensive Components / Data flow / Error handling / Testing detail per phase. Each task below cross-references specific design sections for implementation detail.

**Worktree / branch:** `C:\Users\Aaron\cpa-platform-worktrees\p9` on `p9/design-and-plan` branched from `origin/main` (`6b737b9`).

**Branch hygiene:** Each phase opens its own PR off the latest `main` after the previous merges:
- PR-0: `p9/0-deployment` (Phase 0)
- PR-1: `p9/1-billing-live` (Phase 1)
- PR-2: `p9/2-billing-ops` (Phase 2)
- PR-3: `p9/3-federation` (Phase 3)

This branch (`p9/design-and-plan`) holds ONLY the design + plan docs and opens its own PR for review of the plan itself.

---

## Phase 0 — Production deployment on GCP (~1 week)

**Branch:** `p9/0-deployment` off latest main once design+plan PR merges.

### Task 0.1: GCP project provisioning

**Type:** ops-config

**Files:**
- Create: `tools/gcp/project-bootstrap.sh` — idempotent script that provisions GCP projects + billing
- Create: `tools/gcp/budget-alerts.sh` — Budget alerts at 50%/90%/100% of $200/month
- Create: `docs/runbooks/gcp-project-bootstrap.md` — runbook for re-running

**Steps:**

1. Create production + staging GCP projects via `gcloud projects create cpa-platform-prod` + `cpa-platform-stg`
2. Link billing account to both
3. Enable required APIs: `run.googleapis.com`, `sqladmin.googleapis.com`, `secretmanager.googleapis.com`, `compute.googleapis.com`, `cloudbuild.googleapis.com`, `monitoring.googleapis.com`, `logging.googleapis.com`, `dns.googleapis.com`
4. Configure budget alerts via `gcloud billing budgets create`
5. Create service account `cpa-deploy@cpa-platform-prod.iam.gserviceaccount.com` with roles: Cloud Run Admin, Cloud SQL Admin, Secret Manager Admin, Storage Admin
6. Document everything in `docs/runbooks/gcp-project-bootstrap.md`
7. Commit: `feat(ops): GCP production + staging projects provisioned (P9.0.1)`

**Verification:** `gcloud projects describe cpa-platform-prod` returns active state; budget alerts visible in console; service account exists.

### Task 0.2: Cloud SQL Postgres 16 with pgvector

**Type:** ops-config

**Files:**
- Create: `tools/gcp/cloudsql-provision.sh` — instance creation + pgvector enable + database init
- Create: `tools/gcp/cloudsql-restore-drill.sh` — fresh restore drill (mirrors P8 T1.1 pattern)
- Create: `docs/runbooks/cloudsql.md`

**Steps:**

1. Create Cloud SQL instance via `gcloud sql instances create cpa-prod-db --database-version=POSTGRES_16 --region=australia-southeast1 --tier=db-custom-2-4096 --availability-type=REGIONAL --enable-pgvector`
2. **If `australia-southeast1` capacity error**: fall back to `australia-southeast2`. Document fallback in runbook.
3. Verify pgvector: `gcloud sql connect cpa-prod-db --user=postgres < <(echo "CREATE EXTENSION IF NOT EXISTS vector; SELECT * FROM pg_extension WHERE extname='vector';")` returns row
4. Create databases: `cpa_dev` + `cpa_app` user (matching local convention)
5. Run **migration drill**: clone DB to temp instance, run all 41+ migrations, verify all tables exist + pgvector queries work
6. Configure automated backups: 7-day retention, point-in-time recovery enabled
7. Commit: `feat(ops): Cloud SQL Postgres 16 in australia-southeast1 with pgvector + PITR (P9.0.2)`

**Verification:** Migration drill passes; `\dt` returns 50+ tables; `SELECT * FROM pg_extension WHERE extname='vector'` returns 1 row.

### Task 0.3: Secret Manager + Cloud Run services

**Type:** ops-config

**Files:**
- Create: `tools/gcp/secrets-bootstrap.sh` — creates all secrets from `.env.example`
- Create: `apps/api/Dockerfile` (verify exists, update for production base image)
- Create: `apps/web/Dockerfile`
- Create: `tools/gcp/cloudrun-deploy.sh`
- Create: `docs/runbooks/secret-rotation-gcp.md` (extends P8 T1.5 for Secret Manager specifics)

**Steps:**

1. Create all secrets in Secret Manager via `gcloud secrets create` (DATABASE_URL, DATABASE_URL_APP, SESSION_JWT_SECRET, TOKEN_ENCRYPTION_KEY, ANTHROPIC_API_KEY, GITHUB_APP_*, STRIPE_*, GRAFANA_OTLP_*, SENTRY_DSN_*, RESEND_API_KEY, etc.)
2. Build container images for `apps/api` + `apps/web` via Cloud Build
3. Deploy `cpa-api` Cloud Run service: `gcloud run deploy cpa-api --image gcr.io/cpa-platform-prod/cpa-api --min-instances=1 --max-instances=10 --set-secrets='DATABASE_URL=database-url:latest,...' --region=australia-southeast1`
4. Deploy `cpa-web` Cloud Run service similarly (no min-instances)
5. Verify health: curl `https://cpa-api-<hash>.run.app/healthz` returns 200
6. Commit: `feat(ops): Cloud Run services with Secret Manager integration (P9.0.3)`

**Verification:** Both Cloud Run services healthy; secrets injected into containers verified by env-dump endpoint.

### Task 0.4: DNS + TLS

**Type:** ops-config

**Files:**
- Create: `tools/gcp/dns-bootstrap.sh`
- Create: `docs/runbooks/dns-tls.md`

**Steps:**

1. Register/verify domain ownership at registrar
2. Create Cloud DNS managed zone for production domain
3. Create A/AAAA records pointing at Cloud Run domain mapping
4. Configure domain mapping in Cloud Run for `app.cpaplatform.com.au` (web) and `api.cpaplatform.com.au` (api)
5. Wait for managed TLS provisioning (can take 30 min - 24h)
6. Verify: `curl -v https://app.cpaplatform.com.au/healthz` shows valid cert with 60+ days expiry
7. Commit: `feat(ops): DNS + managed TLS for production domains (P9.0.4)`

**Verification:** Both domains resolve + serve HTTPS with valid cert.

### Task 0.5: Monitoring integration

**Type:** ops-config

**Files:**
- Create: `tools/gcp/monitoring-policies.yaml` — Cloud Monitoring alert policies
- Modify: `apps/api/src/server.ts` — Sentry DSN now from Secret Manager
- Modify: `apps/web/src/instrumentation.ts` — same

**Steps:**

1. Configure Cloud Logging → Sentry routing for production logs
2. Create Cloud Monitoring alert policies: error rate > 5%/min, response time p99 > 2s, Cloud SQL CPU > 80%, Cloud Run min-instances drop
3. Wire alert policies → PagerDuty service (from P8 T1.2)
4. Verify Grafana OTLP from P8 still receives traces from Cloud Run
5. Commit: `feat(ops): Cloud Monitoring + Sentry routing for production (P9.0.5)`

**Verification:** Synthetic error injection routes to Sentry + PagerDuty within 60s.

### Task 0.6: ISO supplier register update

**Type:** doc-conformance

**Files:**
- Create: `docs/iso27001/suppliers/google-cloud.md` — extends P8 T2.12 supplier register

**Steps:**

1. Document GCP as supplier per P8's supplier register format
2. Include: GCP's ISO 27001 cert link, DPA acceptance evidence, AU regional commitment, classification (Restricted — production data residency), services in scope (Cloud Run, Cloud SQL, Secret Manager, Cloud Build, Cloud DNS, Cloud Monitoring, Cloud Logging)
3. Risk classification: Medium (multi-tenant cloud provider; mitigated by data residency + their certs)
4. Commit: `docs(iso27001): supplier register entry for Google Cloud (P9.0.6)`

**Verification:** Document follows P8 supplier-register template; auditor-readable.

### Phase 0 → Phase 1 GATE

Before opening Phase 1 PR: see design doc Testing Layer 3 "Phase 0 → Phase 1 gate" — all 5 items must pass.

---

## Phase 1 — Billing LIVE (~3-4 weeks)

**Branch:** `p9/1-billing-live` off latest main once Phase 0 PR merges.

**Critical reference:** Design doc Section 2 "Phase 1 Components" (P9.1.1 through P9.1.11) for full SQL/Stripe/route detail.

### Task 1.1: Stripe account + Tax setup

**Type:** ops-config

**Steps:**

1. Create Stripe account; verify business + AU ABN
2. Submit AU GST registration via Stripe Tax (1-3 business days approval)
3. Create products + prices in Stripe Dashboard:
   - `Onboarding Fee` ($5,000 AUD one-time)
   - `Per-Claim Fee` ($1,500 AUD metered)
   - `Mobile Subscription` ($250 AUD recurring monthly per quantity)
   - `SLA Bronze` ($750 AUD recurring quarterly)
   - `SLA Silver` ($2,500 AUD recurring quarterly)
   - `SLA Gold` ($7,500 AUD recurring quarterly)
4. Create founding partner coupons: `FOUNDER-001` through `FOUNDER-010`, each 50% off all components for 12 months
5. Note all `price_*` and `coupon_*` IDs; add to Secret Manager
6. Commit: `chore(ops): Stripe account + Tax setup + product catalog (P9.1.1)`

**Verification:** Stripe Tax shows ABN verified; all 6 products created; 10 founding-partner coupons exist.

### Task 1.2: DB migration `0041_subscription_schema.sql`

**Type:** TDD code (migration test pattern)

**Files:**
- Create: `packages/db/migrations/0041_subscription_schema.sql` — see design Section 2 P9.1.2 for full schema
- Create: `packages/db/src/migrations.test.ts` additions
- Modify: `packages/db/migrations/meta/_journal.json` — append idx 41

**Step 1: Write the failing migration test**

```ts
test('migration 0041: subscription tables exist', async () => {
  const tables = await privilegedSql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('subscription', 'subscription_item', 'onboarding_payment',
                          'claimant_mobile_subscription', 'floor_topup_invoice',
                          'founding_partner_slots', 'processed_webhook_events')
  `;
  assert.equal(tables.length, 7, 'all 7 subscription tables exist');
});

test('migration 0041: founding_partner_slots seeded with 10 rows', async () => {
  const count = await privilegedSql<{ count: number }[]>`
    SELECT COUNT(*)::int FROM founding_partner_slots
  `;
  assert.equal(count[0]!.count, 10);
});

test('migration 0041: tenant.tier and billing_mode columns exist', async () => {
  // ... etc per design Section 2 P9.1.2
});
```

**Step 2: Run tests — expect fail (migration doesn't exist)**

```bash
cd C:/Users/Aaron/cpa-platform-worktrees/p9
pnpm --filter @cpa/db test -- --test-name-pattern="migration 0041"
```

**Step 3: Write the migration SQL** per design Section 2 P9.1.2

**Step 4: Run + verify tests pass**

**Step 5: Update journal + commit**

```bash
git add packages/db/migrations/0041_subscription_schema.sql \
        packages/db/migrations/meta/_journal.json \
        packages/db/src/migrations.test.ts
git commit -m "feat(db): migration 0041 — subscription schema + 10 founding-partner slots (P9.1.2)"
```

### Task 1.3: Plan model + Zod types

**Type:** TDD code

**Files:**
- Create: `packages/schemas/src/billing.ts`

**Steps:** Write Zod schemas for `PlanTier`, `SubscriptionStatus`, `DeliveryKind`, `BillingMode`, `TrialStatus`. Test parse + reject patterns. Commit: `feat(schemas): billing types — plan, status, delivery_kind, billing_mode (P9.1.3)`

### Task 1.4: Stripe Checkout endpoint

**Type:** TDD code

**Files:**
- Create: `apps/api/src/routes/billing.ts` — `POST /v1/billing/checkout-session`
- Create: `apps/api/src/routes/billing.test.ts`

**Steps:** TDD pattern. Test: returns valid Stripe Checkout URL with correct line items + GST + founding-partner coupon if quota available. Implement using `@stripe/stripe-node`. Commit: `feat(api): POST /v1/billing/checkout-session (P9.1.4)`

### Task 1.5: Stripe webhook handler

**Type:** TDD code

**Files:**
- Create: `apps/api/src/routes/billing-webhook.ts`
- Create: `apps/api/src/routes/billing-webhook.test.ts` — uses Stripe CLI replay fixtures

**Critical sub-tasks** (each its own commit):

1. Signature verification (use `stripe.webhooks.constructEvent`)
2. Idempotency via `processed_webhook_events.stripe_event_id` PRIMARY KEY (INSERT ON CONFLICT DO NOTHING)
3. Handler for `checkout.session.completed` — activates tenant
4. Handler for `customer.subscription.created/updated/deleted`
5. Handler for `invoice.paid` — clears past_due
6. Handler for `invoice.payment_failed` — triggers dunning email + `past_due` status
7. Handler for `customer.subscription.trial_will_end` — sends day-3 reminder

Test each branch with Stripe CLI fixtures: `stripe trigger checkout.session.completed --override 'metadata[tenant_id]=test-tenant'`

Commits as you go: `feat(api): webhook handler for <event> (P9.1.5.<N>)`

### Task 1.6: Trial → conversion flow

**Type:** TDD code + UX

**Files:**
- Modify: `apps/api/src/routes/auth.ts` — signup creates trial-status tenant
- Create: `apps/web/src/components/trial-banner.tsx` — "X days remaining" + upgrade CTA
- Create: `packages/email/src/templates/trial-day-23-reminder.tsx`
- Create: `apps/api/src/jobs/trial-expiry-cron.ts` — daily check for expiring trials
- Tests for all of the above

**Steps:** Each substep committed separately. See design Section 3 Flow A for the canonical signup-to-paid path.

Commit cadence: `feat(api,web): trial signup + day-23 reminder + expiry archival (P9.1.6.<N>)`

### Task 1.7: Tenant activation gate

**Type:** TDD code

**Files:**
- Modify: `apps/api/src/middleware/auth.ts` — adds activation check
- Create: `apps/api/src/middleware/auth.activation-gate.test.ts`

**Steps:** Test: tenant with `subscription_status='pending'` → 402 Payment Required; `'active'` → pass-through; `'past_due'` → pass-through but with deprecated banner; `'cancelled'` → read-only with explicit error on writes. Commit: `feat(api): tenant activation gate middleware (P9.1.7)`

### Task 1.8: Founding partner attribution

**Type:** TDD code

**Files:**
- Modify: `apps/api/src/routes/billing.ts` (Checkout endpoint)
- Create: `apps/api/src/lib/founding-partner-allocator.ts`
- Tests

**Steps:** Test: checkout for first 10 conversions attaches FOUNDER coupon; 11th doesn't. Concurrency: two parallel conversions both try to claim slot 10 → only one succeeds (use `pg_advisory_xact_lock` per the P7 pattern). Commit: `feat(api): founding partner slot allocator with race-safety (P9.1.8)`

### Task 1.9: Per-claim usage record emitter

**Type:** TDD code

**Files:**
- Create: `apps/api/src/jobs/emit-claim-usage-record.ts`
- Modify: `apps/api/src/routes/claims.ts` — calls emitter on status transition
- Tests

**Steps:** Test: claim transitions to `quarterly_assurance_generated` → Stripe usage record posted; idempotent on re-trigger; failure → retry via pg-boss. Commit: `feat(api): per-claim usage record emitter (P9.1.9)`

### Task 1.10: Mobile bulk-discount quantity sync

**Type:** TDD code

**Files:**
- Create: `apps/api/src/lib/mobile-quantity-sync.ts`
- Modify: `apps/api/src/routes/claimants.ts` — calls sync on subscribe/unsubscribe
- Tests including the bulk-discount math: 1, 2, 3, 4, 5, 6, 7, 8, 9 subs → expected paid_quantity = 1, 2, 2, 3, 4, 4, 5, 6, 6

**Steps:** TDD per the bulk-discount test cases. Concurrency: two simultaneous subscribes use `pg_advisory_xact_lock` to serialize quantity recompute. Commit: `feat(api): mobile bulk-discount quantity sync (P9.1.10)`

### Task 1.11: Phase 1 contract test

**Type:** TDD code

**Files:**
- Create: `apps/api/src/routes/billing.contract.test.ts`

**Steps:** End-to-end test that simulates the full Flow A: signup → trial → conversion → first claim filed → first usage record sent → first dunning recovery scenario. Uses Stripe CLI for webhook replay. Commit: `test(api): Phase 1 contract test — billing live E2E (P9.1.11)`

### Phase 1 → Phase 2 GATE

See design doc Testing Layer 3. **This is the revenue gate.**

---

## Phase 2 — Billing operations (~2-3 weeks)

**Branch:** `p9/2-billing-ops` off latest main once Phase 1 PR merges.

**Reference:** Design doc Section 2 "Phase 2 Components" (P9.2.1 through P9.2.8).

### Task 2.1: SLA tier definitions + plan-change endpoint

**Type:** TDD code

**Files:**
- Create: `packages/schemas/src/sla.ts`
- Create: `apps/api/src/routes/billing-plan.ts` — `POST /v1/billing/change-plan`
- Tests

**Steps:** Define SLA tiers (Bronze/Silver/Gold) + their entitlements. Plan-change endpoint validates: upgrade → immediate proration; downgrade → at-period-end. Commit: `feat(api): SLA tiers + plan-change endpoint (P9.2.1)`

### Task 2.2: Floor top-up cron

**Type:** TDD code

**Files:**
- Create: `apps/api/src/jobs/floor-topup-cron.ts` — pg-boss scheduled job, end-of-month
- Tests

**Steps:** Test cases: tenant with $4K usage → $1K top-up invoice; tenant with $6K usage → no top-up; founding partner tenant with $3K usage → $1K top-up (50% off floor = $2.5K so top-up = $2.5K - $3K wait: actually $0 because $3K > $2.5K). Triple-check the math.

Commit: `feat(api): floor top-up cron with founding-partner discount (P9.2.2)`

### Task 2.3: Embedded Customer Portal

**Type:** TDD code + UX

**Files:**
- Create: `apps/web/src/admin/billing.tsx`
- Create: `apps/api/src/routes/billing-portal.ts` — `POST /v1/billing/portal-session`

**Steps:** Server creates Stripe Customer Portal session; client redirects user to Stripe-hosted page. Configure portal in Stripe Dashboard to allow: payment method updates, invoice history. NOT exposed: plan tier upgrade (handled by us), claimant management. Commit: `feat(api,web): Stripe Customer Portal integration (P9.2.3)`

### Task 2.4: Dunning email templates

**Type:** TDD code (email rendering)

**Files:**
- Create: `packages/email/src/templates/payment-failed.tsx`
- Create: `packages/email/src/templates/subscription-cancelled.tsx`
- Create: `packages/email/src/templates/final-warning.tsx`
- Modify: `apps/api/src/routes/billing-webhook.ts` (Task 1.5) — wire dunning emails to webhook events

**Steps:** TDD: each template renders correctly for Gmail, Outlook, Apple Mail (use `react-email` test utilities). Verify dunning trigger from `invoice.payment_failed` webhook. Commit: `feat(email,api): dunning email templates + wiring (P9.2.4)`

### Task 2.5: AU GST display

**Type:** TDD code + UX

**Files:**
- Modify: `apps/web/src/admin/invoices.tsx` (Task 2.6) — show GST line item
- Modify: email templates — include GST + ABN

**Steps:** Verify Stripe Tax auto-applies 10% AU GST; display on invoice page + receipt emails; format `ABN: <your-ABN>`. Commit: `feat(web,email): AU GST line item display (P9.2.5)`

### Task 2.6: Invoice history page

**Type:** TDD code + UX

**Files:**
- Create: `apps/web/src/admin/invoices.tsx`
- Create: `apps/api/src/routes/invoices.ts` — `GET /v1/invoices` (proxies to Stripe API)
- Tests

**Steps:** Server fetches Stripe invoices for tenant, transforms shape; client renders table with date, amount, status, GST breakdown, PDF download. Commit: `feat(api,web): invoice history page (P9.2.6)`

### Task 2.7: Plan-change handling refinement

**Type:** TDD code

**Files:** Builds on Task 2.1

**Steps:** Edge cases: downgrade SLA when usage exceeds new plan (refuse with helpful error); upgrade mid-period prorates; multi-component plan changes (e.g., upgrade SLA + add seats simultaneously). Commit: `feat(api): plan-change edge cases — downgrade refusal + multi-component (P9.2.7)`

### Task 2.8: Subscription state reconciliation cron

**Type:** TDD code

**Files:**
- Create: `apps/api/src/jobs/subscription-reconcile-cron.ts`

**Steps:** Daily cron compares `subscription` row vs Stripe API; alerts on drift via Sentry. Catches: manual edits in Stripe Dashboard, webhook drops, race conditions. Commit: `feat(api): daily subscription state reconciliation (P9.2.8)`

### Task 2.9: Phase 2 contract test

**Files:** `apps/api/src/routes/billing-ops.contract.test.ts`

**Steps:** E2E: plan change up + down, dunning recovery scenario, floor top-up firing. Commit: `test(api): Phase 2 contract test — billing ops E2E (P9.2.9)`

### Phase 2 → Phase 3 GATE

See design doc Testing Layer 3.

---

## Phase 3 — Federation primitives (~2-3 weeks)

**Branch:** `p9/3-federation` off latest main once Phase 2 PR merges.

**Reference:** Design doc Section 2 "Phase 3 Components" (P9.3.1 through P9.3.8).

### Task 3.1: `delegation_token` schema verification + extensions

**Type:** TDD code (migration if needed)

**Files:**
- Possibly: `packages/db/migrations/0042_delegation_token_extensions.sql`
- Verify: `packages/db/src/schema/delegation_token.ts`

**Steps:** Audit existing schema (added in P1). Required columns per design: id, issuing_tenant_id, redeeming_subject_tenant_id, scope, expires_at, redeemed_at, revoked_at, token_hash. Add missing columns via migration if needed. Add `brand_config jsonb` to financier `subject_tenant`.

Commit: `feat(db): delegation_token schema verified + brand_config column (P9.3.1)`

### Task 3.2: Token issuance API

**Type:** TDD code

**Files:**
- Create: `apps/api/src/routes/federation.ts` — `POST /v1/federation/tokens`
- Tests

**Steps:** Test: consultant issues token for financier subject_tenant; returns one-time URL; SHA256 hashed in DB. Commit: `feat(api): POST /v1/federation/tokens (P9.3.2)`

### Task 3.3: Token list/revoke API

**Type:** TDD code

**Files:**
- Modify: `apps/api/src/routes/federation.ts`
- Tests

**Steps:** GET (list issuing tenant's tokens), DELETE (revoke). Commit: `feat(api): GET + DELETE /v1/federation/tokens (P9.3.3)`

### Task 3.4: Token redemption flow

**Type:** TDD code (security-critical)

**Files:**
- Create: `apps/api/src/routes/federated-redeem.ts` — `GET /federated/redeem?t=...`
- Create: `apps/api/src/routes/federated-redeem.test.ts`

**Steps:** TDD test cases: valid token → 302 redirect to `/federated/{tokenId}` + scoped JWT cookie; expired → 410 Gone; revoked → 410 Gone; already redeemed → 410 Gone; tampered hash → 401. Set `Referrer-Policy: no-referrer`. Commit: `feat(api): federation token redemption flow (P9.3.4)`

### Task 3.5: RLS scoping for federated reads

**Type:** TDD code (security-critical)

**Files:**
- Create: `packages/db/migrations/0043_delegation_token_rls.sql` — RLS policies that check `app.delegation_token_id` GUC
- Create: `packages/db/src/schema/rls-federation.test.ts` — extends P8 T1.4 RLS coverage

**Steps:** TDD security tests: with `delegation_token_id` set, queries return only authorized rows; queries without `delegation_token_id` set BUT with `current_tenant_id` set behave as before; cross-tenant access via federated session is BLOCKED. **All test failures are blockers, not flakes.** Commit: `feat(db): RLS policies for federated session scope (P9.3.5)`

### Task 3.6: Brand JSON injection (XSS-safe)

**Type:** TDD code (security-critical)

**Files:**
- Create: `apps/web/src/lib/brand-injector.tsx`
- Tests

**Steps:** TDD: brand_config strings rendered as text (React auto-escape verified); URL fields use strict `https://` allowlist; XSS attempts blocked (`<script>`, `javascript:`, `data:` URLs all rejected). Commit: `feat(web): XSS-safe brand config injection (P9.3.6)`

### Task 3.7: View-as-financier mode

**Type:** TDD code + UX

**Files:**
- Create: `apps/web/src/app/federated/[tokenId]/layout.tsx` — wraps with brand injection
- Create: `apps/web/src/app/federated/[tokenId]/page.tsx` — assurance reports + claim summaries
- Create: `apps/web/src/app/federated/[tokenId]/claims/[id]/page.tsx`
- Tests

**Steps:** Read-only mode UI; brand applied via Task 3.6; routes whitelist (assurance reports + claim summaries, NO admin); revocation re-check on every request (~1ms penalty acceptable). Commit: `feat(web): view-as-financier read-only mode (P9.3.7)`

### Task 3.8: Token issuance UI

**Type:** TDD code + UX

**Files:**
- Create: `apps/web/src/app/admin/federation/page.tsx`
- Create: `apps/web/src/app/admin/federation/components/token-list.tsx`
- Create: `apps/web/src/app/admin/federation/components/issue-token-form.tsx`

**Steps:** Consultant UI: issue token (select financier + scope + expiry), copy redemption URL, manage active tokens. Commit: `feat(web): federation token management admin UI (P9.3.8)`

### Task 3.9: Phase 3 contract test

**Files:** `apps/api/src/routes/federation.contract.test.ts`

**Steps:** E2E security drill: consultant issues token → financier redeems → views assurance report under brand → consultant revokes → access denied. **Treat any failure as security-critical, not flake.** Commit: `test(api): Phase 3 contract test — federation E2E security drill (P9.3.9)`

### Phase 3 → P9 SHIP GATE

See design doc Testing Layer 3 "Phase 3 → P9 ship".

---

## Total estimates

| Phase | Effort | Calendar | PR target |
|-------|--------|----------|-----------|
| P9.0 deployment | ~1 week | week 1 | PR-0 |
| P9.1 billing live | ~3-4 weeks | weeks 2-5 | PR-1 |
| P9.2 billing ops | ~2-3 weeks | weeks 5-7 | PR-2 |
| P9.3 federation | ~2-3 weeks | weeks 7-9 | PR-3 |
| **Total P9** | **~8-10 weeks** | **~9 weeks** | **4 PRs** |

## Reading order for executor

1. This plan (`docs/plans/2026-05-05-p9-implementation.md`)
2. Design doc (`docs/plans/2026-05-05-p9-design.md`) — referenced throughout
3. Existing codebase architecture (`docs/decisions/0001-architecture-overview.md`, `docs/decisions/0002-identity-and-tenancy.md`)
4. P8 supplier register pattern (`docs/iso27001/suppliers/`) for Task 0.6
5. Existing migration patterns (`packages/db/migrations/`) for Tasks 1.2, 3.1, 3.5

End of P9 implementation plan.
