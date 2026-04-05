# EVE Orchestrator — P0 Gap Analysis

**Date:** April 1, 2026
**Scope:** 5 highest-priority implementation gaps
**Status:** Ready for build

---

## GAP 1: Pre-Call Budget Validation

### What the Spec Says
- **Source:** `specs/eve-api-infrastructure.md`, lines 533–546 (BUDGET ENFORCEMENT section)
- **Requirement:** "Before every API call that costs money: (1) Orchestrator checks: floor budget remaining > estimated cost? (2) YES → proceed (3) NO → block the call, notify Floor Manager, push alert to you"
- **Scope:** All API calls — LLM (Anthropic), media (fal.ai, OpenAI), voice (ElevenLabs)

### What Currently Exists in Code

#### BudgetEnforcer ✓ (Complete)
- **File:** `/src/security/budget-enforcer.ts`, lines 37–49
- **Method:** `canAfford(floorId: string, estimatedCostCents: number): { allowed: boolean; reason?: string }`
- **Status:** Fully implemented. Returns `{ allowed: true/false, reason }` based on spend vs. ceiling.
- **Cost tracking:** `recordCost()` at line 52 updates `budget.spentCents` and fires `budget:alert` events at thresholds.

#### Guardian.verify() ✓ (Complete)
- **File:** `/src/security/guardian.ts`, lines 54–58
- **Status:** Calls `budget.canAfford()` as part of pre-execution checks. Blocks dispatch if budget exceeded.
- **Called from:** `/src/orchestrator/index.ts` (Floor Manager instantiation) and action-executor.ts

#### Cost Estimation ✓ (Complete)
- **File:** `/src/clients/anthropic.ts`, lines 92–102
- **Function:** `estimateCost(inputTokens, estimatedOutputTokens, modelTier): number`
- **Pricing:** Lines 27–30 define per-model pricing (Opus/Sonnet/Haiku in cents per million tokens)
- **Usage:** Called before `callAnthropic()` to calculate estimated cost

#### FAL.ai Estimation ⚠️ (Rough estimates only)
- **File:** `/src/clients/fal.ts`, lines 78–79
- **Status:** Uses hardcoded estimates: `costPerImage = request.model.includes('flux') ? 5 : 3 cents`
- **Problem:** Not based on actual model pricing; assumes all Flux models cost same, all others cost same.
- **Video:** Line 110 hardcodes 25 cents per video regardless of model.
- **Gap:** Should reference actual fal.ai pricing table from api-infrastructure.md lines 120–140.

#### Missing: Pre-fal.ai Cost Checks
- **Location needed:** `src/clients/fal.ts` `generateImage()` and `generateVideo()` functions
- **Issue:** These functions call `withRetry()` directly without pre-call budget validation
- **Spec requirement:** Every media generation API call should validate `canAfford()` before dispatch
- **Current state:** Only post-call cost recording exists (lines 82–84, 221–227)

#### Missing: Pre-OpenAI Cost Checks
- **Location needed:** `src/clients/openai.ts` (file not found in codebase)
- **Issue:** GPT Image calls (text-in-image generation) have no budget pre-check
- **Spec:** Lines 314 (api-infrastructure.md) shows cost ~$0.04–0.08 per image
- **Current state:** No OpenAI client implementation found

#### Missing: Pre-ElevenLabs Cost Checks
- **Location needed:** `src/clients/elevenlabs.ts` (file not found in codebase)
- **Issue:** Voice generation has no pre-call budget validation
- **Spec:** Lines 374–375 (api-infrastructure.md) shows cost ~$0.15–0.30 per 1,000 characters

### Concrete Findings

**What exists (ready to use):**
- `BudgetEnforcer.canAfford(floorId, estimatedCostCents)` — line 37–49 in budget-enforcer.ts
- `Guardian.verify(check)` — line 39–73 in guardian.ts, calls budget checks
- `estimateCost()` for Anthropic — line 92–102 in anthropic.ts

