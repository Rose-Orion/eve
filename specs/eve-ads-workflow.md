# EVE — Ads Workflow
## From Campaign Strategy to Autonomous Optimization

---

# KEY RESEARCH FINDINGS

**1. Meta API v25.0 (Q1 2026) unified Advantage+ campaigns.** No more separate ASC/AAC workflows. Single campaign creation with automation determined by budget, audience, and placement settings. EVE must use the new unified structure.

**2. Creative is the #1 variable.** Campaign structure, audiences, and bidding matter, but creative is what moves the needle most. The teams winning in 2026 test hundreds of creative variations simultaneously — interaction effects (specific creative + specific audience = unexpected winner) are invisible in sequential A/B testing but revealed in bulk testing.

**3. Conversions API (CAPI) is now mandatory.** Meta Pixel alone only tracks 60-70% of conversions due to iOS privacy changes. Server-side tracking via CAPI ensures Meta's algorithm gets accurate conversion signals. Without it, campaigns optimize on incomplete data and waste budget.

**4. Manual management hits a wall at ~50 active ads.** Beyond that, spreadsheets multiply and optimization cycles stretch longer. API-driven automation is the only way to manage at scale — which is exactly what EVE does natively.

**5. The best performers use a "Winners Hub" pattern.** Track which creatives, headlines, audiences, and landing pages produce the best results. Reuse winning elements in future campaigns. EVE's playbook library serves this function.

---

# THE ADS TECH STACK

| Component | Technology | Purpose |
|---|---|---|
| Campaign management | Meta Marketing API (v25.0+) | Create, manage, optimize Meta campaigns |
| TikTok ads | TikTok Marketing API | Create and manage TikTok ad campaigns |
| Conversion tracking | Meta Conversions API (CAPI) | Server-side conversion tracking |
| Pixel tracking | Meta Pixel + TikTok Pixel | Client-side event tracking |
| Attribution | UTM parameters + platform attribution | Track ad → visit → purchase |
| Creative production | EVE content pipeline | Generate ad creative at scale |
| Landing pages | Floor's Next.js website | Conversion destination |

---

# THE THREE-PHASE AD LIFECYCLE

## Phase A: Campaign Architecture (Pre-Launch, Ads Agent)

**Runs during the build phase (Phase 7 of the 10-phase pipeline)**

