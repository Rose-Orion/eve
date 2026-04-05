# EVE → 100% Plan

**Goal:** Close every gap identified in the April 1 audit. Zero open findings.
**Baseline:** 85-90% spec compliance. 20 gaps across 3 priority tiers.
**Estimated total:** 5 phases, ~80-100 hours of implementation work.

Each phase is self-contained and can be executed in a single session with the `do` skill. Phases must run in order — later phases depend on earlier ones.

---

## Phase 1: Critical Security & Budget (P0)

**Why first:** These are safety-critical. A floor could overspend or approve unauthenticated actions without them.

### Task 1.1: Pre-call budget validation in API clients

**What:** Add a `canAfford()` check before every paid API call. `BudgetEnforcer.canAfford(floorId, estimatedCostCents)` already exists (budget-enforcer.ts:37-49) and returns `{ allowed, reason }`. It is NOT called from any API client today.

**Files to modify:**
- `src/clients/anthropic.ts` — Before the `anthropic.messages.create()` call, check budget. The function receives `taskId` and model tier but not `floorId`. The `VirtualDispatcher` calls this — propagate `floorId` through.
- `src/clients/fal.ts` — Before `fal.subscribe()`, check budget. Same propagation needed.
- `src/clients/openai.ts` — Before `openai.images.generate()`, check budget.
- `src/clients/elevenlabs.ts` — Before the ElevenLabs fetch, check budget.
- `src/orchestrator/virtual-dispatcher.ts` — Pass `floorId` into the Anthropic client call.

**Pattern to follow:** The Guardian check in `processQueue()` (orchestrator/index.ts:4524-4533) already calls `canAfford` at dispatch time. The client-level check is a second gate that catches cost estimate drift.

**Implementation:**
1. Add `floorId: string` parameter to each client's generate/call function signature
2. Import `BudgetEnforcer` singleton or pass it through — **simpler approach**: create a `checkBudget(floorId: string, estimatedCents: number): void` function in a shared module that throws `BudgetExceededError` if `canAfford` returns false
3. Call `checkBudget()` at the top of each API function
4. Catch `BudgetExceededError` in `dispatchVirtual` and `dispatchReal` to handle gracefully

**Anti-patterns:** Do NOT hardcode budget limits in clients. Do NOT skip the check for "small" calls. Do NOT make clients depend directly on Orchestrator.

**Verification:**
- `grep -r "canAfford\|checkBudget" src/clients/` shows calls in all 4 client files
- TypeScript compiles clean: `npx tsc --noEmit`

### Task 1.2: Meta token auto-refresh

**What:** Meta long-lived tokens expire in 60 days. Add a refresh mechanism that exchanges the token 7 days before expiry.

**Current state:** `src/integrations/meta.ts` has no token management at all. `getMetaConfig()` returns null (line 17-19). Tokens come from floor-level config after OAuth.

**Files to create:**
- `src/integrations/token-manager.ts` (NEW) — Manages token lifecycle for Meta and TikTok

**Implementation:**
1. Create `TokenManager` class with `refreshIfNeeded(provider, floorId)` method
2. For Meta: call `GET /oauth/access_token?grant_type=fb_exchange_token&client_id={app_id}&client_secret={app_secret}&fb_exchange_token={short_token}` to get a new long-lived token
3. Store token with `expiresAt` timestamp in Supabase `floor_tokens` table
4. Add a periodic check (every 6 hours) in the Orchestrator's start() method
5. Emit `token:refreshed` and `token:refresh-failed` events

**Anti-patterns:** Do NOT store tokens in environment variables. Do NOT refresh on every API call (cache the check). Do NOT log token values.

**Verification:**
- `grep -r "refreshIfNeeded\|TokenManager" src/` shows integration
- Token refresh function can be tested with a mock endpoint

### Task 1.3: TikTok token auto-refresh

**What:** TikTok OAuth tokens also expire. Same pattern as Meta.

**Current state:** `src/integrations/tiktok.ts` receives `accessToken` as a parameter (line 13, 41, 63). No refresh mechanism.

**Implementation:** Add TikTok refresh to the same `TokenManager` from Task 1.2:
1. TikTok OAuth2 refresh: `POST https://open.tiktokapis.com/v2/oauth/token/` with `grant_type=refresh_token`
2. Same periodic check, same event emission
3. Update `tiktok.ts` functions to pull token from TokenManager instead of requiring it as a parameter

**Verification:**
- `grep "tiktok" src/integrations/token-manager.ts` shows TikTok refresh logic

