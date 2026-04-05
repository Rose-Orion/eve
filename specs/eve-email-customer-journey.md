# EVE — Email & Customer Journey Workflow
## The Revenue You Make After The First Sale

---

# WHY THIS MATTERS

Acquiring a new customer costs 5-7x more than retaining one. Email is the highest-ROI marketing channel — $36 average return per $1 spent. Every floor needs automated email sequences running from day one, converting browsers to buyers and one-time buyers to repeat customers.

**Two email systems:**
- **Resend** — transactional emails (order confirmation, shipping, password reset). Triggered by events. Must deliver instantly. No marketing.
- **Kit (formerly ConvertKit)** — marketing emails (welcome series, abandoned cart, win-back, promotions). Automation-driven. Must be engaging and on-brand.

---

# EMAIL INFRASTRUCTURE

```
SETUP (Commerce Agent + Web Agent):

  Resend (transactional):
  - API key configured in .env
  - Sender: orders@faithforge.com (or floor domain)
  - Templates built by Copy Agent, implemented by Web Agent
  - Fires from Next.js API routes on specific events
  - No unsubscribe needed (transactional = legally required)

  Kit (marketing):
  - Account created by YOU (EVE cannot create accounts)
  - API key provided to EVE via Settings
  - Automation flows configured via Kit API
  - Tags and segments managed by Commerce Agent
  - Subscriber added on: email capture, checkout, manual import
  - All marketing emails include unsubscribe link (CAN-SPAM/GDPR)

DELIVERABILITY:
  - Custom sending domain (faithforge.com) with SPF, DKIM, DMARC
  - Web Agent configures DNS records, YOU verify in domain settings
  - Warm-up: start with small sends, increase volume over 2 weeks
  - Monitor bounce rate (target < 2%) and spam rate (target < 0.1%)
```

---

# THE SIX EMAIL SEQUENCES

## Sequence 1: Welcome Series (New Subscriber)

**Trigger:** Email captured via website signup form (newsletter popup, footer form, lead magnet)

```
EMAIL 1: Immediate
  Subject: "Welcome to the family 🙏"
  Content:
  - Thank them for joining
  - Brand story in 2-3 sentences (who you are, what you stand for)
  - What to expect (content frequency, what kind of emails)
  - Hero image of the brand
  - Soft CTA: "Browse the collection →"
  
EMAIL 2: Day 2
  Subject: "The story behind [brand name]"
  Content:
  - Deeper brand story (why this brand exists)
  - Values and mission
  - Social proof (Instagram feed preview or customer photo)
  - CTA: "Follow us on Instagram →"

EMAIL 3: Day 4
  Subject: "Our bestsellers (and why people love them)"
  Content:
  - Top 3 products with images
  - Short descriptions emphasizing benefits
  - Customer quotes/reviews if available
  - CTA: "Shop bestsellers →"

EMAIL 4: Day 7
  Subject: "Here's 10% off your first order"
  Content:
  - Exclusive discount code for subscribers
  - Urgency: "Valid for 48 hours"
  - Curated product selection
  - CTA: "Use code WELCOME10 →"

EMAIL 5: Day 9 (if they haven't purchased)
  Subject: "Last chance — your 10% off expires tonight"
  Content:
  - Reminder of discount
  - Countdown urgency
  - Single product hero image (bestseller)
  - CTA: "Grab it before midnight →"

SEQUENCE EXITS:
  - If they purchase at any point → exit welcome sequence
  - Tag as "customer" → enter post-purchase sequence
  - If no purchase after Email 5 → tag as "subscriber-no-purchase"
  - Move to regular content emails (newsletter)
```

## Sequence 2: Abandoned Cart Recovery

**Trigger:** Customer adds product to cart but doesn't complete checkout within 1 hour.

**Technical implementation:**
```
HOW CART ABANDONMENT IS DETECTED:

  Option A (Stripe Checkout):
  - Customer clicks "Checkout" → Stripe Checkout Session created
  - Stripe webhook: checkout.session.expired (fires after session timeout)
  - Or: track sessions created but no checkout.session.completed within 1 hour
  - Match session to email (if captured at checkout start)

  Option B (Custom checkout):
  - Track add-to-cart events in Supabase
  - Background job checks every 15 minutes for carts with items but no order
  - If cart age > 1 hour and email captured → trigger sequence
  - Store cart contents for use in emails

  Either way → Add subscriber to Kit with tag "abandoned-cart"
  → Kit automation triggers the sequence
```