```
STEP 1: COMPETITIVE RESEARCH (Ads Agent)
  │
  ├── Scan Meta Ad Library for competitor ads in the niche
  │   - What creative formats are they using? (video, image, carousel, UGC)
  │   - What hooks/headlines are they testing?
  │   - What landing pages are they sending traffic to?
  │   - How long have their ads been running? (longevity = performance)
  │
  ├── Scan TikTok Creative Center for top-performing ads
  │   - Which ad formats get highest engagement in the niche?
  │   - What CTAs are converting?
  │   - What music/audio is being used?
  │
  └── Document findings:
      - Top 5 creative approaches in the niche
      - Messaging angles that appear to work
      - Gaps nobody is filling (our opportunity)
      → Saved to /ads/competitive-research.json

STEP 2: AUDIENCE STRATEGY (Ads Agent)
  │
  ├── Define audience segments from Foundation Package:
  │
  │   SEGMENT 1: Broad Interest Targeting
  │   - Age: 18-35
  │   - Interests: faith, streetwear, urban fashion, Christian lifestyle
  │   - Lookalike: none yet (no customer data)
  │   - Purpose: Discovery — find who responds
  │
  │   SEGMENT 2: Narrow Interest Stacking
  │   - Age: 18-30
  │   - Interests: faith + streetwear (intersection, not union)
  │   - Behaviors: online shoppers, engaged shoppers
  │   - Purpose: More qualified traffic
  │
  │   SEGMENT 3: Retargeting (activates post-launch)
  │   - Website visitors (last 30 days)
  │   - Add to cart but didn't purchase (last 14 days)
  │   - Viewed product pages (last 7 days)
  │   - Purpose: Convert warm traffic
  │
  │   SEGMENT 4: Lookalike (activates after 100+ purchases)
  │   - 1% lookalike of purchasers
  │   - 3% lookalike of purchasers
  │   - Purpose: Scale to similar people
  │
  └── Document audience strategy:
      → Saved to /ads/audience-strategy.json

STEP 3: CAMPAIGN STRUCTURE (Ads Agent)
  │
  ├── Design campaign hierarchy using Meta's unified Advantage+ structure:
  │
  │   CAMPAIGN 1: Prospecting — Broad
  │   ├── Objective: Sales (purchase conversion)
  │   ├── Budget: $25/day (Advantage+ campaign budget)
  │   ├── Advantage+ settings:
  │   │   budget: automatic (CBO distributes across ad sets)
  │   │   audience: advantage_audience enabled (Meta expands beyond interest targeting)
  │   │   placements: Advantage+ placements (all placements, Meta optimizes)
  │   ├── Ad Set 1: Broad Interest (Segment 1)
  │   │   ├── Ad 1: Video (UGC-style) + Headline A + Body A
  │   │   ├── Ad 2: Video (product showcase) + Headline A + Body B
  │   │   ├── Ad 3: Image (lifestyle) + Headline B + Body A
  │   │   ├── Ad 4: Carousel (product range) + Headline B + Body B
  │   │   └── Ad 5: Image (product close-up) + Headline C + Body A
  │   └── Ad Set 2: Stacked Interest (Segment 2)
  │       ├── Ad 1-5: Same creative variations as Ad Set 1
  │       └── (tests if narrower audience performs better with same creative)
  │
  │   CAMPAIGN 2: Retargeting (activates post-launch with traffic)
  │   ├── Objective: Sales
  │   ├── Budget: $15/day
  │   ├── Ad Set 1: Site visitors (30 days)
  │   │   ├── Dynamic product ads (show products they viewed)
  │   │   ├── Social proof ads (reviews, testimonials)
  │   │   └── Urgency ads (limited stock, sale ending)
  │   └── Ad Set 2: Cart abandoners (14 days)
  │       ├── Reminder ads ("Still thinking about it?")
  │       └── Incentive ads ("Complete your order, get 10% off")
  │
  │   CAMPAIGN 3: TikTok Prospecting
  │   ├── Objective: Website conversions
  │   ├── Budget: $10/day
  │   ├── Targeting: 18-30, streetwear + faith interests
  │   ├── Ad Group 1: UGC-style videos (3-5 variations)
  │   └── Ad Group 2: Spark Ads (boost organic posts performing well)
  │
  └── All campaigns created as PAUSED
      → Gate 3: You review and activate individually

STEP 4: CREATIVE PRODUCTION (Parallel — Ads Agent coordinates)
  │
  ├── Ads Agent writes creative briefs (angles + formats):
  │
  │   ANGLE 1: Identity ("Wear your faith without compromise")
  │   ANGLE 2: Social proof ("Join 500+ believers rocking FaithForge")
  │   ANGLE 3: Product quality ("Premium streetwear, scripture-inspired")
  │   ANGLE 4: Urgency/scarcity ("Limited drop — once they're gone, they're gone")
  │   ANGLE 5: UGC-style ("POV: you just found the brand that gets you")
  │
  ├── Copy Agent produces per angle:
  │   - 3 headline variations
  │   - 3 body copy variations
  │   - 3 CTA variations
  │   = 27 unique text combinations per angle
  │
  ├── Design Agent + Video Agent produce:
  │   - 3 image ads per angle (Nano Banana 2 for speed)
  │   - 2 video ads per angle (Kling 3.0 for UGC-style, Runway for product)
  │   - 1 carousel per angle
  │   = 30 creative assets across 5 angles
  │
  ├── Brand Agent reviews all creative
  │   - Reject off-brand pieces
  │   - Approve 20-40 final creative assets
  │
  └── Ads Agent pairs creative + copy into ad units
      → 50-100+ unique ad combinations ready for testing

STEP 5: TRACKING SETUP (Web Agent + Analytics Agent)
  │
  ├── Meta Pixel installed on website (client-side):
  │   Events: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase
  │
  ├── Meta Conversions API (server-side):
  │   - Implemented in Next.js API routes
  │   - Fires on: Purchase, AddToCart, InitiateCheckout
  │   - Deduplicates with Pixel events via event_id
  │   - Sends: event name, event time, user data (hashed email, phone), custom data (value, currency, content_ids)
  │   - This captures the 30-40% of conversions that Pixel misses
  │
  ├── TikTok Pixel installed (if TikTok campaigns active)
  │
  ├── UTM parameters defined:
  │   utm_source: meta | tiktok
  │   utm_medium: paid
  │   utm_campaign: {campaign_name}
  │   utm_content: {ad_name}
  │   → Enables revenue attribution per ad
  │
  └── Conversion value tracking:
      - Every purchase event includes order value
      - Meta and TikTok optimize toward highest-value conversions
      - ROAS calculated from actual revenue, not estimated

STEP 6: GATE 3 REVIEW (You)
  │
  Dashboard shows each campaign with:
  - Campaign name and objective
  - Daily budget
  - Audience description
  - All creative previews (swipeable gallery)
  - Total monthly cost estimate
  │
  You approve/reject each campaign individually.
  Approved campaigns activate. Rejected get feedback for revision.
```

