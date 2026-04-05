# Phase 4 Email Automation — Quick Start Guide

## What Was Built

Complete email automation infrastructure for EVE with:
- ✓ Sequence execution engine (enrollment → templating → sending)
- ✓ 6 pre-configured email sequences (welcome, abandoned-cart, post-purchase, win-back, vip, broadcast)
- ✓ Abandoned cart detection & recovery
- ✓ Subscriber lifecycle segmentation (7 segments)
- ✓ Customer Lifetime Value (CLV) calculations

## Usage Patterns

### 1. Enroll a Subscriber
```typescript
import { enrollSubscriber } from './orchestrator/email-automation.js';

const enrollment = await enrollSubscriber(
  'floor-123',
  'customer@example.com',
  'welcome',
  { firstName: 'John', businessName: 'My Store' }
);
// Returns enrollment record or null if excluded
```

### 2. Process Pending Emails (Every 5 minutes)
```typescript
import { processEnrollments } from './orchestrator/email-automation.js';

const count = await processEnrollments();
console.log(`Sent ${count} emails`);
```

### 3. Track Shopping Cart
```typescript
import { trackCartEvent, checkAbandonedCarts } from './orchestrator/cart-tracker.js';

// When user adds items
trackCartEvent(
  'floor-123',
  'session-id',
  'customer@example.com',
  [
    { productId: 'prod-1', name: 'Widget', quantity: 2, priceCents: 2999 }
  ]
);

// Check every 15 minutes
const abandonedCount = await checkAbandonedCarts();

// On successful checkout
markCartConverted('session-id');
```

### 4. Update Subscriber Segment
```typescript
import { updateSegment, getSegmentCounts } from './orchestrator/subscriber-intelligence.js';

// When order created or email opened
const segment = await updateSegment('floor-123', 'customer@example.com');
// Returns: 'vip' | 'at-risk' | 'lapsed' | 'repeat-buyer' | ... 

// Get segment distribution
const counts = await getSegmentCounts('floor-123');
// { new-subscriber: 42, vip: 5, at-risk: 3, ... }
```

### 5. Record Email Open
```typescript
import { recordEmailOpen } from './orchestrator/subscriber-intelligence.js';

// When email open pixel fires (webhook)
await recordEmailOpen('floor-123', 'customer@example.com');
```

## Integration Checklist

- [ ] Wire `processEnrollments()` to BullMQ queue (every 5 min)
- [ ] Wire `checkAbandonedCarts()` to BullMQ queue (every 15 min)
- [ ] Wire `runSegmentationUpdate()` to BullMQ queue (nightly at 2 AM)
- [ ] Wire `cleanupOldCarts()` to BullMQ queue (daily)
- [ ] Add Stripe webhook handlers:
  - `checkout.session.updated` → `trackCartEvent()`
  - `checkout.session.completed` → `markCartConverted()`
- [ ] Add email open tracking webhooks → `recordEmailOpen()`
- [ ] Initialize event bus listeners:
  - `initializeCartTracker(eventBus)`
  - `initializeSubscriberIntelligence(eventBus)`
- [ ] Add Dashboard API endpoints:
  - `GET /floors/:id/sequences` — list active sequences
  - `GET /floors/:id/subscribers` — segment distribution
  - `GET /floors/:id/vips` — top VIPs by CLV

## Sequence Timing

| Sequence | Duration | Steps | Exit Trigger |
|----------|----------|-------|--------------|
| welcome | 9 days | 5 emails | Purchase |
| abandoned-cart | 48 hrs | 3 emails | Purchase |
| post-purchase | 14 days | 5 emails (mixed channels) | None |
| win-back | 14 days | 3 emails | Purchase or re-engagement |
| vip | Ongoing | 2 emails (repeating) | None |
| broadcast | 1 send | 1 email | N/A (on-demand) |

## Segment Rules (Auto-Applied)

```
VIP           → 3+ purchases OR $150+ spend
At-Risk       → No email opens in 60+ days
Lapsed        → No purchase in 90+ days (but was buyer)
Repeat-Buyer  → 2+ purchases
First-Buyer   → 1 purchase
Engaged       → Email open in last 30 days
New           → Default
```

## Variable Substitution in Emails

```
{{firstName}}          → John
{{businessName}}       → My Store
{{productName}}        → Widget Pro
{{discountCode}}       → WELCOME15
{{cartItems}}          → Widget (2), Gizmo (1)
{{orderId}}            → ord-12345
{{trackingNumber}}     → TRACK-999
{{broadcastSubject}}   → Custom campaign title
{{broadcastBody}}      → Custom campaign HTML
```

## CLV Formula

```
CLV = AOV × (Purchase Frequency × Lifespan + 1)

Where:
  AOV = Average Order Value (total spent / purchase count)
  Purchase Frequency = 0.5 (assumes 1 purchase per 2 months)
  Lifespan = 24 months (2 years)
```

## Event Emissions

The system automatically emits structured events:

```typescript
// Cart events
'cart:tracked'        // User added items
'cart:abandoned'      // Cart > 1 hour, no conversion
'cart:converted'      // Checkout completed

// Subscriber events
'subscriber:segmented'     // Segment changed
'subscriber:vip-promoted'  // New VIP detected
'subscriber:at-risk'       // Inactivity alert
```

## Files

- `src/orchestrator/email-automation.ts` — Sequence engine + 6 sequences
- `src/orchestrator/cart-tracker.ts` — Abandoned cart detection
- `src/orchestrator/subscriber-intelligence.ts` — Segmentation + CLV
- `src/orchestrator/event-bus.ts` — Event type definitions (updated)

## Testing

```bash
# Verify TypeScript compilation
node_modules/.bin/tsc --noEmit

# All functions are unit-testable:
# - Pure functions: renderTemplate, calculateCLV
# - Async helpers: enrollSubscriber, processEnrollments, updateSegment
# - State queries: getProfile, getSegmentCounts, getTopVIPs
```

---

**Status:** Ready for production integration. All core logic is isolated and testable. TODOs are Supabase persistence and BullMQ wiring.