```
EMAIL 1: +1 hour after abandonment
  Subject: "Forgot something? 👀"
  Content:
  - Casual, friendly reminder (not salesy)
  - Product image(s) from their cart
  - "Your cart is waiting for you"
  - CTA: "Complete your order →" (link back to cart with items pre-loaded)
  - NO discount yet

EMAIL 2: +24 hours
  Subject: "Still thinking it over?"
  Content:
  - Acknowledge they may have been busy
  - Social proof (reviews, how many people bought this product)
  - Product benefits (why it's worth it)
  - CTA: "Get it before it's gone →"
  - Still NO discount

EMAIL 3: +48 hours
  Subject: "Here's 10% off to make it easier"
  Content:
  - Discount code specific to this sequence
  - Urgency: "Expires in 24 hours"
  - Final product image with price (showing savings)
  - CTA: "Complete your order — save 10% →"
  - This is the last email. Don't over-pursue.

SEQUENCE EXITS:
  - Purchase completed → exit immediately, enter post-purchase
  - Email 3 sent → exit regardless
  - If they purchase with discount → tag "converted-from-cart-recovery"
  - Track: recovery rate (industry average 5-10%, target 8%+)

COST CONSIDERATION:
  The 10% discount in Email 3 means less margin on that sale.
  But recovered revenue > lost revenue. A $35 shirt at 10% off 
  ($31.50) is better than a $0 lost sale.
```

## Sequence 3: Post-Purchase Flow

**Trigger:** Stripe webhook — checkout.session.completed (order placed)

```
EMAIL 1: Immediate (via Resend — transactional)
  Subject: "Order confirmed! 🎉 #FF-12345"
  Content:
  - Order number and summary
  - Products ordered with images
  - Shipping address
  - Estimated delivery date
  - "Questions? Reply to this email"
  - Note: this is a TRANSACTIONAL email, not marketing

EMAIL 2: When shipped (via Resend — transactional)
  Subject: "Your order is on its way! 📦"
  Trigger: Fulfillment provider webhook (tracking number received)
  Content:
  - Tracking number with carrier link
  - Estimated delivery date
  - "Track your package →"

EMAIL 3: Estimated delivery date +1 day (via Resend)
  Subject: "Did your order arrive? ✅"
  Content:
  - Quick check-in
  - "If anything isn't right, just reply — we'll fix it"
  - Link to contact/support

EMAIL 4: Delivery +5 days (via Kit — marketing)
  Subject: "How's your [product name]? We'd love to hear"
  Content:
  - Ask for a review
  - Simple star rating link (takes them to product page review section)
  - Photo of the product they bought
  - "Share a photo wearing it and tag us @faithforge for a chance
     to be featured!"
  - Soft social proof: "Join 500+ happy customers"

EMAIL 5: Delivery +14 days (via Kit — marketing)
  Subject: "Picked these for you 👀"
  Content:
  - Cross-sell recommendations based on what they bought
  - "People who bought [product] also love [recommendations]"
  - 3 product recommendations with images
  - CTA: "Browse your picks →"
  - Optional: exclusive repeat customer discount (5% off next order)

SEQUENCE EXITS:
  - Complete after Email 5
  - Tag as "customer-active"
  - Move to regular newsletter + promotional emails
  - If they purchase again → restart post-purchase at Email 1
```

## Sequence 4: Win-Back (Inactive Customers)

**Trigger:** Customer hasn't opened an email in 60 days AND hasn't purchased in 90 days.

```
EMAIL 1: Day 0 (60 days inactive)
  Subject: "We miss you 🙏"
  Content:
  - Personal, warm tone
  - "It's been a while since we've heard from you"
  - Show what's new (new products, new designs)
  - CTA: "See what's new →"

EMAIL 2: Day 7 (67 days inactive)
  Subject: "A little something for you — 15% off"
  Content:
  - Exclusive win-back discount (higher than normal)
  - "We want you back in the family"
  - Bestsellers + new arrivals
  - CTA: "Use code COMEBACK15 →"

EMAIL 3: Day 14 (74 days inactive)
  Subject: "Last call — should we keep in touch?"
  Content:
  - Honest question: do you still want to hear from us?
  - Two buttons: "Yes, keep me!" / "Unsubscribe"
  - If they click "Yes" → tag "re-engaged", keep on list
  - If they click "Unsubscribe" → remove from list
  - If no click within 7 days → auto-remove from active list

WHY WE REMOVE INACTIVE SUBSCRIBERS:
  - Dead emails hurt deliverability scores
  - Spam filters track engagement rates
  - A clean list of 500 engaged subscribers > 5,000 unengaged
  - Commerce Agent monitors list hygiene monthly
```

## Sequence 5: VIP / Repeat Customer

**Trigger:** Customer has purchased 3+ times OR spent $150+ total

```
EMAIL 1: Immediate on qualification
  Subject: "You've earned VIP status 🏆"
  Content:
  - Thank them for their loyalty
  - Exclusive VIP perks:
    - Early access to new drops (24h before everyone else)
    - Permanent 10% discount code
    - Priority customer support
  - Make them feel special (because they are — these are your best customers)

ONGOING VIP TREATMENT:
  - Tag: "vip-customer"
  - Receive new product announcements 24h early
  - Receive exclusive VIP-only promotions
  - Excluded from aggressive promotional emails (they already buy)
  - Included in customer feedback requests (their opinion matters most)
  - Birthday email if birthday captured (personalized discount)
```