### Task 1.4: Create Launch Agent template

**What:** `prompt-templates/launch-agent.json` doesn't exist. Launch Agent is a real (OpenClaw) agent but needs a template for PromptBuilder.

**Current state:** 12 templates exist. Launch Agent is missing. It's registered as a real agent (spec 04).

**File to create:**
- `prompt-templates/launch-agent.json` (NEW)

**Implementation:** Follow the pattern of other Opus-tier agent templates. Launch Agent responsibilities from spec:
- Coordinate launch sequence (staging → QA → go-live)
- Execute DNS setup, SSL, domain connection
- Verify all integrations are live (Stripe, email, analytics)
- Run pre-launch checklist
- Coordinate with Floor Manager on launch timing
- Monitor first 48 hours post-launch

**Fields:** agentId: "launch-agent", role, expertise (launch checklists, DNS/SSL, integration verification, monitoring), rules (Tier 3 terminal access — can execute commands), boundaries, outputFormat, brandContextFields, usesVoiceSample: false, antiSlopEnabled: false, actionsEnabled: true with deployment actions.

**Verification:**
- File exists and is valid JSON: `node -e "require('./prompt-templates/launch-agent.json')"`
- Template loads in PromptBuilder: `grep "launch-agent" src/prompt-builder/template-loader.ts` confirms dynamic loading

### Task 1.5: Conversation history management in PromptBuilder

**What:** Spec requires PromptBuilder to manage per-agent conversation history with pruning. The `ConversationStore` class ALREADY EXISTS (conversation-store.ts) with context targets (Opus 30K, Sonnet 20K, Haiku 8K) and pruning logic. But PromptBuilder doesn't use it — it only builds the system prompt.

**Current state:** `ConversationStore` (conversation-store.ts:33) has `addMessage()`, `getMessages()` with token-aware pruning. It's already called in `dispatchVirtual()` (orchestrator/index.ts:4697-4699, 4839-4840). The PromptBuilder spec says it should also manage history, but actually the Orchestrator already handles this correctly by calling `conversationStore.getMessages()` with `systemPromptTokens` and passing the result to the VirtualDispatcher.

**The actual gap:** PromptBuilder's `build()` method doesn't report back how many tokens the system prompt consumed, which is needed for accurate history budgeting. Currently `dispatchVirtual` passes a hardcoded `4000` for `systemPromptTokens`.

**Files to modify:**
- `src/prompt-builder/index.ts` — Ensure `AssembledPrompt` includes `tokenCount` (it likely already does from step 10 of the pipeline)
- `src/orchestrator/index.ts` — In `dispatchVirtual()`, use the actual system prompt token count from PromptBuilder instead of hardcoded `4000`

**Verification:**
- `grep "systemPromptTokens\|4000" src/orchestrator/index.ts` shows the actual token count being used
- `grep "tokenCount" src/prompt-builder/index.ts` shows it's returned from build()

### Phase 1 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `grep "canAfford\|checkBudget" src/clients/` — all 4 clients
- [ ] `ls prompt-templates/launch-agent.json` — exists
- [ ] `grep "refreshIfNeeded" src/integrations/` — token refresh in place
- [ ] No hardcoded `4000` for system prompt tokens in orchestrator

---

## Phase 2: PromptBuilder & Validation Completeness (P1a)

**Why second:** PromptBuilder quality directly affects every agent's output. Fix this before fixing individual integrations.

### Task 2.1: Always include workspace section

**What:** PromptBuilder only includes `<workspace>` if `workspaceFiles` is non-empty (index.ts:122-126). Spec says always include it.

**File to modify:** `src/prompt-builder/index.ts`

**Implementation:** Change lines 122-126 from conditional to always-included:
```typescript
// 6. Workspace (priority 6) — always include, even if empty
const workspaceSection = await this.buildWorkspaceSection(input.workspaceFiles ?? []);
sections.push(workspaceSection);
```
Update `buildWorkspaceSection` to handle empty arrays gracefully — return `<workspace>No workspace files available for this task.</workspace>` when empty.

**Verification:**
- `grep "buildWorkspaceSection" src/prompt-builder/index.ts` — called unconditionally

### Task 2.2: Complete validation to 13/13

**What:** Only 7 of 13 spec-required validation checks are implemented. Add the missing 6.

**File to modify:** `src/prompt-builder/index.ts` — the `validate()` method