## Phase B: Testing & Learning (First 2 Weeks Post-Activation)

```
THE TESTING FRAMEWORK:

Week 1: LEARNING PHASE (don't touch anything)
  │
  ├── Meta's algorithm is learning who responds to your ads
  ├── Let each ad run with enough impressions to be statistically significant
  ├── Minimum: 1,000 impressions per ad before judging
  ├── Do NOT pause ads early based on gut feeling
  ├── Do NOT increase budgets during learning phase
  │
  ├── Ads Agent monitors daily but does NOT optimize:
  │   - Tracks: impressions, clicks, CTR, cost per click, conversions, ROAS
  │   - Identifies early signals (which ads are getting clicks, which aren't)
  │   - Reports to Floor Manager
  │
  └── Finance Agent tracks: daily spend vs. budget, cost per conversion trend

Week 2: FIRST OPTIMIZATION (data-driven decisions)
  │
  ├── Ads Agent analyzes 7 days of data:
  │
  │   FOR EACH AD:
  │   ├── CTR > 1%? → healthy interest signal
  │   ├── CTR < 0.5% for 7 days? → creative isn't resonating → PAUSE
  │   ├── Conversions > 0? → this ad is working
  │   ├── ROAS > target (3x)? → WINNER → increase budget 20%
  │   ├── ROAS 1-3x? → POTENTIAL → keep running, monitor
  │   ├── ROAS < 1x for 7 days? → LOSING MONEY → PAUSE
  │   └── High CTR but low conversion? → landing page issue, not ad issue
  │
  │   FOR EACH AD SET:
  │   ├── Which audience segment converts best?
  │   ├── Which audience has lowest CPA?
  │   ├── Shift budget toward best-performing ad sets
  │   └── If an ad set has no conversions after $50 spend → PAUSE
  │
  │   FOR EACH CREATIVE ANGLE:
  │   ├── Which angle produces best ROAS?
  │   ├── Which angle produces most clicks?
  │   ├── Double down on winning angles
  │   └── Retire losing angles, replace with new tests
  │
  └── FIRST OPTIMIZATION REPORT to you:
      "FaithForge Ads — Week 1 Results:
       Spend: $350 | Revenue: $980 | ROAS: 2.8x
       
       Winners: UGC-style video + Broad audience = 4.2x ROAS
       Losers: Carousel + Stacked interest = 0.8x ROAS (paused)
       
       Action taken: Paused 3 losing ads, increased budget 20% on top performer.
       Next week: Testing 3 new headlines on winning creative format."
```

## Phase C: Ongoing Optimization (Continuous Post-Testing)

**Runs daily via Lobster pipeline: `ad-optimization.lobster`**

