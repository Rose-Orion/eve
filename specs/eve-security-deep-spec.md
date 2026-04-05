# EVE — Security & Privacy

This is the complete security framework for EVE. It covers terminal access safety, customer data protection, business secrets, API key security, cross-floor isolation, privacy compliance, and AI safety. It replaces EVE-TERMINAL-SAFETY.md.

---

## Part 1: Terminal Access (3 Tiers)

### TIER 1: AUTO-ALLOWED (agents proceed freely)

Safe, routine operations needed for building:

**Package management:** `npm install`, `npm update`, `npx create-next-app`, `pip install`
**Dev servers:** `npm run dev`, `npm run build`, `npm start`
**Code quality:** `npm run lint`, `npm run test`, `npm run format`, `npx tsc`
**File ops within project:** Create, read, edit, delete files inside `__PATH_EVE_PROJ__{floor-name}/`
**Git:** `git init`, `git add`, `git commit`, `git branch`, `git checkout`, `git status`, `git log`, `git diff`
**iOS builds:** `xcodebuild build`, `xcrun simctl boot/install/launch`
**Read-only info:** `node --version`, `ls`, `cat`, `head`, `tail`, `curl` GET requests, `ping`

### TIER 2: FLOOR MANAGER APPROVAL

Useful but carries some risk:

**Global package installs:** `npm install -g` — FM verifies the package is legitimate
**Network requests that send data:** `curl POST/PUT/DELETE` — FM verifies destination is expected (Vercel, Stripe, Meta API)
**Environment variables:** Writing to `.env` / `.env.local` — FM verifies values are correct
**Docker:** `docker build/run/compose` — FM approves the use case
**Database operations:** Schema changes, migrations, seeding, direct SQL
**Cross-floor file access:** Reading another floor's files — FM verifies CEO Mode approved
**Non-standard ports:** Starting servers on ports other than the assigned preview port

### TIER 3: HUMAN OWNER APPROVAL

High-risk or irreversible:

**Deployment:** `vercel deploy`, Vercel API deployment calls, `xcrun altool --upload-app`
**Financial:** Stripe API calls with real charges, switching test to live mode, any spending
**Domain/DNS:** Any DNS record changes, domain purchases, SSL operations
**Credentials:** Creating API keys on external services, OAuth flows
**System-level:** Anything outside `__PATH_EVE_PROJ__`, system preferences, `brew install`, shell profile edits, cron jobs
**Destructive:** `rm -rf` on directories, `git push --force`, `DROP TABLE`
**External accounts:** Creating accounts, logging in, posting publicly, sending real emails

### PERMANENTLY FORBIDDEN (no one can approve)

```
rm -rf / or ~ or /*
sudo anything (unless specifically whitelisted)
chmod 777 on system files
Reading ~/.ssh/*, ~/.aws/credentials, or credentials outside project .env
Crypto mining or unauthorized background processes
Opening inbound ports to the internet
Reverse shells
Downloading and executing scripts from unknown URLs
eval() on untrusted input
Installing packages from unknown/unverified registries
```

### Command Logging

Every command every agent runs is logged:
```
CommandLog {
  timestamp, floorId, agentId, command, tier, approved, approvedBy, output, error, exitCode
}
```
Floor Manager and human owner can review the full audit trail anytime.

---

## Part 2: Customer Data Protection

### What Customer Data Exists

Each floor's ecommerce site collects:
- Email addresses (account creation, email capture, checkout)
- Names (checkout)
- Shipping addresses (checkout)
- Payment info (handled entirely by Stripe — EVE never sees full card numbers)
- Order history (what they bought, when, how much)
- Browsing behavior (pages visited, products viewed — via analytics)

### Protection Rules

**Agents NEVER:**
- Store raw customer email addresses, names, or addresses in their system prompts or conversation history
- Send customer PII (personally identifiable information) to any external service other than the ones needed for the transaction (Stripe for payment, shipping provider for fulfillment, email provider for transactional emails)
- Log customer data in the command log or workspace files
- Use customer data in ad creative or social media content without explicit consent
- Share one customer's data with another customer
- Export customer lists to any service not explicitly configured in floor settings

**Agents CAN:**
- Access aggregate data: "47 orders today", "average order value is $273", "top product is crystal snowflake set"
- Access anonymized segments: "returning customers", "cart abandoners", "VIP segment"
- Trigger transactional emails via the email API (Resend/ConvertKit) which handles the actual customer data
- Read order data from Stripe/Supabase when needed for customer support escalation

**Data storage:**
- Customer data lives in the database (Supabase/PostgreSQL) and Stripe — not in flat files
- The database is per-floor — each floor has its own tables
- Agents query the database through API functions, not direct SQL (unless Database tier 2 approved)
- Backups are encrypted