**Missing checks to add:**
1. Skills/expertise loaded (check `<expertise>` section is non-empty)
2. Task has acceptance criteria (check task section contains criteria or output spec)
3. Workspace reflects current state (check `<workspace>` section present — will be true after 2.1)
4. Rules include terminal access tier (check rules section contains "Tier 1/2/3")
5. Rules include safety constraints (check rules section contains "SAFETY")
6. No cross-floor data leakage (check no other floor IDs appear in prompt text)

**Pattern to follow:** Existing checks at validate() method — each check pushes to `errors[]` or `warnings[]` array.

**Verification:**
- Count validation checks in validate() method — should be 13
- `npx tsc --noEmit` — clean

### Task 2.3: Output PII validation

**What:** Agent prompts are checked for PII/API keys before dispatch, but agent RESULTS are not checked before persistence. A hallucinating agent could output PII.

**Files to modify:**
- `src/security/guardian.ts` — Add `checkOutputPII(content: string): string[]` method
- `src/orchestrator/index.ts` — After `recordResult()` in `dispatchVirtual()`, call output PII check. If violations found, redact and log.

**Implementation:**
1. Reuse the existing PII regex patterns from Guardian's input check
2. Add email, phone, SSN, credit card regex patterns
3. Call after result but before persistence — redact matches with `[REDACTED]`
4. Emit `security:pii-detected` event for dashboard visibility

**Anti-patterns:** Do NOT block the task on PII detection (it already completed). Do NOT delete the result. Redact in place and log.

**Verification:**
- `grep "checkOutputPII\|pii-detected" src/` — shows both check and event

### Task 2.4: Fix gold standard example count

**What:** Spec says 2-3 most recent examples. Code takes up to 5 (MAX_EXAMPLES=5 in example-loader.ts:13).

**File to modify:** `src/prompt-builder/example-loader.ts` — Change `MAX_EXAMPLES = 5` to `MAX_EXAMPLES = 3`

**Verification:** `grep "MAX_EXAMPLES" src/prompt-builder/example-loader.ts` — shows 3

### Phase 2 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] Workspace section always present (no conditional)
- [ ] 13 validation checks in validate() method
- [ ] Output PII check exists
- [ ] MAX_EXAMPLES = 3

---

## Phase 3: API Clients & Integrations (P1b)

**Why third:** With budget validation and PromptBuilder fixed, now fix the API layer.

### Task 3.1: Fix fal.ai cost estimates

**What:** Cost estimates are hardcoded guesses (5c for FLUX, 3c for others). Replace with accurate pricing.

**File to modify:** `src/clients/fal.ts`

**Implementation:**
1. Create a `FAL_COST_MAP` lookup table with actual per-model pricing:
   - `fal-ai/flux/dev`: 5 cents/image
   - `fal-ai/flux-pro`: 5 cents/image
   - `fal-ai/recraft-v3`: 4 cents/image
   - `fal-ai/ideogram/v2`: 4 cents/image
   - Video models: cost based on duration (5s=15c, 10s=25c, 30s=50c)
2. Replace hardcoded `costPerImage` on line 78 with lookup: `FAL_COST_MAP[request.model] ?? 5`
3. For video: calculate from `request.duration` instead of hardcoded 25c

**Verification:**
- `grep "FAL_COST_MAP\|costPerImage" src/clients/fal.ts` — uses lookup table
- No hardcoded cents values outside the map

### Task 3.2: OpenClaw cost tracking

**What:** Real agents (Floor Manager, Web Agent, Launch Agent, CEO Mode) dispatch via OpenClaw CLI but no cost is recorded. The Anthropic API is called under the hood by OpenClaw but tokens aren't surfaced.

**File to modify:**
- `src/clients/openclaw.ts` — Parse cost data from OpenClaw output if available
- `src/orchestrator/index.ts` — In `dispatchReal()`, estimate and record costs

**Implementation:**
1. After OpenClaw returns, check if JSON response includes `usage` or `tokens` fields
2. If available, calculate cost from token counts
3. If not available, estimate based on model tier and output length (~4 chars/token, Opus=$15/MTok, Sonnet=$3/MTok)
4. Emit `cost:recorded` event after real agent dispatch (same as virtual)

**Anti-patterns:** Do NOT skip cost tracking because "it's only real agents." Real agents using Opus are the most expensive.

**Verification:**
- `grep "cost:recorded\|costCents" src/orchestrator/index.ts` — dispatchReal emits cost event

### Task 3.3: Supabase realtime subscriptions (server-side)

**What:** `broadcastFloorEvent()` sends data TO clients via Supabase Realtime. But the Orchestrator never SUBSCRIBES to receive events back (e.g., owner actions from Dashboard).

