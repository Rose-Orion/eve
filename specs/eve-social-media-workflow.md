# EVE — Social Media Workflow
## The Complete Content-to-Conversion Pipeline

---

# CRITICAL PLATFORM RULES (2026)

**What's allowed (official APIs):**
- Publishing posts, Reels, Stories, carousels via Meta Graph API ✅
- Publishing videos to TikTok via Content Posting API ✅
- Scheduling posts for future publishing ✅
- Reading comments and DMs via API ✅
- Replying to comments via API ✅
- Pulling analytics/insights via API ✅

**What will get you banned:**
- Engagement automation (auto-likes, auto-follows, auto-comments via bots) ❌
- Unnatural posting patterns (exact intervals like every 6 hours on the dot) ❌
- Bulk actions through unofficial endpoints ❌
- Third-party login sharing (giving passwords to tools) ❌

**EVE's approach:** All publishing and engagement uses official APIs only. The Social Media Agent responds to comments in real-time but through API endpoints, not browser automation. Posting times are varied slightly (±5-15 min randomization) to avoid pattern detection.

---

# THE API LAYER

## Instagram + Facebook (Meta Graph API)

```
REQUIRED SETUP:
  - Instagram Business Account (connected to Facebook Page)
  - Meta Developer App with permissions:
    instagram_basic
    instagram_content_publish
    instagram_manage_comments
    instagram_manage_insights
    pages_show_list
    pages_manage_posts
  - Long-lived access token (60-day lifespan, auto-refresh)
  - Page Publishing Authorization (PPA) completed

PUBLISHING FLOW:
  1. Upload media to publicly accessible URL (Vercel/CDN)
  2. Create media container:
     POST /{IG_ACCOUNT_ID}/media
     - media_type: IMAGE | VIDEO | REELS | CAROUSEL_ALBUM | STORIES
     - image_url or video_url
     - caption (with hashtags)
  3. Wait for processing (poll status for video/reels)
  4. Publish:
     POST /{IG_ACCOUNT_ID}/media_publish
     - creation_id: {container_id}
  5. Confirm published, log post_id

SUPPORTED CONTENT TYPES:
  - Feed images (1:1, 4:5, 1.91:1)
  - Carousels (2-10 images or videos)
  - Reels (9:16 video, up to 15 min)
  - Stories (9:16, images or video up to 60s)

ENGAGEMENT:
  - Read comments: GET /{MEDIA_ID}/comments
  - Reply to comments: POST /{COMMENT_ID}/replies
  - Read DMs: via Instagram Messaging API (separate permission)
  - Reply to DMs: POST to conversation thread
  - Read insights: GET /{MEDIA_ID}/insights (reach, impressions, engagement)
```

## TikTok (Content Posting API)

```
REQUIRED SETUP:
  - TikTok Developer App (Business type)
  - Content Posting API product enabled
  - video.publish scope approved
  - App audit passed (required for public visibility)
  - OAuth 2.0 user authorization flow completed
  - Verified domain for PULL_FROM_URL uploads

PUBLISHING FLOW (Direct Post):
  1. Query creator info:
     POST /v2/post/publish/creator_info/query/
     - Get privacy options, max duration, permissions
  2. Initialize upload:
     POST /v2/post/publish/video/init/
     - source: PULL_FROM_URL (easiest — video hosted on our CDN)
     - video_url: https://cdn.faithforge.com/content/video-123.mp4
     - post_info: { title, privacy_level, disable_comment, disable_duet }
  3. Check publish status:
     POST /v2/post/publish/status/fetch/
     - Poll until status = PUBLISH_COMPLETE
  4. Log post_id

RATE LIMITS:
  - 6 requests per minute per user access token
  - Unaudited apps: content restricted to private visibility
  - Must pass TikTok audit for public posts

CONTENT TYPES:
  - Video (MP4 + H.264, up to 10 min)
  - Photos (new in 2026)
  - Carousels/slideshows
```

## Unified API Option (Late.dev or similar)