**What's missing:**
1. **Pre-call budget checks in fal.ts**: `generateImage()` (line 60) and `generateVideo()` (line 91) don't validate before calling API
2. **Accurate fal.ai pricing**: Hardcoded estimates don't match spec (lines 78–79, 110)
3. **OpenAI integration**: No client file; GPT Image generation completely missing
4. **ElevenLabs integration**: No client file; voice generation completely missing
5. **Pre-call checks in Anthropic dispatcher**: VirtualDispatcher doesn't validate budget before building prompt or calling API

**Pattern to copy:**
```typescript
// From guardian.ts line 55–57
const canAfford = this.budget.canAfford(check.floorId, check.estimatedCostCents);
if (!canAfford.allowed) {
  violations.push(`Budget: ${canAfford.reason}`);
}
```

**Confidence:** HIGH (structure exists, needs integration into media clients)

---

## GAP 2: Meta/TikTok Token Auto-Refresh

### What the Spec Says
- **Source:** `specs/eve-api-infrastructure.md`, lines 495–505 (API KEY MANAGEMENT section)
- **Meta requirement:** "Meta long-lived token: refresh 7 days before expiry"
- **TikTok requirement:** "TikTok OAuth: refresh when token nears expiry"
- **General:** "If refresh fails → push notification to you with manual steps"

### What Currently Exists in Code

#### Meta Integration (Partial)
- **File:** `/src/integrations/meta.ts`, lines 1–111
- **Status:** Has publish, campaign, and insights functions but NO token refresh logic
- **Access token handling:** Line 35–54 (`publishPost`) and line 56–81 (`createCampaign`) accept `accessToken` as parameter
- **Storage:** Function `getMetaConfig()` (lines 16–19) returns `null` with comment "Configured per-floor at runtime"
- **No refresh:** No method to refresh or validate token expiry

#### TikTok Integration (Partial)
- **File:** `/src/integrations/tiktok.ts`, lines 1–71
- **Status:** Has upload and publish status functions, NO refresh logic
- **Access token handling:** Lines 13–14 and 39 use `accessToken` parameter directly
- **No refresh:** No token refresh or expiry tracking

#### Missing: Token Refresh Implementation
- **Location needed:** New methods in both `meta.ts` and `tiktok.ts`, OR new file `/src/integrations/oauth-manager.ts`
- **What's missing:**
  1. Token expiry tracking (store expiry timestamp)
  2. Refresh logic (call token endpoint before expiry)
  3. Notification system (push alert if refresh fails)
  4. Storage mechanism (persist new tokens to Supabase or .env)

#### Missing: Scheduled Refresh Job
- **Location needed:** `/src/orchestrator/index.ts` or new file for token refresh scheduler
- **What's missing:**
  1. Daily job that checks token expiry times
  2. Triggers refresh 7 days before Meta token expires
  3. Triggers refresh when TikTok token nears expiry
  4. Logs refresh attempts and failures

### Concrete Findings

**What exists (ready to use):**
- Meta Graph API endpoint structure: line 8 (GRAPH_API constant)
- TikTok API endpoint structure: line 5 (TIKTOK_API constant)
- `checkConnection()` functions (lines 104–110 in meta.ts, 62–70 in tiktok.ts) that validate token validity

**What's missing:**
1. **Meta refresh endpoint**: Line 15–19 (meta.ts) shows `getMetaConfig()` returns null; no persistent config storage for tokens
2. **TikTok refresh endpoint**: No equivalent of Meta's long-lived token concept; OAuth flow not implemented
3. **Expiry tracking**: Neither integration stores or tracks token expiry times
4. **Refresh scheduler**: No scheduled task that proactively refreshes tokens
5. **Failure notifications**: No event emission when refresh fails

**Spec references:**
- Meta API token refresh: `POST https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token={access_token}`
- TikTok OAuth: `POST https://open.tiktokapis.com/v1/oauth/token/` with `grant_type=refresh_token`