### Payment Security

- EVE NEVER handles raw credit card numbers. Stripe handles all payment processing.
- Stripe Publishable Key (frontend) and Secret Key (backend) are stored encrypted in settings.
- Webhook signatures are verified on every Stripe webhook to prevent spoofing.
- PCI compliance is handled by Stripe — EVE never enters PCI scope because it never touches card data.

---

## Part 3: Business Secrets Protection

### What's Considered a Business Secret

- Foundation Package (brand strategy, target customer, positioning)
- Pricing strategies and margin data
- Ad campaign performance data (ROAS, CPA, spend, targeting)
- Customer acquisition costs and LTV calculations
- Playbook library (proven strategies extracted from successful floors)
- Supplier/vendor information and cost of goods
- Revenue and profit data
- Content strategy and calendar
- Agent system prompts (contain skill knowledge and business intelligence)

### Protection Rules

**Cross-floor isolation:**
- Floor A's agents CANNOT access Floor B's data, workspace, or database
- Exception: CEO Mode can read aggregate data from all floors for cross-floor analysis
- Exception: cross-floor agent assist (approved by CEO Mode) gives temporary read access to specific workspace files, not full floor access
- The playbook library is abstracted — it contains strategies, not raw data. "Retargeting at 3% lookalike audience produced 6.9x ROAS" is a playbook entry. "TrimAR spent $420 on campaign X and made $1,890" stays in TrimAR's floor.

