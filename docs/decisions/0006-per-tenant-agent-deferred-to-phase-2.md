# 0006 — Per-tenant agent platform deferred to Phase 2

**Status:** Deferred
**Date:** 2026-05-07
**Decider:** Aaron
**Phase trigger:** After P9 fully ships and first ~10 paying customers are onboarded

## Context

During the P9 completion session, a vision surfaced for a per-claimant AI agent that would live inside the existing mobile app — starting as an R&D documentation assistant, accumulating evidence + interaction history, and evolving into a "specialist team member" who knows the customer's R&D portfolio in depth. The framing extended to a possible standalone commercial offering once the architecture matured.

The vision is genuinely compelling and architecturally feasible (the platform's existing infrastructure already provides most of the substrate — pgvector, agent_call_cache, prompt registry, RLS-protected tenant isolation, mobile capture pipeline). However, building it competes with launch-blocking work and is not justified ahead of paying-customer feedback.

## Decision

**Defer to Phase 2.** Continue Phase 1 launch (P9 production deploy, Sprint A continuation, customer onboarding) on existing infrastructure. Capture the architectural sketch below as `v0` so future design work has a starting point rather than greenfield.

**Triggers to revisit:**

- ~10 paying customers onboarded with stable usage patterns
- Customer feedback indicates AI assistance is the next high-value gap (vs e.g. more PDF templates, more report types, more integrations)
- Market evidence that "AI team member" framing pulls outside R&DTI (signal that productization is viable)

## v0 architecture sketch

This is the working design as of 2026-05-07. Subject to revision when Phase 2 brainstorming starts.

### Layered memory architecture

The metaphor "holographic memory" translates to a multi-tier persistent memory architecture:

| Tier           | What it holds                                                                                    | Storage                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Working**    | Current conversation context                                                                     | Claude API context window (1M tokens on Sonnet 4.5+)                                |
| **Episodic**   | Every past interaction as semantic embeddings                                                    | `agent_memory_segment` rows in pgvector                                             |
| **Semantic**   | Distilled, structured knowledge about the customer's R&D portfolio                               | `agent_memory_segment` rows of kind 'semantic' (consolidated nightly from episodic) |
| **Procedural** | Customer-specific "how this customer thinks" — terminology, classification patterns, preferences | `tenant_agent_profile` versioned system-prompt fragments                            |

### Schema (v0)

```sql
CREATE TABLE agent_memory_segment (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  subject_tenant_id uuid NOT NULL,
  kind text NOT NULL,                    -- 'episodic' | 'semantic' | 'procedural'
  content text NOT NULL,
  embedding vector(1536),
  source_event_ids uuid[],               -- provenance back to the chain
  created_at timestamptz NOT NULL DEFAULT now(),
  importance numeric(3,2) NOT NULL DEFAULT 0.5,
  last_accessed_at timestamptz NOT NULL DEFAULT now()
) WITH (row level security on);

CREATE INDEX agent_memory_segment_embed_idx
  ON agent_memory_segment USING hnsw (embedding vector_cosine_ops);

CREATE TABLE tenant_agent_profile (
  tenant_id uuid PRIMARY KEY,
  current_system_prompt text NOT NULL,
  version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- audit ledger of evolution events
  evolution_log jsonb NOT NULL DEFAULT '[]'::jsonb
);
```

### Pipeline

- `recall(query, claimant_id, k=5)` — hybrid vector + BM25, top-k segments, weighted by `importance × recency`
- `consolidate(claimant_id)` — nightly background job (pg-boss, already in stack from P9.2). Summarises recent episodic patterns into semantic segments. Decays unused episodic segments.
- `reinforce(segment_id)` — when a segment is referenced in a useful answer, increment `importance` and refresh `last_accessed_at`
- System-prompt evolution — consultant overrides + customer corrections feed `evolution_log` entries that periodically rewrite `current_system_prompt`

### Mobile UI surface (v0)

- New screen `apps/mobile/app/(authed)/agent.tsx` — chat with streaming token output, voice input (existing `use-voice-recorder`), file attachments (existing capture components)
- Agent has a customer-chosen name, persistent identity, visible memory ("I remember you mentioned ... last Tuesday")
- Existing offline queue handles the offline-asked / online-sent case
- ForensicChip + AgentChip already give the visual primitives for showing memory provenance

### Phasing (v0)

| Sub-phase    | Scope                                                              | Calendar (rough)        |
| ------------ | ------------------------------------------------------------------ | ----------------------- |
| A            | Mobile chat surface, RAG over claim data, no memory beyond context | ~2 weeks                |
| B            | Episodic memory tier + recall pipeline                             | ~2 weeks                |
| C            | Consolidation + decay                                              | ~1 week                 |
| D            | Per-tenant procedural memory + system-prompt evolution             | ~2 weeks                |
| E            | "Team member" UX (naming, identity, visible memory)                | ~1 week                 |
| F (optional) | Productization — strip cpa-specific bits, package as standalone    | months, separate effort |

### Cost economics (v0)

At $250/month claimant subscription, with Claude Sonnet 4.5 pricing (~$3/M input + $15/M output) and an estimated 100 conversations/month per claimant at ~25K tokens each:

- Per-claimant Claude cost: ~$15/month
- Margin remaining: ~95%
- Conclusion: Phase 2 is affordable within current pricing structure

### What was deliberately NOT included

- **Per-customer dedicated hardware:** cost shape doesn't fit $250/month tier; logical isolation via RLS + per-tenant agent identity gives the same customer-perceived outcome
- **Custom fine-tuning per customer:** Anthropic doesn't offer it; OpenAI does but operational complexity (versioning, rollback, A/B-testing per-customer weights) far exceeds the ~10% specialization gain over RAG + system-prompt evolution
- **Holographic memory as actual physics tech (e.g. optical storage):** research-grade, not commercially deployable; the architecture above achieves everything the metaphor implies (multi-dimensional, persistent, deepening) using mature tech

## Consequences

- Phase 1 launch path is unchanged: P9 to production, Sprint A continuation, customer onboarding on existing infrastructure
- The `agent_memory_segment` table is **not reserved** in migration index — when Phase 2 starts, it will pick the next free number at that time (Sprint A and other Phase 1 work may add migrations between now and then)
- The mobile app continues with capture-only scope; the chat surface (`apps/mobile/app/(authed)/agent.tsx`) is not built
- If a customer requests AI assistance ahead of Phase 2 readiness, response is "yes, on the roadmap, no fixed date yet" — do not commit to a sub-phase delivery date
- Productization (Phase F) requires a separate strategic decision — likely a different commercial entity if pursued

## Out of scope for this ADR

- Anthropic API contract terms beyond standard usage
- Productization commercial structure (separate company, license, integration partner)
- Cross-domain expansion (legal, accounting, healthcare) — relevant only if Phase F is approved