**Pattern to copy (from budget-enforcer.ts):**
```typescript
// Modeled on BudgetEnforcer's threshold tracking
interface TokenState {
  service: 'meta' | 'tiktok';
  token: string;
  expiresAt: Date;
  refreshedAt: Date;
}

private tokens = new Map<string, TokenState>(); // key: "{floorId}:{service}"

async checkAndRefresh(floorId: string, service: 'meta' | 'tiktok'): Promise<boolean> {
  const state = this.tokens.get(`${floorId}:${service}`);
  const daysUntilExpiry = (state.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

  if (daysUntilExpiry < 7) {
    const refreshed = await this.refresh(service, state.token);
    if (!refreshed) {
      this.eventBus.emit('token:refresh-failed', { floorId, service });
    }
    return refreshed;
  }
  return true;
}
```

**Confidence:** MEDIUM (spec clear, but implementation pattern needs design — this is OAuth-level work)

---

## GAP 3: Launch Agent Template Missing

### What the Spec Says
- **Source:** `specs/eve-revised-agent-roster.md`, lines 209–223 (LAUNCH AGENT section)
- **Role:** "QA Inspector + Go-Live Manager"
- **Responsibilities:**
  - Independent verification of everything other agents built
  - Full launch checklist: SSL, privacy policy, cookie consent, unsubscribe flow, Stripe webhooks, analytics, links, mobile responsive, load time
  - Go-live sequence: deploy → domain connect → Stripe activate → analytics verify → ad campaigns create
  - Post-launch verification

### What Currently Exists

#### Agent Registration ✓
- **File:** `/src/config/types.ts` likely defines agent IDs
- **Assumption:** `VIRTUAL_AGENTS` or `REAL_AGENTS` list includes launch-agent (need to verify)

#### Template Files ✗ (Missing)
- **Location:** `/prompt-templates/launch-agent.json` — **DOES NOT EXIST**
- **Bash output:** Directory listing shows 12 templates:
  - ads-agent.json ✓
  - analytics-agent.json ✓
  - backend-agent.json ✓
  - brand-agent.json ✓
  - commerce-agent.json ✓
  - copy-agent.json ✓
  - dashboard-agent.json ✓
  - design-agent.json ✓
  - finance-agent.json ✓
  - social-media-agent.json ✓
  - strategy-agent.json ✓
  - video-agent.json ✓
  - **launch-agent.json** ✗ MISSING

#### Pattern to Copy
- **Best example:** `/prompt-templates/copy-agent.json` (6,249 bytes) — shows complete structure
- **Structure observed in brand-agent.json (lines 1–12):**
  ```json
  {
    "agentId": "brand-agent",
    "role": "...",
    "expertise": "...",
    "rules": "...",
    "boundaries": "...",
    "outputFormat": "...",
    "brandContextFields": [...],
    "usesVoiceSample": false,
    "usesGeneratedKnowledge": true,
    "antiSlopEnabled": true
  }
  ```

### Concrete Findings

**What needs to be created:**
- **File path:** `/sessions/cool-epic-noether/mnt/orion/prompt-templates/launch-agent.json`
- **Required fields** (from brand-agent.json pattern):
  1. `agentId`: "launch-agent"
  2. `role`: Full role definition (see spec section below)
  3. `expertise`: QA/deployment/launch expertise
  4. `rules`: Terminal access, collaboration rules
  5. `boundaries`: What Launch Agent does NOT do
  6. `outputFormat`: Structured launch checklist and status reporting
  7. `brandContextFields`: Which brand fields are needed (if any)
  8. `usesVoiceSample`: false (technical agent, not content)
  9. `usesGeneratedKnowledge`: false (not an analysis agent)
  10. `antiSlopEnabled`: false (not a copy agent)

**From spec (eve-revised-agent-roster.md lines 209–223):**
```
MODEL TIER: Sonnet
RESPONSIBILITIES:
- Independent verification of everything other agents built
- Runs the full launch checklist (security, privacy, functionality, performance)
- Verifies: SSL active, privacy policy live, cookie consent working, unsubscribe flow working, Stripe webhooks verified, no PII in logs, analytics firing, all links working, mobile responsive, load time acceptable
- Manages the go-live sequence: deploy → domain connect → Stripe activate → analytics verify → ad campaigns create (paused)
- Post-launch verification: confirms everything is working on the live URL
- Produces launch summary with all live links and status

WORKS WITH: Web Agent (deployment), Floor Manager (launch coordination), every agent (verification)
SKILLS: mkt-launch

BOUNDARIES:
- Does NOT write code (Web Agent's job)
- Does NOT create campaigns (Ads Agent's job)
- Does NOT set up analytics (Analytics Agent's job)
- Does NOT approve designs or copy (Brand Agent's job)
- Does NOT make financial decisions (Finance Agent's job)
```