**Agent isolation:**
- Agents within a floor share the workspace (that's how they collaborate)
- But agents on different floors are fully isolated
- The PromptBuilder never leaks one floor's Foundation Package into another floor's agent prompts

**External exposure:**
- Business data is never sent to external services except as required for operations (ad platforms get campaign data, analytics gets tracking data)
- Agent system prompts are never exposed to end users or external APIs
- The playbook library is internal only — never published or shared externally

---

## Part 4: API Key Security

### Storage

- All API keys stored encrypted in the EVE database
- Keys are never hardcoded in source code
- Keys are never written to git repositories
- Keys are never included in agent system prompts (agents call functions that use keys internally)
- Keys are never logged in the command log (outputs are logged, but key values are masked)

### Access

- Only the PromptBuilder and deployment functions access raw keys
- Agents call wrapper functions: `generateImage(prompt)` not `fetch(url, { headers: { Authorization: GEMINI_API_KEY } })`
- This means even if an agent's conversation is compromised, the keys aren't in it

### Rotation

- Dashboard shows last-updated date for each key
- Dashboard shows status (connected / expired / not set)
- Keys should be rotated every 90 days (EVE can remind you)
- If a key is compromised: revoke at the provider, update in EVE settings, all floors automatically use the new key

### Per-Key Risk

| Key | What It Can Do If Leaked | Risk Level |
|---|---|---|
| `STRIPE_SECRET_KEY` | Create charges, refunds, access customer payment data | CRITICAL |
| `META_ACCESS_TOKEN` | Create/modify ad campaigns, spend ad budget | HIGH |
| `VERCEL_TOKEN` | Deploy code to the internet, modify domains | HIGH |
| `GEMINI_API_KEY` | Generate images/video (costs money, not destructive) | MEDIUM |
| `OPENAI_API_KEY` | Generate images (costs money, not destructive) | MEDIUM |
| `FAL_API_KEY` | Generate images/video (costs money, not destructive) | MEDIUM |
| `RUNWAY_API_KEY` | Generate video (costs money, not destructive) | MEDIUM |
| `ELEVENLABS_API_KEY` | Generate voiceovers (costs money, not destructive) | LOW |
| `RESEND_API_KEY` | Send emails from your domain | MEDIUM |

CRITICAL and HIGH keys get extra protection: never in agent prompts, never in logs, only accessed by server-side functions.

---

## Part 5: Privacy Compliance (US — CCPA)

Since you're US-only, CCPA (California Consumer Privacy Act) is the primary regulation. Even if not all customers are in California, following CCPA is best practice and protects you everywhere.

### What EVE Must Do

**Privacy policy (generated by Customer Support Agent during build):**
- What data you collect (email, name, address, order history, browsing behavior)
- Why you collect it (order fulfillment, marketing, analytics)
- Who you share it with (Stripe for payments, shipping provider, email provider, ad platforms for retargeting)
- How to opt out (email marketing unsubscribe, data deletion request)
- Contact info for privacy questions

**Cookie consent:**
- Analytics tracking (GA4, Meta Pixel) requires consent notice
- Web Agent implements a cookie consent banner on every floor's website
- Users can accept or decline non-essential cookies
- Essential cookies (cart, session) don't require consent

**Email compliance (CAN-SPAM):**
- Every marketing email includes an unsubscribe link
- Unsubscribe requests are honored within 10 business days (EVE does it instantly)
- Physical mailing address in every marketing email (required by law)
- No deceptive subject lines

**Data deletion:**
- If a customer requests data deletion, EVE must be able to remove their data from the database, email lists, and ad platform audiences
- Customer Support Agent handles these requests, Floor Manager verifies completion
- Stripe retains transaction records for legal/tax purposes (this is allowed)

**Ad platform compliance:**
- Meta Pixel and ad tracking must disclose data collection in the privacy policy
- Retargeting audiences must be based on consented data
- Custom audiences (email lists uploaded to Meta) must come from customers who opted in

### What EVE Generates Per Floor

During the build phase, Customer Support Agent + Copy Agent create:
- Privacy Policy page (added to the website footer)
- Terms of Service page
- Cookie consent banner (implemented by Web Agent)
- Unsubscribe flow (implemented by Email Agent)
- Data deletion request flow (email-based, handled by Customer Support Agent)

---

## Part 6: AI Safety

### Preventing Agents From Going Rogue

**Action verification:**
Every agent action that affects the real world (deploys code, sends emails, posts content, calls external APIs) goes through a verification layer:

```
Agent wants to take an action
  → Is this action within its tier 1 permissions? → proceed
  → Is this action tier 2? → Floor Manager must approve first
  → Is this action tier 3? → Human owner must approve first
  → Is this action forbidden? → blocked, logged, Floor Manager alerted
```

**Hallucination prevention:**
Agents can hallucinate (confidently state something false or take an action based on incorrect reasoning). Safeguards:

- **Agents work from data, not assumptions.** When an agent needs a fact (product price, customer count, revenue figure), it queries the database or workspace — it doesn't guess.
- **Financial actions require verification.** Finance Agent cross-checks any monetary claim before it's acted on. If Ads Agent says "ROAS is 4.5x," Finance Agent verifies from actual Stripe revenue and ad platform spend data.
- **Destructive actions are double-checked.** Before deleting files, pausing campaigns, or modifying live content, the agent states what it's about to do and why. If it's tier 2+, the approver sees the reasoning.
- **Agents admit uncertainty.** If an agent isn't confident about a decision, it escalates to Floor Manager rather than guessing. This is built into every agent's system prompt: "If you are not confident, say so and escalate."

**Scope enforcement:**
- Agents can only act within their defined role. The Copy Agent can't deploy code. The Web Agent can't activate ad campaigns.
- This is enforced by the PromptBuilder: each agent's system prompt explicitly lists what it can and cannot do.
- If an agent attempts an action outside its scope, the system blocks it and logs the attempt.

**Runaway prevention:**
- Agents have task budgets. If an agent makes more than 50 API calls on a single task without completing it, it's paused and Floor Manager investigates.
- If total API spend for any floor exceeds 150% of the daily budget, all agents on that floor pause and Floor Manager alerts you.
- If an agent enters a loop (repeating the same action), it's detected after 3 repetitions and paused.

**Content safety:**
- No agent publishes content that is offensive, discriminatory, misleading, or legally problematic
- Brand Agent reviews all public-facing content before it's published
- Community Agent follows brand voice guidelines and never engages in arguments, makes promises it can't keep, or discloses internal business information
- Ad content complies with platform policies (Meta, TikTok, Google each have ad content rules — Ads Agent knows these)

### Incident Response

If something goes wrong (agent takes an unintended action, data is exposed, key is compromised):

```
1. CONTAIN — Pause the affected agent(s) immediately
2. ASSESS — Floor Manager determines what happened and the impact
3. NOTIFY — Human owner is alerted via Telegram/Discord with full context
4. REMEDIATE — Revert the action if possible (version history, backups)
5. PREVENT — Update rules/prompts to prevent recurrence
6. LOG — Full incident report stored for future reference
```

---

## Security Checklist (Per Floor Launch)

Before any floor goes live, Launch Agent verifies:

```
□ Privacy policy page live and accurate
□ Terms of service page live
□ Cookie consent banner functional
□ Unsubscribe flow working in all email sequences
□ Data deletion process documented
□ Stripe in live mode with webhook signatures verified
□ All API keys stored encrypted, not in source code
□ No customer PII in agent logs or workspace files
□ Cross-floor data isolation verified
□ Ad tracking disclosed in privacy policy
□ SSL active on all domains
□ No exposed environment variables in client-side code
□ Command logging active for all agents
```

---

## Key Principle

Security is not a feature — it's a constraint that applies to everything. Every agent, every action, every piece of data follows these rules. Customer trust is the foundation of every business EVE builds. One data breach or privacy violation can destroy a floor faster than any competitor. Protect the data like it's your own — because the business reputation depends on it.