## Sequence 6: Product Launch / Promotional Broadcast

**Not a sequence — sent as one-time broadcasts by the Social Media Agent**

```
WHEN TO SEND:
  - New product drop
  - Seasonal sale (Black Friday, holiday, etc.)
  - Flash sale or limited edition
  - Major brand milestone

SEGMENTATION:
  Different versions for different segments:
  - VIP customers: early access, exclusive pricing
  - Active customers: standard announcement
  - Subscribers (never purchased): stronger incentive, social proof
  - Win-back segment: deeper discount

FREQUENCY RULES:
  - Maximum 2 promotional broadcasts per week
  - Always provide value (not just "buy this")
  - Copy Agent writes all broadcast content
  - Brand Agent reviews before sending
  - Analytics Agent tracks: open rate, click rate, conversion rate, revenue
```

---

# CUSTOMER SEGMENTATION

```
SEGMENTS (managed by Commerce Agent via Kit tags):

  SUBSCRIBER LIFECYCLE:
  ├── new-subscriber (just joined, in welcome sequence)
  ├── subscriber-engaged (opens/clicks regularly, hasn't purchased)
  ├── subscriber-inactive (no opens in 30+ days)
  └── subscriber-removed (cleaned from list)

  CUSTOMER LIFECYCLE:
  ├── first-time-buyer (1 purchase)
  ├── repeat-buyer (2+ purchases)
  ├── vip-customer (3+ purchases OR $150+ total)
  ├── at-risk (purchased before, no activity in 60 days)
  └── lapsed (purchased before, no activity in 90+ days)

  BEHAVIORAL:
  ├── cart-abandoner (added to cart, didn't purchase)
  ├── browse-abandoner (viewed products, didn't add to cart)
  ├── discount-motivated (only purchases with discount codes)
  └── full-price-buyer (purchases without discounts)

  HOW SEGMENTS ARE MAINTAINED:
  - Tags applied automatically via Kit automations
  - Commerce Agent reviews segment health weekly
  - Dashboard shows: subscribers by segment, growth rate, conversion rate
```

---

# CUSTOMER LIFETIME VALUE (CLV) TRACKING

```
CLV CALCULATION (Finance Agent):

  CLV = Average Order Value × Purchase Frequency × Customer Lifespan

  Example:
  AOV: $42 × Frequency: 2.3 purchases/year × Lifespan: 2 years
  CLV: $193.20

TRACKING:
  - Finance Agent calculates CLV monthly
  - Segmented by acquisition source (organic, Meta ads, TikTok ads, email)
  - Identifies which channels bring the highest CLV customers
  - Feeds into ad optimization: bid higher for lookalikes of high-CLV customers

CLV-BASED DECISIONS:
  - If CLV > 3x CPA → scale that acquisition channel
  - If CLV < 1.5x CPA → investigate (low repeat rate? low AOV?)
  - VIP segment CLV tracked separately (these are the most valuable)
  - Win-back discount justified if customer's CLV > discount cost
```

---

# COPY AGENT'S EMAIL RESPONSIBILITIES

```
WHAT COPY AGENT WRITES:
  - All email subject lines (3 variations per email, A/B tested via Kit)
  - All email body copy
  - CTA button text
  - Product descriptions within emails

BRAND VOICE IN EMAILS:
  - Loaded from Foundation Package (same voice as social media and website)
  - Emails should feel like a message from a friend, not a corporation
  - Use the customer's first name when available
  - Short paragraphs (2-3 sentences max)
  - One clear CTA per email (not multiple competing links)
  - Mobile-optimized (most email is read on phones)

REVIEW:
  - Brand Agent reviews all email templates before activation
  - Analytics Agent tracks performance → feeds back to Copy Agent
  - Subject lines A/B tested: Kit sends variant A to 15%, variant B to 15%,
    winner sent to remaining 70%
```

---

# WHAT EVE HANDLES vs. WHAT YOU DO

```
EVE (automated):
  ✅ Write all email copy (Copy Agent)
  ✅ Design email templates (Design Agent → simple, text-focused)
  ✅ Configure Kit automation flows via API
  ✅ Tag subscribers based on behavior
  ✅ Monitor deliverability and list health
  ✅ Track open rates, click rates, conversion rates
  ✅ A/B test subject lines
  ✅ Trigger transactional emails via Resend API
  ✅ Generate weekly email performance report

YOU (manual):
  ❌ Create Kit account and provide API key
  ❌ Verify sending domain (DNS records — EVE provides instructions)
  ❌ Review and approve email templates before activation
  ❌ Decide on discount amounts for sequences
  ❌ Handle customer replies that get escalated
```