**Current state:** `src/integrations/supabase.ts` has `broadcastFloorEvent()` for publishing. No `subscribeToChannel()`.

**File to modify:** `src/integrations/supabase.ts`

**Implementation:**
1. Add `subscribeToFloor(floorId, callback)` function using Supabase Realtime client
2. Subscribe to `owner-actions:{floorId}` channel for receiving approval decisions, chat messages, and manual commands from Dashboard
3. Call from Orchestrator when a floor is created/loaded
4. Route incoming messages to appropriate handlers (approval handler, chat handler)

**Verification:**
- `grep "subscribeToFloor\|subscribe" src/integrations/supabase.ts` — subscription exists
- `grep "subscribeToFloor" src/orchestrator/index.ts` — called on floor init

### Task 3.4: Web Push notifications

**What:** Notifications are console-only (notifications.ts). Add Web Push API so owner gets device alerts.

**File to modify:** `src/integrations/notifications.ts`

**Implementation:**
1. Add `web-push` npm package
2. Store VAPID keys in config
3. Add `registerSubscription(endpoint, keys)` function — called when owner enables push in Dashboard
4. Modify `send()` to also call `webpush.sendNotification()` if subscription exists
5. Add `/api/notifications/subscribe` endpoint in a new route file
6. Add `/api/notifications` GET endpoint to fetch notification history

**Verification:**
- `grep "webpush\|sendNotification" src/integrations/notifications.ts` — Web Push calls
- `grep "subscribe" src/server/routes/` — subscription endpoint exists

### Task 3.5: Cost breakdown API endpoints

**What:** Only `GET /api/costs/summary` exists (costs.ts — 13 lines total). Need per-floor, per-agent, per-model breakdowns.

**File to modify:** `src/server/routes/costs.ts`

**Implementation:**
1. `GET /api/costs/:floorId` — Detailed cost breakdown for a floor
2. `GET /api/costs/:floorId/by-agent` — Costs grouped by agent
3. `GET /api/costs/:floorId/by-model` — Costs grouped by model tier
4. `GET /api/costs/:floorId/daily` — Daily cost trend (last 30 days)
5. `GET /api/costs/:floorId/projection` — "At current rate, budget lasts X more days"
6. Query from `cost_events` table in Supabase (already being persisted via `saveCostEvent`)

**Verification:**
- `grep "GET.*costs" src/server/routes/costs.ts` — shows all 5+ endpoints
- Each endpoint returns typed JSON responses

### Task 3.6: Missing webhook receivers

**What:** Only Stripe webhooks exist. Need Meta, TikTok, and Printful.

**File to modify:** `src/server/routes/webhooks.ts`

**Implementation:**
1. `POST /api/webhooks/meta` — Receive Meta webhook events (ad performance updates, page events). Verify with app secret.
2. `POST /api/webhooks/tiktok` — Receive TikTok webhook events (video publish status). Verify with signature.
3. `POST /api/webhooks/printful` — Receive Printful webhook events (order shipped, order returned, product synced). Verify with webhook secret.
4. Each webhook handler: verify signature → parse event → route to appropriate handler (fulfillmentPipeline, adsPipeline, etc.) → return 200

**Anti-patterns:** Do NOT process webhooks synchronously — acknowledge immediately, process async.

**Verification:**
- `grep "POST.*webhooks" src/server/routes/webhooks.ts` — shows 4 webhook endpoints

### Phase 3 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] fal.ai uses cost lookup table
- [ ] dispatchReal emits cost:recorded
- [ ] Supabase subscribe function exists
- [ ] Web Push integration in notifications
- [ ] 5+ cost API endpoints
- [ ] 4 webhook receivers

---

## Phase 4: Printful, Pipeline Wiring & Boot Cleanup (P2)

**Why fourth:** These are operational improvements. System works without them but underperforms.

### Task 4.1: Complete Printful integration

**What:** Current Printful integration (printful.ts — 75 lines) only has `listProducts`, `createMockup`, `getMockupResult`, and `checkConnection`. Missing: order creation, product sync, shipping rates, variant management.

**File to modify:** `src/integrations/printful.ts`

**Implementation:** Add missing functions:
1. `createSyncProduct(name, variants, files)` — Create a product in the Printful store
2. `createOrder(recipient, items)` — Create a fulfillment order
3. `getShippingRates(recipient, items)` — Get shipping cost estimates
4. `getOrderStatus(orderId)` — Check order fulfillment status
5. `listVariants(productId)` — Get all variants for a product template
6. All use the existing `printfulFetch()` helper (line 22-32)