```
ALTERNATIVE APPROACH:
  Instead of managing Meta Graph API + TikTok API separately,
  use a unified API that handles all platforms through one endpoint.

  Late.dev supports 13 platforms including:
  Instagram, TikTok, Facebook, YouTube, LinkedIn, Twitter, Threads

  BENEFITS:
  - One API key, one integration
  - Handles OAuth, token refresh, rate limits internally
  - Media hosting included
  - Retry on failures
  - Same endpoint pattern for all platforms

  COST: Paid per post ($0.01-0.05/post depending on plan)

  TRADEOFF: Slightly less control vs. direct API,
  but dramatically simpler to build and maintain.

RECOMMENDATION FOR EVE:
  Start with Late.dev or similar unified API for v1 (faster to build).
  Move to direct Meta Graph API + TikTok API if we need features
  the unified API doesn't support (advanced targeting, specific metadata).
```

---

# THE FIVE-PHASE CONTENT LIFECYCLE

## Phase 1: Strategic Planning (Weekly — Social Media Agent)

**Runs every Monday morning via Lobster pipeline: `content-planning.lobster`**

```
INPUTS:
  ├── Trend Monitor data (from previous week's continuous monitoring)
  │   - Trending audio on TikTok (track IDs, usage counts, growth velocity)
  │   - Trending formats on Instagram (carousel styles, Reel transitions)
  │   - Trending hooks (what opening lines are stopping scrolls)
  │   - Competitor activity (posting frequency, engagement rates, new angles)
  │   - Niche trends (what's working in faith/streetwear specifically)
  │
  ├── Performance data (from Analytics Agent)
  │   - Last week's top 5 posts by conversion (not just likes)
  │   - Bottom 5 posts and why they underperformed
  │   - Best posting times by platform (from actual data)
  │   - Content type breakdown: which format drove most revenue
  │   - Engagement rate trend (improving, declining, stable)
  │   - Follower growth rate
  │
  └── Business calendar (from Floor Manager)
      - Upcoming promotions or launches
      - Seasonal relevance (holidays, events)
      - Product restocks or new arrivals
      - Any brand moments to capitalize on

PROCESS:
  Social Media Agent creates the weekly content calendar:
  
  1. REVIEW performance data → identify what's working
  2. SCAN trend data → identify opportunities to ride trends
  3. CHECK business calendar → align content with business goals
  4. DETERMINE content mix:
     - 40% value/educational (earns trust)
     - 25% entertainment/trend (earns reach)
     - 20% product/selling (earns revenue)
     - 15% community/engagement (earns loyalty)
  5. ASSIGN content to days + platforms
  6. WRITE content briefs for each piece:
     - Concept, goal, platform, format
     - Reference trend/audio if applicable
     - Hook direction
     - CTA type
  7. SUBMIT calendar to Brand Agent for creative direction review

OUTPUT:
  /content-queue/week-{date}-calendar.json
  Contains: 20-30 content briefs for the week, scheduled by day and platform
```

## Phase 2: Content Production (Daily — Parallel Agents)

**Runs daily via Lobster pipeline: `content-production.lobster`**

For each content piece in today's calendar:

```
STEP 1: CREATIVE BRIEF (Brand Agent — Opus)
  Brand Agent writes the visual/creative brief:
  - Visual mood, style, pacing
  - Brand guardrails for this piece
  - Reference inspiration (trend format, specific look)
  - Quality bar expectations

STEP 2: PARALLEL PRODUCTION
  Three agents work simultaneously on this single piece:

  COPY AGENT (Sonnet):
    - Writes caption with hook → value → CTA structure
    - Writes text overlays (if video/carousel)
    - Researches and selects 15-20 hashtags (mix of reach + niche)
    - Writes video script (if video content)
    - Adapts voice per platform:
      * TikTok: casual, first-person, conversational
      * Instagram: aspirational, polished but real
      * Facebook: warm, community-oriented, slightly longer

  DESIGN AGENT (Opus):
    - Generates images/graphics (model routed per content type):
      * Feed post → Nano Banana 2 (speed) or Midjourney (hero quality)
      * Carousel slides → Nano Banana 2 with brand template
      * Thumbnails → 3 variations per video
      * Product mockups → Flux 2 Max
    - Applies brand template (colors, typography, layout)
    - Creates 3 variations for A/B selection

  VIDEO AGENT (Opus) — if video content:
    - Path A (product/hero): Key frames → generation → post-production
    - Path B (social/trend): Direct generation → light edit
    - Model selection per content type:
      * Product showcase: Runway Gen-4.5
      * Trend/social: Kling 3.0
      * Brand story: Veo 3.1
    - Post-production: color grade, audio, captions, platform formatting
    - Hook optimization: first 1 second gets special attention

STEP 3: REVIEW (Brand Agent — Opus)
  Brand Agent reviews all produced content:
  ├── Does it match the brand? (colors, mood, voice)
  ├── Is the quality top 1%? (composition, polish, professionalism)
  ├── Is the hook strong enough to stop a scroll?
  ├── Are captions on-brand and platform-appropriate?
  ├── Is the CTA clear but not aggressive?
  │
  ├── APPROVED → enters publishing queue
  └── REJECTED → specific feedback → agents revise (max 3 rounds)

STEP 4: QUEUE
  Approved content enters the publishing queue with:
  - Final media file (image/video)
  - Caption with hashtags
  - Platform target (Instagram Reel, TikTok, Facebook, etc.)
  - Scheduled time (from Analytics Agent's optimal posting data)
  - Thumbnail (for video)
  - Product tags (if applicable)
  - Cross-posting adaptations (same content, different format/caption per platform)
```