```
DAILY OPTIMIZATION LOOP (Ads Agent):

  1. COLLECT (Analytics Agent pulls data)
     │
     ├── Per campaign: spend, impressions, reach, frequency
     ├── Per ad set: spend, conversions, CPA, ROAS
     ├── Per ad: CTR, conversion rate, cost per click, ROAS
     ├── Cross-reference with Stripe revenue (Finance Agent verifies)
     └── Time: runs at midnight, data from previous 24 hours

  2. ANALYZE (Ads Agent evaluates)
     │
     ├── WINNERS (ROAS > target):
     │   → Eligible for budget increase (20% max per day)
     │   → Duplicate winning ad sets with slight audience variations
     │   → Create new ads using winning creative elements
     │
     ├── PERFORMERS (ROAS 1x-3x):
     │   → Keep running, monitor trend
     │   → If improving → leave alone
     │   → If declining → investigate (creative fatigue? audience saturation?)
     │
     ├── LOSERS (ROAS < 1x for 3+ days):
     │   → PAUSE automatically
     │   → Log reason in Winners Hub (what didn't work and why)
     │
     └── FATIGUE SIGNALS:
         ├── CTR declining 3+ consecutive days → creative fatigue
         ├── Frequency > 3.0 → audience seeing ads too often
         ├── CPA increasing while traffic stable → diminishing returns
         └── When detected → trigger creative refresh (back to Phase A Step 4)

  3. OPTIMIZE (Ads Agent executes within rules)
     │
     ├── AUTOMATIC (no approval needed):
     │   - Shift budget between ad sets within a campaign
     │   - Increase winning campaign budget by up to 20%/day
     │   - Pause individual ads below 1.0x ROAS for 3+ days
     │   - Create new ad variations using approved creative + copy
     │   - Duplicate winning ad sets with adjusted targeting
     │
     ├── NEEDS YOUR APPROVAL:
     │   - Increase total daily spend beyond approved cap
     │   - Launch entirely new campaign (new objective or audience)
     │   - Add a new ad platform
     │   - Increase floor's total ad budget
     │
     └── NEVER (Ads Agent cannot):
         - Spend above approved daily cap
         - Change Conversions API configuration
         - Modify the website or landing pages
         - Access customer payment data

  4. REPORT (daily summary to Floor Manager)
     │
     ├── Total spend today vs. budget
     ├── Revenue attributed to ads today
     ├── Blended ROAS across all campaigns
     ├── Top performing ad (creative + audience)
     ├── Any actions taken (paused, scaled, refreshed)
     ├── Any flags (budget approaching limit, ROAS declining, fatigue detected)
     └── Finance Agent verification: "Revenue confirmed via Stripe: $X"

  5. WEEKLY REPORT (to you via CEO Mode morning briefing)
     │
     ├── Total ad spend this week
     ├── Total ad-attributed revenue
     ├── Blended ROAS (target vs. actual)
     ├── Top 3 ads by ROAS (with creative preview)
     ├── Bottom 3 ads (paused, with reason)
     ├── Audience insights (which segments convert best)
     ├── Creative insights (which formats/angles perform best)
     ├── Budget recommendation (increase, maintain, or decrease)
     └── Winners Hub update (new winning elements documented)
```

---

# CREATIVE REFRESH CYCLE

Ad creative fatigues over time. The same people see the same ad and stop responding. The Ads Agent manages this proactively.

```
FATIGUE DETECTION:
  Ads Agent monitors three signals per ad:
  1. CTR declining 3+ consecutive days (people stop clicking)
  2. Frequency > 3.0 (average person has seen the ad 3+ times)
  3. Conversion rate dropping while impressions stay stable

REFRESH TRIGGER:
  When 2 of 3 fatigue signals detected on an ad:
  
  1. Ads Agent flags: "Creative fatigue on [ad name]. Request refresh."
  2. Content pipeline produces new creative:
     - Video Agent: 2 new video variations (same angle, new execution)
     - Design Agent: 3 new image variations
     - Copy Agent: 3 new headline/body combinations
  3. Brand Agent reviews new creative
  4. Ads Agent creates new ad units with fresh creative
  5. New ads launch alongside fatigued ones (A/B comparison)
  6. Once new ads prove performance (48-72 hours), fatigued ads pause

REFRESH CADENCE:
  Typical: every 2-4 weeks per ad (varies by audience size and budget)
  High-spend campaigns: may need weekly refreshes
  Small audiences: fatigue faster (less people to show to)
  Broad audiences: fatigue slower

COST OF REFRESH:
  Per cycle: $5-15 in creative production (images + video + copy)
  This is a small cost vs. the revenue lost from running fatigued ads
```

