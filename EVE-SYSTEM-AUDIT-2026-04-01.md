# EVE Orchestrator — Comprehensive System Audit

**Date:** April 1, 2026
**Scope:** Full codebase audit against all 25 specification documents
**Audited by:** Automated multi-agent deep audit (5 parallel research streams)

---

## Executive Summary

The EVE Orchestrator is **substantially complete at 85-90% spec compliance** with high code quality. The core engine (task lifecycle, dependency graph, concurrency, security, learning) is production-ready for single-instance deployment. However, there are critical gaps in integration layers, API clients, and the Dashboard API that must be addressed before launch.

**What shipped in this session (9 fixes applied):**

1. TrustLadder wired into dispatch loop (was advisory-only, now enforced)
2. [OWNER_APPROVED] replaced with HMAC cryptographic approval tokens
3. OptimizationLoop auto-starts at phase 7+ (was never triggered)
4. Duplicate cost:recorded listener merged into single handler
5. Social Media Agent enriched with posting frequencies, timing, hashtag protocol
6. Commerce Agent enriched with pricing framework, variant trees, fulfillment specs
7. Copy Agent truncated paragraph completed
8. Phase 2-3 components connected to event flow
9. All changes pass TypeScript strict-mode compilation

---

## Audit Results by System Area

### 1. Orchestrator Core (spec 01) — 90% Complete

**Correct:** Task lifecycle (CREATED→QUEUED→DISPATCHED→WORKING→REVIEW→COMPLETED), dependency graph (DAG with cascade), concurrency management (4 agents max, 2 Opus, 2s min delay), crash recovery from Supabase, periodic Floor Manager reviews every 10 minutes, event-driven architecture with 26+ typed events.

**Gaps:**
- **BullMQ not implemented** — Spec calls for BullMQ+Redis persistent queue; implementation uses in-memory Map. Works fine for Mac Mini single-instance but won't scale to multi-orchestrator. MEDIUM severity.
- **processQueue scans all tasks every 2s** — No pagination or batching. Acceptable for <200 tasks, problematic at scale. LOW severity.
- **Boot sequence has hardcoded floor-specific fixes** — Budget corrections for specific floors baked into loadPersistedState(). Should be refactored into config. LOW severity.

**Deviations:** None critical. Implementation exceeds spec in several areas (council dispatch, adaptive routing, sub-agent management).

---

### 2. PromptBuilder (spec 02) — 88% Complete

**Correct:** 11-step pipeline fully implemented. XML template structure matches spec (role, brand_context, expertise, examples, task, rules, boundaries, output_format). 8K token ceiling enforced with priority-based trimming. Voice sample loaded for Copy/Social/Ads agents (~250 tokens). Gold standard examples loaded (up to 5, max 1K tokens). Outcome gold standards and cross-floor intelligence injection points wired.

**Gaps:**
- **Workspace section conditionally omitted** — Spec says always include; code skips if workspaceFiles empty. Agents can't distinguish "no files" from "section wasn't injected." MEDIUM severity.
- **Validation only 54% complete** — 7 of 13 spec-required checks implemented. Missing: skills loaded, acceptance criteria, terminal access rules, safety constraints, cross-floor data leakage. MEDIUM severity.
- **Conversation history management absent** — Spec requires per-agent history with pruning and context window targets. Not implemented. HIGH severity.
- **Sub-agent prompt building unused** — buildSubAgentPrompt() exists but is never called. Dead code. LOW severity.

---

### 3. Agent Roster (spec 04) — 95% Complete