## Phase 3: Publishing (Automated — Social Media Agent)

**Event-driven via Lobster pipeline: `content-publish.lobster`**

```
AT SCHEDULED TIME (±5-15 min randomization to avoid pattern detection):

  1. UPLOAD media to CDN (publicly accessible URL)
  
  2. PUBLISH via platform API:
  
     INSTAGRAM (Meta Graph API):
       a. Create media container (type: REELS/IMAGE/CAROUSEL)
       b. Attach caption, hashtags, location tag
       c. Wait for processing (poll status for video)
       d. Publish container
       e. Confirm post is live
       f. Log post_id, timestamp, platform
     
     TIKTOK (Content Posting API):
       a. Query creator info (privacy options, max duration)
       b. Initialize video upload (PULL_FROM_URL)
       c. Set caption, hashtags, privacy level
       d. Poll status until PUBLISH_COMPLETE
       e. Log post_id, timestamp, platform
     
     FACEBOOK (Meta Graph API):
       a. Create post on Page (photo/video/link)
       b. Attach caption, link, tags
       c. Confirm published
       d. Log post_id, timestamp, platform
  
  3. NOTIFY Social Media Agent: "New post live — active engagement window"
  
  4. START TRACKING: Analytics Agent begins monitoring metrics

  ERROR HANDLING:
    - Upload fails → retry 3x with exponential backoff
    - API error → log error, notify Floor Manager
    - Rate limited → wait and retry after cooldown
    - Processing stuck → timeout after 10 min, retry with re-upload
```

## Phase 4: Engagement (Real-Time — Social Media Agent)

**Event-driven via webhooks + heartbeat monitoring**