---

# THE WINNERS HUB

Every winning creative element gets documented for reuse across current and future floors.

```
WINNERS HUB STRUCTURE:
  /ads/winners-hub.json
  
  {
    "winning_creatives": [
      {
        "type": "video",
        "format": "UGC-style talking head",
        "hook": "POV: you just found the brand that gets you",
        "duration": "15s",
        "roas": 4.2,
        "cpa": "$12.30",
        "platform": "meta",
        "audience": "broad interest 18-35",
        "floor": "faithforge",
        "date_identified": "2026-05-15",
        "still_active": true
      }
    ],
    "winning_headlines": [
      {
        "text": "Faith meets streetwear. Finally.",
        "ctr": 2.1,
        "platform": "meta",
        "floor": "faithforge"
      }
    ],
    "winning_audiences": [
      {
        "type": "broad_interest",
        "targeting": "faith + streetwear + online shoppers, 18-35",
        "cpa": "$14.20",
        "roas": 3.8,
        "platform": "meta",
        "floor": "faithforge"
      }
    ],
    "losing_patterns": [
      {
        "pattern": "Carousel ads with 10+ slides on Meta",
        "reason": "CTR consistently below 0.5% across 3 tests",
        "recommendation": "Keep carousels to 5-6 slides max for ads"
      }
    ]
  }

CROSS-FLOOR APPLICATION:
  When a new floor launches ads, CEO Mode checks the Winners Hub:
  - "FaithForge's UGC-style video format produced 4.2x ROAS.
     Recommend testing this format on the new floor."
  - Strategy is adapted to the new floor's brand, not copied verbatim.
  - The format/approach transfers, the specific creative does not.
```

---

# SCALING RULES

```
SCALING PREREQUISITES (all must be true):
  □ ROAS above target (3x) for 14+ consecutive days
  □ Conversion rate stable or improving
  □ Net margin above 20% after all costs
  □ No fulfillment bottlenecks
  □ Content pipeline can sustain creative refresh rate

SCALING EXECUTION:
  Week 1-2: Observe baseline (don't change anything)
  Week 3: If all prerequisites met → increase budget 20%
  Week 4: If ROAS maintained → increase another 20%
  Week 5+: Continue 20% weekly as long as ROAS holds

  MAXIMUM single-day budget increase: 20%
  (Meta's algorithm resets learning phase if you increase more)

SCALING PAUSE TRIGGERS:
  - ROAS drops 15%+ from baseline → pause scaling for 7 days
  - CPA exceeds LTV → stop immediately, investigate
  - Frequency above 4.0 across all campaigns → audience saturation
  
  When paused: Ads Agent diagnoses root cause:
  - Creative fatigue? → refresh creative
  - Audience saturation? → expand targeting or add lookalikes
  - Market change? → re-evaluate strategy
  - Seasonal effect? → adjust expectations
  
  Resume scaling only after root cause addressed and metrics recover.

HORIZONTAL SCALING (adding platforms):
  After Meta campaigns stable for 30+ days:
  - Test TikTok ads (if not already running)
  - Test Google Shopping (for search-intent buyers)
  - Each new platform starts with small budget ($10-15/day)
  - Same testing framework: 2-week learning, then optimize
```

---

# META ADS API IMPLEMENTATION

