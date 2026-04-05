# Phase 4 Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         EVENT BUS                                │
│  (Emits: cart:*, subscriber:*, order:*, etc.)                   │
└─────────────────────────────────────────────────────────────────┘
                      ▲                    ▲
                      │                    │
         ┌────────────┴────────────┬───────┴───────────┐
         │                         │                   │
    ┌────┴────────┐         ┌──────┴────┐      ┌──────┴──────┐
    │  CartTracker │         │EmailAuto  │      │SubscriberInt│
    └───┬────────┬─┘         └──────┬────┘      └──────┬──────┘
        │        │                  │                  │
        │ 📧     │ 🛒                │ 📤                │ 📊
        │        │                  │                  │
    ┌───┴────────┴──────────────────┴──────────────────┴────┐
    │                    RESEND / KIT                         │
    │           (Transactional & Marketing Email)             │
    └─────────────────────────────────────────────────────────┘
         ▲                     ▲                ▲
         │                     │                │
    Open Event             Template            Enrollment
    Tracking              Rendering            Storage


                         DATA FLOW

Website Signup                        Shopping Cart
    │                                    │
    ▼                                    ▼
enrollSubscriber()                trackCartEvent()
    │                                    │
    ▼                                    ▼
SequenceEnrollment Record          CartState {items,email,time}
    │                                    │
    │                         ┌──────────┤
    │                         │ (wait 1 hour)
    │                         ▼
    │                    checkAbandonedCarts()
    │                         │
    │                    Cart > 1hr old?
    │                    No conversion yet?
    │                         │
    │                    YES ──┴──► enrollSubscriber('abandoned-cart')
    │                    NO  ──┐
    │                         │
    │                         ▼ (on checkout.session.completed)
    │                    markCartConverted()
    │                         │
    │                    exitSequence()
    │
    ├─ processEnrollments() (every 5 min)
    │
    ├─ nextSendAt <= now?
    │  AND status='active'
    │
    ├─ renderTemplate(body, {{vars}})
    │
    ├─ sendSequenceEmail(via Resend/Kit)
    │
    ├─ currentStep++
    │
    ├─ Calculate nextSendAt for next step
    │
    └─ Mark 'completed' when maxEmails reached


                    SUBSCRIBER LIFECYCLE

Customer purchases...              Customer inactive...
    │                                  │
    ▼                                  ▼
order:created event            60+ days no email open
    │                                  │
    ▼                                  ▼
updateSegment()                  updateSegment()
    │                                  │
    ├─ purchaseCount++                ├─ segment='at-risk'
    ├─ totalSpendCents+=X             │
    ├─ lastPurchaseAt=now             ├─ enrollSubscriber('win-back')
    │                                  │
    ├─ segment='repeat-buyer'         └─ emit 'subscriber:at-risk'
    │
    ├─ 3+ purchases OR $150+?
    │  YES ──► segment='vip'
    │       ──► enrollSubscriber('vip')
    │       ──► emit 'subscriber:vip-promoted'
    │
    ├─ calculateCLV()
    │  = AOV × (Freq × Lifespan + 1)
    │  = (totalSpend/count) × (0.5 × 24 + 1)
    │
    └─ emit 'subscriber:segmented'


                    BACKGROUND TASKS (BullMQ)

┌─────────────────────────────────────────┐
│  Every 5 minutes                        │
│  → processEnrollments()                 │
│     (Send due emails, advance steps)    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Every 15 minutes                       │
│  → checkAbandonedCarts()                │
│     (Find & enroll carts > 1hr)        │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Daily (2 AM)                           │
│  → runSegmentationUpdate(floorId)       │
│     (Re-segment all subscribers)        │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Daily                                  │
│  → cleanupOldCarts()                    │
│     (Delete old carts > 30 days)       │
└─────────────────────────────────────────┘


                    DATA PERSISTENCE

┌─────────────────────────────────────────┐
│         SUPABASE (PostgreSQL)           │
├─────────────────────────────────────────┤
│ TABLE: email_sequences                  │
│  - enrollmentId (PK)                    │
│  - floorId, email                       │
│  - sequenceName, currentStep            │
│  - nextSendAt, status                   │
│  - metadata (JSONB)                     │
│  - createdAt, updatedAt                 │
├─────────────────────────────────────────┤
│ TABLE: subscriber_profiles              │
│  - (floorId, email) (PK)                │
│  - segment, tags[]                      │
│  - purchaseCount, totalSpendCents       │
│  - clv, lastPurchaseAt, lastOpenAt      │
│  - acquisitionSource                    │
│  - createdAt, updatedAt                 │
├─────────────────────────────────────────┤
│ TABLE: cart_states                      │
│  - sessionId (PK)                       │
│  - floorId, email, items[]              │
│  - createdAt, convertedAt?              │
└─────────────────────────────────────────┘


              6 EMAIL SEQUENCES IN DETAIL