```
FIRST 60 MINUTES AFTER POST (critical algorithm window):
  │
  ├── Social Media Agent monitors all incoming comments
  │   - Poll comments endpoint every 2 minutes during critical window
  │   - Or use webhooks if configured (Meta supports real-time updates)
  │
  ├── TRIAGE each comment:
  │   ├── PURCHASE INTENT ("How much?", "Do you ship to...", "What size?")
  │   │   → PRIORITY RESPONSE in brand voice
  │   │   → Include product link or answer
  │   │   → Track as warm lead
  │   │
  │   ├── POSITIVE FEEDBACK ("Love this!", "Fire 🔥", "Need this")
  │   │   → Respond with gratitude + engagement question
  │   │   → "Thank you! Which colorway would you rock? 🙏"
  │   │
  │   ├── GENUINE QUESTION ("Is this true to size?", "What material?")
  │   │   → Answer accurately from product data
  │   │   → Friendly, helpful, conversational
  │   │
  │   ├── GENERAL ENGAGEMENT (tags friends, emojis, generic)
  │   │   → Brief, warm acknowledgment
  │   │   → Extend with a follow-up question when natural
  │   │
  │   ├── COMPLAINT ("Bad quality", "Never arrived", refund request)
  │   │   → Acknowledge immediately in public reply
  │   │   → "So sorry about this! Can you DM us? We'll fix it right away 🙏"
  │   │   → Escalate to Floor Manager → push notification to you
  │   │
  │   ├── SPAM / BOT
  │   │   → Ignore (don't engage)
  │   │   → If persistent, hide/report via API
  │   │
  │   └── COMPETITOR / NEGATIVE
  │       → If genuine criticism → acknowledge gracefully
  │       → If trolling → ignore
  │       → If harmful → hide via API, log for review
  │
  ├── DM MONITORING (continuous, not just post-launch window):
  │   ├── Product questions → answer + product link
  │   ├── Purchase intent → guide to checkout, offer discount code if appropriate
  │   ├── Support issues → route to support flow or escalate
  │   ├── Warm leads → follow up if no conversion in 24h
  │   └── Collaboration requests → forward to Floor Manager
  │
  └── RESPONSE RULES:
      - Always in brand voice (loaded from Foundation Package)
      - Response time target: under 30 minutes
      - Never argue. Never make promises you can't keep.
      - Never disclose internal business info (margins, strategies, suppliers)
      - Never use engagement automation (auto-likes, auto-follows)
      - Responses must feel genuine and human, not templated
      - Use the customer's name when they use theirs
      - One emoji per response max (unless brand voice is emoji-heavy)

IMPORTANT: Instagram enforcement is strict in 2026.
  - Publishing automation = ALLOWED (official API)
  - Comment responses via API = ALLOWED
  - Auto-likes via bot = BANNED (will get account flagged)
  - Auto-follows via bot = BANNED
  - Bulk commenting via bot = BANNED
  
  EVE only uses official API endpoints. The Social Media Agent responds
  to comments by composing responses and posting via the comments API,
  not through browser automation or unofficial endpoints.
```

## Phase 5: Performance Tracking & Optimization (Continuous — Analytics Agent)

```
REAL-TIME TRACKING (per post):
  │
  ├── 1 HOUR: views, initial engagement rate, saves
  │   → If performing 2x above average: flag to Ads Agent for potential boost
  │   → If performing below average: note for post-mortem
  │
  ├── 24 HOURS: full engagement picture
  │   Metrics tracked:
  │   - Views / reach
  │   - Engagement rate (likes + comments + shares + saves / reach)
  │   - Save rate (strongest signal of valuable content)
  │   - Share rate (strongest signal of viral potential)
  │   - Comment sentiment (positive/negative/neutral)
  │   - Click-through rate (to website via link in bio / swipe up)
  │   - Profile visits generated
  │
  ├── 48 HOURS: conversion attribution
  │   - Who saw the post → who visited the site → who purchased
  │   - Tracked via UTM parameters in bio link + Meta Pixel
  │   - Revenue attributed to this specific post
  │
  ├── 7 DAYS: long-tail performance
  │   - Some content (especially carousels and educational Reels) performs
  │     for days or weeks via algorithm distribution
  │   - Track continued views and conversions
  │
  └── WEEKLY ROLLUP:
      - Top 5 posts by CONVERSION (revenue generated, not vanity metrics)
      - Bottom 5 posts and analysis of why
      - Content type performance:
        Which format drives most revenue? Most engagement? Most reach?
      - Platform performance: 
        Which platform has highest ROI?
      - Posting time performance:
        Which times drive best engagement by platform?
      - Follower growth: net new followers, growth rate
      - Community health: response time, engagement rate trend
      
      → Feeds directly into next week's Phase 1 planning

BOOST DECISION (Ads Agent integration):
  When a post performs 2x+ above average organically:
  1. Social Media Agent flags it to Ads Agent
  2. Ads Agent evaluates: does it align with an active campaign?
  3. If yes → boost as Spark Ad (TikTok) or boost post (Instagram)
  4. Small budget ($5-15) to amplify organic winner
  5. Track boosted performance separately from organic
```

---

# PLATFORM-SPECIFIC PRODUCTION SPECS

## Instagram