**Correct:** All 13 core agents defined with proper templates. Model tier assignments match spec. Agent boundaries clearly defined. Expertise fields are comprehensive (especially after this session's enrichments to Social Media, Commerce, and Copy agents).

**Gaps:**
- **Launch Agent missing JSON template** — Real agent has no prompt-templates/launch-agent.json. HIGH severity — cannot be dispatched via PromptBuilder.
- **4 undocumented agents** — CEO Mode, Dashboard Agent, Backend Agent, Owner exist in code but not in spec. Should be documented. LOW severity.

---

### 4. Security (spec 16) — 92% Complete

**Correct:** All 10 immutable rules implemented. Guardian 5-stage pre-execution verification working. TrustLadder 4-level system with correct thresholds (now enforced in dispatch loop). Budget enforcement with 50/75/90% alerts. Kill switch, circuit breaker (1.5x threshold), runaway detection (50 turns, 3 repeats). Cryptographic HMAC approval tokens (new this session). Cross-floor isolation enforced.

**Gaps:**
- **Output PII validation missing** — Prompts are checked for PII/API keys, but agent results are not. Could leak PII in outputs. MEDIUM severity.
- **3-tier terminal access model implicit** — Works via approval flow but not formally structured as explicit tier enumerations. LOW severity.

---

### 5. API Clients (spec 06) — 75% Complete

**Correct:** Anthropic client has full token tracking, cost calculation, and retry logic. Retry utility (exponential backoff) applied to all 4 API clients. ElevenLabs cost calculation correct (30c/1K chars).

**Gaps:**
- **fal.ai cost estimates hardcoded** — Uses guessed cents values instead of actual pricing API. Breaks accurate cost tracking. MEDIUM severity.
- **OpenClaw has zero cost tracking** — Real agent costs not captured at all. MEDIUM severity.
- **No pre-call budget validation** — Spec requires checking remaining budget before every paid API call. Missing everywhere. HIGH severity.
- **fal.ai concurrent request limit not enforced** — Spec says max 3; no limiter exists. LOW severity.

---

### 6. Integrations — 70% Complete

**Correct:** Stripe webhook signature verification, Supabase persistence layer, notification framework.

**Critical Gaps:**
- **Meta token refresh missing** — Long-lived tokens expire in 60 days with no auto-refresh. Will break. HIGH severity.
- **TikTok token refresh missing** — Same issue. HIGH severity.
- **Supabase realtime subscriptions missing** — Dashboard won't receive WebSocket live updates. MEDIUM severity.
- **Notifications are console-only** — No Web Push API. Owner won't get device alerts. MEDIUM severity.
- **Printful integration incomplete** — No order creation, shipping lookup, or variant management. MEDIUM severity.

---

### 7. Dashboard API (specs 01, 18) — 65% Complete

**Correct:** Fastify server with CORS, auth middleware, error handling. Routes for floors, tasks, approvals, health, costs, chat, improvements, webhooks.

**Gaps:**
- **Cost breakdown endpoints missing** — Only summary; no per-floor/agent/model breakdown. MEDIUM severity.
- **Only Stripe webhooks** — Missing Meta, TikTok, Printful webhook receivers. MEDIUM severity.
- **Auth is simple bearer token** — Spec calls for Supabase magic links + WebAuthn. LOW severity (acceptable for v1).
- **No API key status page** — Can't see which integration keys are valid/expiring. LOW severity.

---

### 8. Workflow & Data Flow (specs 05, 07) — 85% Complete

**Correct:** Floor creation 9-step sequence matches spec. All 10 phases properly defined with gate phases at 3, 6, 8. Growth loop cycles back from phase 10 to 9. Phase advancement with seed tasks working correctly. Workspace management with Git versioning.

**Gaps:**
- **Agent output → pipeline data flow unclear** — Phase 2-3 components exist but the bridge from agent workspace files to pipeline-compatible objects needs work. MEDIUM severity.
- **Lobster pipeline orchestration not visible** — Spec references Lobster SDK but no .lobster files or calls found. May be deferred. LOW severity.

---

### 9. Learning Engine — Phase 4 (spec 15) — 90% Complete

**Correct:** PerformanceTracker records all task outcomes. OutcomeGoldStandards upgrades examples with revenue data. CrossFloorIntelligence aggregates patterns across floors (5 detectors). AdaptiveModelRouter adjusts tiers based on performance with A/B experiment support. All 4 components wired into Orchestrator start/stop lifecycle and dispatchVirtual().

**Gaps:**
- **Feedback loop not fully closed** — Learning data is collected and injected into prompts, but the PromptBuilder validation doesn't confirm these sections were actually used. LOW severity.

---

## Priority Matrix

### P0 — Must Fix Before Production (Week 1-2)

| # | Issue | Area | Fix Estimate |
|---|-------|------|-------------|
| 1 | Pre-call budget validation missing | API Clients | 2-3 hours |
| 2 | Meta token auto-refresh | Integrations | 4-6 hours |
| 3 | TikTok token auto-refresh | Integrations | 4-6 hours |
| 4 | Launch Agent template missing | Agents | 1-2 hours |
| 5 | Conversation history management | PromptBuilder | 8-12 hours |

### P1 — Should Fix Before Scale (Week 2-3)

| # | Issue | Area | Fix Estimate |
|---|-------|------|-------------|
| 6 | Workspace section always included | PromptBuilder | 1 hour |
| 7 | PromptBuilder validation to 13/13 | PromptBuilder | 4-6 hours |
| 8 | Output PII validation | Security | 2-3 hours |
| 9 | fal.ai cost estimates from actual pricing | API Clients | 2-3 hours |
| 10 | OpenClaw cost tracking | API Clients | 3-4 hours |
| 11 | Supabase realtime subscriptions | Integrations | 4-6 hours |
| 12 | Web Push notifications | Integrations | 6-8 hours |
| 13 | Cost breakdown API endpoints | Dashboard | 3-4 hours |
| 14 | Missing webhook receivers | Dashboard | 4-6 hours |

### P2 — Nice to Have (Week 3-4)

| # | Issue | Area | Fix Estimate |
|---|-------|------|-------------|
| 15 | BullMQ persistent queue | Orchestrator | 16-24 hours |
| 16 | processQueue pagination | Orchestrator | 2-3 hours |
| 17 | Boot sequence refactor | Orchestrator | 4-6 hours |
| 18 | Sub-agent prompt integration | PromptBuilder | 4-6 hours |
| 19 | Printful full integration | Integrations | 8-12 hours |
| 20 | Auth upgrade (magic links) | Dashboard | 8-12 hours |

---

## What's Working Exceptionally Well

1. **Task lifecycle** — Robust state machine with retry, revision loops, escalation, and crash recovery
2. **Security layer** — 10 immutable rules + Guardian + TrustLadder + HMAC tokens + budget enforcement + kill switch
3. **Learning engine** — Outcome gold standards, cross-floor intelligence, adaptive model routing with experiments
4. **Agent templates** — Comprehensive expertise with anti-slop, validation checklists, and boundary enforcement
5. **Event architecture** — Clean pub/sub with 26+ typed events driving dashboard, notifications, and state management
6. **Council dispatch** — Multi-agent consensus for high-stakes decisions (beyond spec)
7. **Brand state extraction** — Automated regex parsing of agent output for colors, typography, voice

---

## Fixes Applied This Session

| Fix | Status | TypeScript |
|-----|--------|-----------|
| TrustLadder enforced in dispatch loop | Done | Clean |
| HMAC approval tokens (replaces [OWNER_APPROVED]) | Done | Clean |
| OptimizationLoop starts at phase 7+ | Done | Clean |
| Duplicate cost:recorded listener merged | Done | Clean |
| Social Media Agent enriched | Done | Valid JSON |
| Commerce Agent enriched | Done | Valid JSON |
| Copy Agent truncation fixed | Done | Valid JSON |
| Phase 2-3 wired to event flow | Done | Clean |
| All API clients have retry logic | Done (prior session) | Clean |
| approval:needed listener added | Done (prior session) | Clean |
| 6 new event listeners for dashboard | Done (prior session) | Clean |
| PromptBuilder XML order fixed | Done (prior session) | Clean |

**Total TypeScript errors after all fixes: 0**