```
CAMPAIGN CREATION (using unified Advantage+ structure, API v25.0+):

  // Step 1: Create Campaign
  POST /act_{AD_ACCOUNT_ID}/campaigns
  {
    "name": "FaithForge - Prospecting Broad",
    "objective": "OUTCOME_SALES",
    "special_ad_categories": [],
    "status": "PAUSED",  // Always create paused
    "buying_type": "AUCTION",
    // Advantage+ settings
    "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
    "daily_budget": 2500,  // in cents ($25)
    "is_budget_schedule_enabled": false
  }

  // Step 2: Create Ad Set
  POST /act_{AD_ACCOUNT_ID}/adsets
  {
    "name": "Broad Interest 18-35",
    "campaign_id": "{campaign_id}",
    "billing_event": "IMPRESSIONS",
    "optimization_goal": "OFFSITE_CONVERSIONS",
    "promoted_object": { "pixel_id": "{pixel_id}", "custom_event_type": "PURCHASE" },
    "targeting": {
      "age_min": 18,
      "age_max": 35,
      "genders": [0],  // All
      "geo_locations": { "countries": ["US"] },
      "flexible_spec": [{
        "interests": [
          { "id": "...", "name": "Christian faith" },
          { "id": "...", "name": "Streetwear" }
        ]
      }],
      "publisher_platforms": ["facebook", "instagram"],
      "facebook_positions": ["feed", "reels"],
      "instagram_positions": ["stream", "reels", "explore"]
    },
    "status": "PAUSED"
  }

  // Step 3: Upload Creative
  POST /act_{AD_ACCOUNT_ID}/advideos  (for video)
  POST /act_{AD_ACCOUNT_ID}/adimages  (for images)

  // Step 4: Create Ad Creative
  POST /act_{AD_ACCOUNT_ID}/adcreatives
  {
    "name": "UGC Video - Faith meets streetwear",
    "object_story_spec": {
      "page_id": "{page_id}",
      "video_data": {
        "video_id": "{video_id}",
        "message": "Faith meets streetwear. Finally. 🙏\n\nShop the collection → link in bio",
        "call_to_action": { "type": "SHOP_NOW", "value": { "link": "https://faithforge.com" } }
      }
    }
  }

  // Step 5: Create Ad
  POST /act_{AD_ACCOUNT_ID}/ads
  {
    "name": "UGC Video A - Headline 1 - Broad",
    "adset_id": "{adset_id}",
    "creative": { "creative_id": "{creative_id}" },
    "status": "PAUSED",
    "tracking_specs": [{ "action.type": ["offsite_conversion"], "fb_pixel": ["{pixel_id}"] }]
  }

CONVERSIONS API (server-side tracking):

  // Fires from Next.js API route on purchase event
  POST https://graph.facebook.com/v25.0/{PIXEL_ID}/events
  {
    "data": [{
      "event_name": "Purchase",
      "event_time": 1234567890,
      "event_id": "unique-event-id-123",  // For deduplication with Pixel
      "action_source": "website",
      "event_source_url": "https://faithforge.com/checkout/success",
      "user_data": {
        "em": ["{hashed_email}"],     // SHA256 hashed
        "ph": ["{hashed_phone}"],     // SHA256 hashed
        "client_ip_address": "...",
        "client_user_agent": "...",
        "fbc": "{click_id}",          // From _fbc cookie
        "fbp": "{browser_id}"         // From _fbp cookie
      },
      "custom_data": {
        "value": 45.00,
        "currency": "USD",
        "content_ids": ["product-123"],
        "content_type": "product",
        "order_id": "order-456"
      }
    }],
    "access_token": "{access_token}"
  }

PERFORMANCE DATA RETRIEVAL:

  // Daily pull — Analytics Agent retrieves
  GET /act_{AD_ACCOUNT_ID}/insights
  ?fields=campaign_name,adset_name,ad_name,spend,impressions,
          clicks,ctr,cpc,actions,cost_per_action_type,
          purchase_roas,frequency
  &time_range={"since":"2026-05-14","until":"2026-05-14"}
  &level=ad
  &filtering=[{"field":"ad.effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]

  // Parse purchase conversions and ROAS from the response
  // Cross-reference with Stripe revenue data for verification
```

---

# TIKTOK ADS IMPLEMENTATION