```
REELS (primary reach driver):
  Format: 9:16 vertical, 1080x1920px
  Duration: 7-15 seconds optimal (up to 90s for storytelling)
  Audio: trending audio when relevant, brand music otherwise
  Captions: always on, styled to brand (font, color, position)
  Hook: first 1 second must stop scroll
  Post frequency: 1/day minimum
  Optimal times: from Analytics Agent data (start with 11am, 2pm, 7pm CT)

CAROUSELS (highest save rate):
  Format: 1:1 (1080x1080) or 4:5 (1080x1350)
  Slides: 7-10
  Slide 1: hook/curiosity (determines if they swipe)
  Slides 2-9: value delivery
  Slide 10: CTA + follow prompt
  Template: consistent brand template per floor
  Post frequency: 3/week
  Best for: educational content, product comparisons, listicles

STORIES (engagement driver):
  Format: 9:16, 1080x1920px
  Type: casual, behind-the-scenes, polls, questions, urgency
  Duration: 3-5 per day
  Interactive: use polls, quizzes, countdowns, question stickers
  Less polished than feed — authenticity matters more

FEED POSTS (brand credibility):
  Format: 1:1 or 4:5
  Quality: high, on-brand, gallery-worthy
  Caption: longer, value-rich
  Frequency: 2/week
```

## TikTok

```
VIDEOS:
  Format: 9:16 vertical, 1080x1920px
  Duration: 15-30 seconds optimal (up to 10 min for deep content)
  Style: native, raw, NOT polished brand ads
  Hook: 1 second. Text hook or visual hook.
  Audio: trending audio AGGRESSIVELY — drives discovery
  Captions: always on, follow trending caption styles
  Pattern interrupts: zoom, cut, transition every 2-3 seconds
  Post frequency: 1-2/day
  Optimal times: from Analytics Agent data

TREND ADAPTATION:
  When Social Media Agent identifies a trending format:
  1. Analyze the trend structure (what makes it work)
  2. Adapt to floor's brand and products (don't force-fit)
  3. Produce within 24-48 hours (trends are time-sensitive)
  4. Use the trending audio if applicable
  5. Path B production (speed over perfection)

TIKTOK-SPECIFIC RULES:
  - Content must feel native to TikTok (not repurposed Instagram content)
  - The "ad" should never feel like an ad
  - UGC-style performs best
  - Educational content ("3 things you didn't know about...") performs well
  - Storytelling format ("POV:", "Wait for it...") drives watch time
```

## Facebook

```
POSTS:
  Format: varies (1:1, 16:9, text-only, link shares)
  Style: longer storytelling, community-oriented
  Audience: 35+ demographic skews here
  Best for: retargeting (Meta Pixel audience), community building
  Frequency: 1/day
  Video: 16:9 or 1:1, 30-60 seconds
  
FACEBOOK-SPECIFIC STRENGTHS:
  - Best platform for retargeting warm audiences
  - Longer captions perform well (unlike TikTok)
  - Community engagement through comments is strong
  - Event and promotion content works well
  - Link shares drive website traffic (Instagram doesn't support link posts)
```

---

# CROSS-POSTING STRATEGY

Not every piece of content goes on every platform. The Social Media Agent routes based on content type and platform fit:

```
ROUTING MATRIX:

Content Type          → Instagram    TikTok    Facebook
──────────────────────────────────────────────────────
Product showcase Reel → ✅ Reel      ✅ Video   ✅ Video
Trend-based video     → ✅ Reel      ✅ Video   ❌ Skip
Educational carousel  → ✅ Carousel  ❌ Skip    ✅ Image set
Behind-the-scenes     → ✅ Story     ✅ Video   ✅ Story
Product launch        → ✅ All types ✅ Video   ✅ Post + link
Customer testimonial  → ✅ Reel      ✅ Video   ✅ Post
Community question    → ✅ Story     ❌ Skip    ✅ Post
Promotional offer     → ✅ Story+Feed ✅ Video  ✅ Post + link
UGC-style review      → ✅ Reel      ✅ Video   ✅ Video

CROSS-POSTING RULES:
  - NEVER post identical content across platforms
  - Same concept → different execution per platform
  - TikTok version: rawer, trending audio, native feel
  - Instagram version: polished, brand music, aspirational
  - Facebook version: longer caption, link to website, community angle
  - Captions are rewritten per platform, not copy-pasted
  - Hashtags are researched per platform (different algorithms)
```

---

# CONTENT PRODUCTION VOLUME + COST

## Weekly Production Target (per floor)