**Pattern from analytics-agent.json (similar Sonnet agent):**
- Use analytics-agent.json as template (3,129 bytes)
- Copy structure, adapt expertise and rules

**Confidence:** VERY HIGH (spec is explicit, pattern exists, straightforward file creation)

---

## GAP 4: Conversation History Management

### What the Spec Says
- **Source:** `specs/eve-promptbuilder-spec.md`, lines 644–666 (CONVERSATION HISTORY MANAGEMENT section)
- **Rules:**
  1. "Each agent has its own conversation history, stored in the database"
  2. "History persists across work cycles (agent remembers what it did)"
  3. "History is scoped per floor per agent"
  4. "When history exceeds token limits, prune: keep first msg + last 5 + summarize middle"
  5. "Context window targets: Opus 30K, Sonnet 20K, Haiku 8K"
  6. "Pinned messages are never pruned"

### What Currently Exists

#### ConversationStore ✓ (Complete and Well-Implemented)
- **File:** `/src/orchestrator/conversation-store.ts`, lines 1–135
- **Status:** FULLY IMPLEMENTED per spec
- **Key methods:**
  - `addMessage(floorId, agentId, message, pinned?)` — line 42–57
  - `getMessages(floorId, agentId, modelTier, systemPromptTokens)` — line 60–114 (async, handles pruning)
  - `pinMessage()` — line 117–123
  - `getLength()` — line 126–128
  - `clear()` — line 131–133

**Implementation details matching spec:**
- Line 21–31: Context window targets defined per model (`CONTEXT_TARGETS`, `CONTEXT_MAX`)
- Line 75–83: Token counting for each entry
- Line 86–94: Pruning logic — keeps first + pinned + last 5 + summarizes middle
- Line 93–95: Generates summary message for pruned section
- Key assertion (line 71): "If within budget, return all" — prioritizes recent memory

#### VirtualDispatcher Integration ✓ (Complete)
- **File:** `/src/orchestrator/virtual-dispatcher.ts`, lines 81–85
- **Status:** Receives `conversationHistory` from dispatch input and passes to `callAnthropic()`
- **Used:** Line 82–85 in dispatch function spreads history into messages array

#### BuildPromptInput ✓ (Supports conversation history)
- **File:** `/src/prompt-builder/index.ts`, lines 35–56
- **Status:** Interface includes `conversationHistory?: ConversationMessage[]` (line 30 in virtual-dispatcher.ts)
- **Pattern:** Not found in BuildPromptInput itself (needs verification in config/types.ts)

#### Call to Anthropic with History ✓
- **File:** `/src/clients/anthropic.ts`, lines 45–87
- **Status:** `callAnthropic()` accepts `messages` parameter (line 47) and sends to API (line 59)
- **Token tracking:** Lines 72–77 count tokens from response but don't account for conversation history tokens

#### **Issue Found: Missing History Token Accounting**
- **Location:** `/src/clients/anthropic.ts` lines 75–77
- **Current code:**
  ```typescript
  const costCents =
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  ```
- **Problem:** `inputTokens` from the API response includes conversation history, so this IS accounting for it correctly
- **Status:** Actually ✓ WORKING (API response includes total input tokens including history)

#### **Issue Found: System Prompt Tokens Not Subtracted from Context**
- **Location:** `/src/orchestrator/conversation-store.ts` line 71
- **Current code:**
  ```typescript
  const target = CONTEXT_TARGETS[modelTier];
  const availableTokens = target - systemPromptTokens;
  ```
- **Status:** ✓ CORRECT (properly subtracts system prompt from budget)

### Concrete Findings

**What exists (ready to use):**
- ConversationStore class — fully functional per spec
- Storage: in-memory Map (line 35: `private histories = new Map<string, ConversationEntry[]>()`)
- Pruning: implemented lines 86–114
- Token budgets: defined lines 21–31