┌─────────────────────────────────────────┐
│ WELCOME (5 emails, 9 days)              │
│ Day 0:  Brand story → {{discountCode}}  │
│ Day 2:  Bestsellers showcase            │
│ Day 4:  Social proof testimonials       │
│ Day 7:  15% exclusive offer             │
│ Day 9:  Last chance reminder            │
│ Exit:   purchase (order:created)        │
│ Channel: Kit                            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ ABANDONED-CART (3 emails, 48 hrs)       │
│ 1h:     Cart reminder + {{cartItems}}   │
│ 24h:    Benefits of {{productName}}     │
│ 48h:    10% discount ({{discountCode}}) │
│ Exit:   purchase                        │
│ Channel: Kit                            │
│ Trigger: Cart > 1 hour unconverted      │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ POST-PURCHASE (5 emails, 14 days)       │
│ 0h:     Confirmation ({{orderId}})      │ ← Resend
│ 2d:     Shipped + {{trackingNumber}}    │ ← Resend
│ 5d:     Check-in survey                 │ ← Kit
│ 10d:    Review request                  │ ← Kit
│ 14d:    Cross-sell recommendations      │ ← Kit
│ Channel: Mixed (Resend→Kit)             │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ WIN-BACK (3 emails, 14 days)            │
│ Day 0:  "We miss you" message           │
│ Day 7:  15% discount offer              │
│ Day 14: Last call (code expires)        │
│ Exit:   purchase or re-engagement       │
│ Channel: Kit                            │
│ Trigger: No purchase 90+ days (buyer)   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ VIP (2 emails, ongoing)                 │
│ Step 0: Early access to new products    │ ← Kit
│ Step 1: 10% permanent VIP discount      │ ← Kit
│ Auto-enroll: 3+ purchases OR $150+ LTV  │
│ Channel: Kit                            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ BROADCAST (1 email, on-demand)          │
│ {{broadcastSubject}} + {{broadcastBody}}│
│ Channel: Kit                            │
│ Note: Segmented by {{segmentFilter}}    │
│ Max 2/week per floor (safeguard)        │
└─────────────────────────────────────────┘


            7 SUBSCRIBER LIFECYCLE SEGMENTS

┌─────────────────────────────────────────┐
│ VIP                                     │
│ 3+ purchases OR $150+ spend             │
│ Action: Auto-enroll 'vip' sequence      │
│ Action: Emit 'subscriber:vip-promoted'  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ AT-RISK                                 │
│ 60+ days without email open             │
│ Action: Auto-enroll 'win-back' sequence │
│ Action: Emit 'subscriber:at-risk'       │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ LAPSED                                  │
│ 90+ days without purchase (was buyer)   │
│ Action: Tag for manual re-engagement    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ REPEAT-BUYER                            │
│ 2+ purchases                            │
│ Action: Segment-specific offers         │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ FIRST-TIME-BUYER                        │
│ Exactly 1 purchase                      │
│ Action: Cross-sell recommendations      │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ ENGAGED                                 │
│ Email open in last 30 days              │
│ Action: Increase send frequency         │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ NEW-SUBSCRIBER                          │
│ Default (just signed up)                │
│ Action: Welcome sequence                │
└─────────────────────────────────────────┘


                   INTEGRATION POINTS

Stripe Webhooks                  Email Webhooks
├─ checkout.session.updated  ───  Open pixel fired
│  └─ trackCartEvent()          └─ recordEmailOpen()
│
├─ checkout.session.completed
│  └─ markCartConverted()
│
└─ order.fulfilled
   └─ (already handled by
      order:created event)


                    WEBHOOK FLOW

Website/Stripe                 Email Service (Resend/Kit)
        │                               │
        ├─ checkout.session.updated ──► trackCartEvent()
        │                               
        ├─ checkout.completed ────────► markCartConverted()
        │                          │
        │ (order created)          └─► exitSequence('abandoned-cart')
        │
        └─ order:created event (EventBus)
                │
                ├─► updateSegment()
                │     └─ Emit 'subscriber:vip-promoted' if new VIP
                │
                └─► enrollSubscriber('post-purchase')
                     └─ Send confirmation email (Resend)


                  DEPLOYMENT CHECKLIST

Phase 4 Complete:
✓ Code written (1,329 lines)
✓ TypeScript strict mode (0 errors)
✓ Event types added
✓ All exports verified
✓ Ready for integration

Next Steps:
□ Add Supabase migrations (email_sequences, subscriber_profiles, cart_states)
□ Wire BullMQ tasks (5/15/60/1440 min intervals)
□ Add Stripe webhook handlers
□ Add email open tracking webhooks
□ Initialize event listeners on orchestrator boot
□ Add Dashboard API endpoints
□ Write integration tests
□ Deploy to staging