```
CAMPAIGN CREATION (TikTok Marketing API):

  // Step 1: Create Campaign
  POST /open_api/v1.3/campaign/create/
  {
    "advertiser_id": "{advertiser_id}",
    "campaign_name": "FaithForge - TikTok Prospecting",
    "objective_type": "PRODUCT_SALES",
    "budget_mode": "BUDGET_MODE_DAY",
    "budget": 1000,  // in cents ($10)
    "operation_status": "DISABLE"  // Create paused
  }

  // Step 2: Create Ad Group
  POST /open_api/v1.3/adgroup/create/
  {
    "advertiser_id": "{advertiser_id}",
    "campaign_id": "{campaign_id}",
    "adgroup_name": "Streetwear Faith 18-30",
    "placement_type": "PLACEMENT_TYPE_NORMAL",
    "placements": ["PLACEMENT_TIKTOK"],
    "optimization_goal": "CONVERT",
    "billing_event": "CPC",
    "bid_type": "BID_TYPE_NO_BID",  // Lowest cost
    "budget_mode": "BUDGET_MODE_DAY",
    "budget": 1000,
    "audience_type": "INTEREST_KEYWORDS",
    "interest_keyword_ids": [...],
    "age_groups": ["AGE_18_24", "AGE_25_34"],
    "gender": "GENDER_UNLIMITED",
    "location_ids": [...]
  }

  // Step 3: Upload creative + create ad
  // Similar flow to Meta but with TikTok-specific parameters

SPARK ADS (boosting organic posts):
  When an organic TikTok post performs 2x+ above average:
  1. Social Media Agent flags it to Ads Agent
  2. Ads Agent creates a Spark Ad (uses the organic post as ad creative)
  3. Small budget ($5-15/day) to amplify
  4. Preserves all organic engagement (likes, comments, shares)
  5. Most cost-effective ad format on TikTok
```

---

# BUDGET MANAGEMENT

```
BUDGET HIERARCHY:
  Floor total ad budget (approved by you at floor creation)
  └── Daily cap (floor budget / 30)
      └── Per-campaign allocation (Ads Agent distributes)
          └── Per-ad-set allocation (Meta CBO distributes)

EXAMPLE — FaithForge:
  Floor ad budget: $1,500/month
  Daily cap: $50/day
  Campaign allocation:
    Prospecting (Meta): $25/day
    Retargeting (Meta): $15/day
    TikTok: $10/day

BUDGET RULES:
  - Ads Agent cannot exceed daily cap without your approval
  - Within daily cap: Ads Agent can reallocate between campaigns
  - Scaling increases require your approval (push notification)
  - Finance Agent verifies all spend daily against Stripe revenue
  - If ROAS drops below 1.0x for 5+ days across all campaigns:
    → Auto-pause all ads
    → Floor Manager notifies you: "Ads paused — losing money. Review needed."

COST TRACKING:
  Every ad dollar is tracked:
  - Ad spend (from platform reporting API)
  - Creative production cost (from EVE's cost tracker)
  - Revenue attributed (from Stripe + platform attribution)
  - ROAS = revenue / (ad spend + creative cost)
  - Net profit = revenue - COGS - ad spend - creative cost - platform fees
```

---

# ERROR SCENARIOS

```
"ADS AREN'T CONVERTING"
  Ads Agent diagnosis flow:
  1. Is the creative getting clicks? (CTR check)
     - Low CTR → creative problem → refresh creative
     - Good CTR → landing page problem → check conversion rate on site
  2. Are people adding to cart? (funnel check)
     - No add-to-carts → product/price problem
     - Add-to-carts but no purchases → checkout friction
  3. Is tracking working? (CAPI check)
     - Verify Conversions API is firing
     - Verify Pixel events matching server events
     - Deduplication working correctly?
  4. Is the audience right? (targeting check)
     - Too broad? → narrow with interest stacking
     - Too narrow? → expand or test new segments

"AD ACCOUNT RESTRICTED"
  Meta may restrict accounts for policy violations:
  - Floor Manager notifies you immediately
  - Ads Agent reviews which ad triggered the restriction
  - Remove violating content
  - Submit appeal through Meta Business Help Center
  - This requires your action — agents cannot appeal account restrictions

"BUDGET OVERSPEND"
  Meta can occasionally overspend daily budgets by up to 25%:
  - Finance Agent detects and logs the overspend
  - Not actionable (Meta policy allows this)
  - Averaged out over the month, spending stays within budget
  - If consistently overspending → reduce daily cap by 10% as buffer
```