**Verification:**
- `grep "export async function" src/integrations/printful.ts` — shows 8+ functions

### Task 4.2: Agent output → pipeline data bridge

**What:** Phase 2-3 components (WebsiteDeployer, AdsPipeline, etc.) exist but the bridge from agent output to pipeline input objects is thin. When ads-agent produces a campaign plan, it needs to be parsed into `AdsPipeline.executeCampaignPlan()` format.

**File to create:** `src/orchestrator/output-parser.ts` (NEW)

**Implementation:**
1. `parseAgentOutput(agentId, taskType, rawOutput)` — Route to type-specific parser
2. `parseCampaignPlan(raw)` → `CampaignPlan` object for AdsPipeline
3. `parseWebsiteSpec(raw)` → input for WebsiteDeployer
4. `parseProductCatalog(raw)` → product objects for FulfillmentPipeline
5. `parseEmailSequence(raw)` → sequence config for EmailAutomation
6. Call from `dispatchVirtual()` after successful task completion, before phase check

**Anti-patterns:** Do NOT require perfect structured output. Parse generously, validate strictly, request revision on parse failure.

**Verification:**
- `grep "parseAgentOutput\|output-parser" src/orchestrator/` — imported and called

### Task 4.3: Boot sequence refactor

**What:** `loadPersistedState()` contains hardcoded floor-specific fixes (SideQuest budget correction, Quest Kids budget correction). These should be in config, not code.

**Files to modify:**
- `src/orchestrator/index.ts` — Extract floor-specific boot fixes
- `src/config/boot-patches.ts` (NEW) — JSON-configurable boot patches

**Implementation:**
1. Create `boot-patches.ts` with a `BootPatch` interface: `{ floorId, type: 'budget-correction' | 'phase-reset' | 'task-cleanup', params }`
2. Load patches from `data/boot-patches.json` (or Supabase config table)
3. In `loadPersistedState()`, replace hardcoded blocks with a loop over patches
4. Log each patch application to the system review log

**Verification:**
- `grep "SideQuest\|Quest Kids" src/orchestrator/index.ts` — zero results (moved to config)
- `loadPersistedState()` is <200 lines

### Task 4.4: processQueue pagination

**What:** `processQueue()` iterates all queued tasks every 2 seconds. Add pagination to process a batch at a time.

**File to modify:** `src/orchestrator/index.ts` — processQueue method

**Implementation:**
1. Add `QUEUE_BATCH_SIZE = 20` constant
2. `getQueuedTasks()` already returns tasks — just slice to batch size
3. Sort by priority before slicing: critical → high → normal → low
4. Track a cursor for round-robin fairness across floors

**Verification:**
- `grep "QUEUE_BATCH_SIZE\|slice" src/orchestrator/index.ts` (in processQueue context)

### Task 4.5: Wire sub-agent prompt building

**What:** `buildSubAgentPrompt()` in PromptBuilder exists but is never called. Wire it to `SubAgentManager`.

**Files to modify:**
- `src/orchestrator/sub-agent-manager.ts` — Import and call `buildSubAgentPrompt()` when creating sub-agent tasks
- `src/prompt-builder/index.ts` — Ensure `buildSubAgentPrompt()` returns properly formatted compressed prompt

**Verification:**
- `grep "buildSubAgentPrompt" src/orchestrator/sub-agent-manager.ts` — called

### Phase 4 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] Printful has 8+ exported functions
- [ ] Output parser bridges agent results to pipeline objects
- [ ] No hardcoded floor names in loadPersistedState
- [ ] processQueue has batch limit
- [ ] Sub-agent prompts are built via PromptBuilder

---

## Phase 5: Polish, Remaining Templates & Final Audit (P2b)

**Why last:** Finishing touches. Everything functional should be done by now.

### Task 5.1: Enrich remaining thin agent templates