```
INSTAGRAM:
  7 Reels (1/day)                    → 7 videos (Path B: ~$0.50-1.00 each)
  3 Carousels (10 slides each)       → 30 images (~$0.05-0.10 each)
  14 Stories (2/day)                  → mix of images + short video
  2 Feed posts                       → 2 high-quality images (~$0.10-0.20 each)

TIKTOK:
  7-14 Videos (1-2/day)              → 7-14 videos (Path B: ~$0.30-1.00 each)

FACEBOOK:
  7 Posts (1/day)                    → mix of video + image + text
  7 Stories (1/day)                  → repurposed from Instagram

TOTAL WEEKLY PRODUCTION:
  ~15-25 video pieces
  ~35-45 image pieces
  ~25-35 unique captions + hashtag sets

ESTIMATED WEEKLY COST:
  Video generation: $10-25
  Image generation: $3-8
  Audio (voiceover): $1-3
  Agent API costs (Social Media Agent operations): $15-30
  TOTAL: $29-66/week = $120-265/month in content production
```

## Sub-Agent Batch Production

For high-volume weeks, the Social Media Agent spawns Haiku sub-agents:

```
BATCH VIDEO PRODUCTION:
  Social Media Agent writes all 7 TikTok briefs
  → Spawns 3 sub-agents (Haiku)
  → Each handles 2-3 videos:
    - Calls Kling 3.0 API with the brief
    - Generates 3 variations
    - Returns all to parent
  → Social Media Agent (or Video Agent) reviews all
  → Best variations go to post-production
  
  Time: 30 minutes for 7 videos (parallel) vs. 3.5 hours (sequential)
  Cost: ~$0.15 per sub-agent task vs. ~$0.45 if Social Media Agent did it on Sonnet

BATCH CAPTION WRITING:
  Social Media Agent writes all briefs
  → Spawns 2 sub-agents (Haiku)
  → Each writes 5-7 captions with hashtags
  → Social Media Agent reviews for brand voice
  → Approved captions queued with their content
```

---

# COMMUNITY MANAGEMENT RULES

```
RESPONSE PRIORITY (in order):
  1. Purchase intent DMs/comments → respond within 15 minutes
  2. Complaints/negative → acknowledge within 30 minutes
  3. Product questions → respond within 1 hour
  4. Positive feedback → respond within 2 hours
  5. General engagement → respond within 4 hours
  6. Older posts → respond within 24 hours

ESCALATION TRIGGERS (push notification to you):
  - Complaint mentioning legal action
  - Request for refund over $100
  - Viral negative comment (10+ replies)
  - Potential PR issue
  - Message from influencer or press

WHAT THE SOCIAL MEDIA AGENT NEVER DOES:
  - Argue with anyone
  - Make promises it can't keep ("we'll send you a free one")
  - Disclose business info (margins, revenue, supplier names)
  - Delete negative comments (unless spam/harassment)
  - Use automation for likes, follows, or mass comments
  - Post without Brand Agent review
  - Respond to DMs with anything financial (discounts, refunds) without Floor Manager approval
```

---

# TREND MONITORING WORKFLOW

```
CONTINUOUS MONITORING (Social Media Agent — trend function):
  │
  ├── TikTok For You Page analysis
  │   - Track trending audio (usage count, velocity)
  │   - Track trending formats (transitions, hooks, structures)
  │   - Monitor hashtag challenges relevant to niche
  │
  ├── Instagram Explore analysis
  │   - Track Reel formats with high engagement
  │   - Monitor trending carousel styles
  │   - Track emerging visual trends (color grading, typography)
  │
  ├── Competitor monitoring
  │   - Track posting frequency of top 5 competitors
  │   - Identify their best-performing content
  │   - Note content gaps they're not covering
  │
  └── Niche trend analysis
      - What's happening in faith-based content?
      - What's happening in streetwear content?
      - What's the intersection nobody is covering?

TREND RESPONSE TIME:
  - Trending audio: produce content within 24 hours
  - Trending format: produce within 48 hours
  - Emerging niche trend: include in next week's calendar
  - Seasonal/event: plan 2 weeks ahead

TREND REPORT (delivered to weekly planning):
  - Top 5 trending audio tracks with usage stats
  - Top 3 trending formats with examples
  - Competitor activity highlights
  - Recommended trends to ride this week
  - Trends to avoid (off-brand, controversial, dying)
```