**What's missing:**
1. **Persistence to database:** ConversationStore is in-memory only. Spec says "stored in the database" but implementation stores in-memory.
   - **Missing:** Supabase integration to save/load conversation history
   - **Impact:** History is lost when Orchestrator restarts
   - **Location needed:** Extend ConversationStore with `.persist()` and `.load()` methods that call Supabase

2. **History loading at startup:** No code found that loads agent conversation history from database when floor boots
   - **Location needed:** `/src/orchestrator/index.ts` during floor initialization

3. **Persistence strategy:** Unclear when/how history is saved to DB
   - **Option A:** Save after every message (expensive, but safe)
   - **Option B:** Save at end of task completion (cheaper, risks loss of in-progress work)
   - **Recommendation:** Option B with periodic backups

**Pattern to copy (from budget-enforcer.ts):**
```typescript
// From BudgetEnforcer.persistCostEvent() line 107–122
async persistConversationHistory(floorId: string, agentId: string, messages: ConversationEntry[]): Promise<void> {
  try {
    const { getSupabase } = await import('../integrations/supabase.js');
    const sb = getSupabase();
    if (!sb) return;
    await sb.from('conversation_history').insert({
      floor_id: floorId,
      agent_id: agentId,
      messages: JSON.stringify(messages),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Non-critical — history is tracked in-memory regardless
  }
}
```

**Confidence:** HIGH (core logic complete, database integration is straightforward)

---

## GAP 5: Workspace Section Always Included

### What the Spec Says
- **Source:** `specs/eve-promptbuilder-spec.md`, lines 340–363 (WORKSPACE SECTION)
- **Purpose:** "A snapshot of what exists in the shared workspace that's relevant to this agent's current task"
- **Content:**
  - AVAILABLE FILES (with paths)
  - RECENTLY UPDATED (files changed in last N minutes)
  - PENDING FROM YOU (what this agent still needs to deliver)
- **Token budget:** 500–1,000 tokens. List only files relevant to the current task. Don't dump the entire workspace.

### What Currently Exists

#### Conditional Workspace Section ⚠️
- **File:** `/src/prompt-builder/index.ts`, lines 122–126
- **Status:** Workspace section is CONDITIONAL, not always included
- **Code:**
  ```typescript
  // 6. Workspace (priority 6)
  if (input.workspaceFiles && input.workspaceFiles.length > 0) {
    const workspaceSection = await this.buildWorkspaceSection(input.workspaceFiles);
    sections.push(workspaceSection);
  }
  ```
- **Issue:** Only included if `input.workspaceFiles` is provided and non-empty

#### buildWorkspaceSection() ✓
- **File:** `/src/prompt-builder/index.ts`, lines 366–379
- **Status:** Implemented correctly
- **Content:** Simple file list format
- **Code:**
  ```typescript
  private async buildWorkspaceSection(files: string[]): Promise<PromptSection> {
    const fileList = files.map(f => `- ${f}`).join('\n');
    const content = `<workspace>
  AVAILABLE FILES:
  ${fileList}
  </workspace>`;
  ```

#### **Gap Found: Workspace Not Populated from Floor State**
- **Location:** Where tasks are dispatched (likely in floor-manager or action-executor)
- **Problem:** `input.workspaceFiles` is passed but never populated from actual floor workspace
- **Impact:** Agents don't know what files exist in the floor workspace
- **Missing:** Code that:
  1. Scans the floor workspace directory
  2. Filters files relevant to the task
  3. Passes them to PromptBuilder as `workspaceFiles`

#### BuildPromptInput Workspace Field ✓
- **File:** `/src/prompt-builder/index.ts`, lines 35–56
- **Status:** Field exists: `workspaceFiles?: string[]` (line 50)
- **Issue:** Optional field, often empty

### Concrete Findings

**What exists (ready to use):**
- `buildWorkspaceSection()` — fully functional, lines 366–379 in prompt-builder/index.ts
- Structure: simple XML with file list
- Integration point: conditional check at lines 123–126