**Current state assessment:**
- brand-agent.json — **EXCELLENT** (deeply enriched, Aaker framework, color psychology, naming, logo)
- strategy-agent.json — **EXCELLENT** (Porter's, PESTLE, Ansoff, BCG, GTM frameworks)
- finance-agent.json — **EXCELLENT** (unit economics, pricing models, budget allocation, scenario planning)
- design-agent.json — **EXCELLENT** (3-layer design system, grid systems, platform specs, accessibility)
- video-agent.json — **EXCELLENT** (dual-path production, API routing, 3-second rule, prompt engineering)
- copy-agent.json — **GOOD** (enriched this session)
- commerce-agent.json — **GOOD** (enriched this session)
- social-media-agent.json — **GOOD** (enriched this session)
- ads-agent.json — **GOOD** (campaign architecture, testing matrix, winners hub)
- analytics-agent.json — **GOOD** (anomaly thresholds, correlation, attribution)
- backend-agent.json — **NEEDS REVIEW** (may be thin)
- dashboard-agent.json — **NEEDS REVIEW** (may be thin)

**Files to review and potentially enrich:**
- `prompt-templates/backend-agent.json`
- `prompt-templates/dashboard-agent.json`
- `prompt-templates/ads-agent.json` — Could add platform-specific ad specs (Meta campaign structure, TikTok Spark Ads, creative fatigue detection thresholds)
- `prompt-templates/analytics-agent.json` — Could add specific dashboard metrics formulas, SQL query patterns

### Task 5.2: Document all 4 undocumented agents

**What:** CEO Mode, Dashboard Agent, Backend Agent, and Owner are in code but not spec.

**File to create:** `specs/25-supplementary-agents.md` (NEW)

**Implementation:** Document each agent's role, model tier, boundaries, and integration points based on actual code behavior.

### Task 5.3: Auth improvements

**What:** Dashboard auth is simple bearer token. Spec mentions Supabase magic links.

**File to modify:** `src/server/middleware/auth.ts`

**Implementation:**
1. Add Supabase Auth integration for magic link login
2. Verify JWT from Supabase Auth instead of/in addition to bearer token
3. Add session expiry (24 hours)
4. Keep bearer token as fallback for API access

### Task 5.4: API key health check endpoint

**What:** Spec requires a health endpoint showing which API keys are valid/expiring.

**File to modify:** `src/server/routes/health.ts`

**Implementation:** Add `GET /api/health/integrations` that checks:
1. Anthropic API key validity (test call)
2. fal.ai key validity
3. OpenAI key validity
4. Stripe key validity
5. Meta token status + expiry
6. TikTok token status + expiry
7. Printful key validity
8. ElevenLabs key validity
Returns `{ provider, status: 'ok' | 'expiring' | 'invalid', expiresAt? }` for each.

### Task 5.5: Final comprehensive audit

**What:** Run the full audit again to verify zero open findings.

**Steps:**
1. `npx tsc --noEmit` — TypeScript clean
2. Grep for all P0/P1/P2 markers from the audit report
3. Verify each fix with its specific verification checklist
4. Count PromptBuilder validation checks (should be 13)
5. Count agent templates (should be 13, including launch-agent)
6. Count webhook receivers (should be 4: Stripe, Meta, TikTok, Printful)
7. Count cost API endpoints (should be 5+)
8. Verify no hardcoded floor names in orchestrator
9. Test a mock floor creation → task dispatch → completion flow mentally

### Phase 5 Verification Checklist
- [ ] `npx tsc --noEmit` — zero errors
- [ ] All 13 agent templates present and enriched
- [ ] Supplementary agents documented
- [ ] Auth supports Supabase magic links
- [ ] Health endpoint checks all integrations
- [ ] Final audit: zero open findings

---

## Summary Table

| Phase | Tasks | Focus Area | Estimated Hours |
|-------|-------|------------|----------------|
| 1 | 5 tasks | Security, budget, tokens, launch-agent, history | 15-20 hrs |
| 2 | 4 tasks | PromptBuilder validation, PII, workspace | 10-12 hrs |
| 3 | 6 tasks | API clients, integrations, webhooks, endpoints | 20-25 hrs |
| 4 | 5 tasks | Printful, pipelines, boot refactor, pagination | 15-20 hrs |
| 5 | 5 tasks | Templates, docs, auth, health, final audit | 15-20 hrs |
| **Total** | **25 tasks** | | **~80-100 hrs** |

---

## Execution Instructions

Each phase can be executed with:
```
Read this plan at /sessions/cool-epic-noether/mnt/orion/EVE-100-PERCENT-PLAN.md.
Execute Phase N. Follow the implementation steps exactly.
Check each verification item before marking complete.
Run npx tsc --noEmit after every file change.
```

**Dependencies between phases:**
- Phase 2 depends on Phase 1 (budget validation must exist before PromptBuilder changes)
- Phase 3 depends on Phase 1 (token manager must exist before integration fixes)
- Phase 4 depends on Phase 3 (webhook receivers must exist before Printful pipeline wiring)
- Phase 5 depends on all prior phases
