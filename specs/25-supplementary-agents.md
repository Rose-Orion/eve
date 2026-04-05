# Spec 25 — Supplementary Agents

These agents exist in the codebase but are not covered by the core Agent Roster (Spec 04). They serve operational, debugging, and administrative roles.

---

## 1. CEO Mode (Real Agent — OpenClaw)

**Model Tier:** Opus
**Terminal Access:** Tier 3 (full shell access)
**Type:** Real agent (dispatched via OpenClaw CLI)

**Role:** The owner's direct interface for strategic decisions and system management. CEO Mode is a conversational agent that the owner interacts with directly — it's the "executive assistant" layer.

**Responsibilities:**
- Answer owner questions about business performance, floor status, and agent activity
- Execute owner commands (create floor, approve task, adjust budget, kill switch)
- Synthesize cross-floor intelligence into executive summaries
- Provide strategic recommendations based on performance data
- Manage system-level operations (restart agents, clear queues, run audits)

**Boundaries:**
- Does not replace the Strategy Agent for business planning
- Does not directly dispatch tasks — routes requests through the Orchestrator
- Financial transactions still require explicit approval flow

---

## 2. Backend Agent (Virtual Agent)

**Model Tier:** Sonnet
**Terminal Access:** None (generates patches, does not execute)
**Type:** Virtual agent (dispatched via Anthropic API)

**Role:** The system's self-repair agent. Diagnoses and generates fixes for orchestrator bugs, data sync issues, and API errors.

**Responsibilities:**
- Read orchestrator source code to diagnose issues
- Generate targeted FIND/REPLACE patches with rollback instructions
- Fix routing, persistence, event broadcasting, and task lifecycle bugs
- Ensure data flows correctly between Supabase, API layer, and frontend

**Boundaries:**
- NEVER auto-applies changes — all patches require owner approval
- Cannot modify security files (guardian.ts, immutable-rules.ts, budget-enforcer.ts)
- Cannot modify client SDK wrappers unless fixing a clear bug
- Does not make business decisions — technical fixes only

---

## 3. Dashboard Agent (Virtual Agent)

**Model Tier:** Sonnet
**Terminal Access:** None (generates patches, does not execute)
**Type:** Virtual agent (dispatched via Anthropic API)

**Role:** Maintains and improves the EVE owner dashboard — the PWA that visualizes floor status, task progress, costs, and approvals.

**Responsibilities:**
- Diagnose UI routing bugs, broken views, and display issues
- Generate targeted patches for public/app.js and public/styles.css
- Propose UX improvements based on interaction patterns
- Ensure data visualization supports business decision-making

**Boundaries:**
- Only modifies frontend files (public/app.js, public/styles.css)
- NEVER auto-applies changes — all patches require owner approval
- Does not modify backend code
- Does not redesign the entire dashboard — targeted improvements only

---

## 4. Owner (Pseudo-Agent)

**Model Tier:** N/A (human)
**Terminal Access:** N/A
**Type:** Pseudo-agent representing the human business owner

**Role:** The Owner is not an AI agent — it's the representation of the human owner within the system. The Owner "agent" exists so the Orchestrator can model approval flows, chat interactions, and feedback as part of the same agent-task graph.

**Responsibilities:**
- Approve high-risk actions (financial transactions, ad launches, content publishing)
- Provide feedback on agent outputs during review phase
- Set business direction and floor parameters
- Interact via Dashboard (approvals, chat, notifications) or CEO Mode (conversational)

**How it works:**
- When a task enters 'review' status, an approval:needed event fires
- The Dashboard shows the pending approval with task summary and agent output
- The Owner approves/rejects via Dashboard UI or CEO Mode conversation
- Approval triggers generateApprovalToken() → HMAC verification → task continues
- The Owner's trust level (TrustLadder) determines which actions auto-execute vs. require approval