**What's missing:**
1. **Workspace population:** No code that reads floor workspace and populates `workspaceFiles` for dispatch
   - **Location needed:** Task dispatcher (likely in `action-executor.ts` or `virtual-dispatcher.ts`)
   - **What needs to happen:**
     ```typescript
     // Before dispatch, scan workspace and filter relevant files
     const workspaceFiles = await scanFloorWorkspace(floorId, floorSlug, taskType);
     // then pass to PromptBuilder
     ```

2. **Relevance filtering:** Spec says "List only files relevant to the current task" but no logic filters by task type
   - **Location needed:** New function in a workspace utilities file
   - **Logic needed:**
     - Copy agents → list /copy, /product files
     - Design agents → list /design files
     - Commerce agents → list /product, /pricing files
     - etc.

3. **RECENTLY UPDATED section:** Spec mentions it (line 354 in promptbuilder-spec) but not implemented
   - **Missing:** Timestamp tracking for files
   - **Impact:** Agents can't see what's fresh vs. stale

4. **PENDING FROM YOU section:** Spec mentions (line 358) but not implemented
   - **Missing:** Task tracking within workspace
   - **Impact:** Agents don't know what other agents still owe

### Concrete Findings Summary

**What exists (ready to use):**
- `buildWorkspaceSection()` function in prompt-builder/index.ts line 366–379
- Conditional inclusion at lines 123–126
- BuildPromptInput has workspaceFiles field at line 50

**What's missing:**
1. **Workspace scanning:** No code that reads floor filesystem and returns file list
2. **Task-relevance filtering:** No logic that filters files by agent type/task type
3. **File timestamps:** No tracking of which files changed recently
4. **Pending tasks tracking:** No system for listing what's awaited from other agents

**Pattern to copy (from virtual-dispatcher.ts):**
```typescript
// Similar pattern for loading other context
async function scanFloorWorkspace(floorId: string, floorSlug: string, agentId: string): Promise<string[]> {
  const workspacePath = `/floors/${floorSlug}/workspace`;
  const files: string[] = [];

  // Agent-specific directory mappings
  const relevantDirs = {
    'copy-agent': ['/copy', '/product'],
    'design-agent': ['/design', '/product'],
    'commerce-agent': ['/product', '/pricing'],
    // ...
  };

  for (const dir of relevantDirs[agentId] ?? []) {
    const dirPath = `${workspacePath}${dir}`;
    const dirFiles = await fs.readdir(dirPath).catch(() => []);
    files.push(...dirFiles.map(f => `${dir}/${f}`));
  }

  return files;
}
```

**Confidence:** MEDIUM-HIGH (pattern clear, needs filesystem integration)

---

## Summary Table

| Gap | Spec Source | Current Status | Build Complexity | Priority |
|---|---|---|---|---|
| **1. Pre-call budget validation** | api-infrastructure.md:533–546 | 70% (Anthropic done, media clients missing) | Medium | HIGH |
| **2. Meta/TikTok token refresh** | api-infrastructure.md:495–505 | 0% (detection only, no refresh) | High (OAuth) | HIGH |
| **3. Launch Agent template** | revised-agent-roster.md:209–223 | 0% (missing .json file) | Low (file creation) | CRITICAL |
| **4. Conversation history** | promptbuilder-spec.md:644–666 | 90% (in-memory store complete, DB persistence missing) | Low (Supabase integration) | MEDIUM |
| **5. Workspace section** | promptbuilder-spec.md:340–363 | 40% (builder exists, not populated) | Medium (filesystem scan + filtering) | MEDIUM |

---

## Recommended Build Order

1. **Gap 3 (Launch Agent)** — 30 min, unblocks testing
2. **Gap 1.2 (Media client cost checks)** — 1–2 hours, high-value security
3. **Gap 1.3 (OpenAI + ElevenLabs clients)** — 2–3 hours, completes feature
4. **Gap 5 (Workspace population)** — 2–3 hours, improves agent effectiveness
5. **Gap 4 (History persistence)** — 1–2 hours, improves reliability
6. **Gap 2 (Token refresh)** — 3–5 hours, complex OAuth work

