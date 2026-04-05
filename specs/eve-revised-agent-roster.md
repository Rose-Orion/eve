# EVE — Revised Agent Roster (13 Agents)

## What Changed and Why

The original roster had 23 agents. This revision consolidates to 13 without losing any capabilities. The principle: if two agents are just passing work back and forth with no independent reasoning between them, they should be one agent. A separate agent is only justified when it needs its own persistent context, its own decision-making, and genuinely different expertise.

### Agents Merged

| Original Agents | Merged Into | Why |
|---|---|---|
| Video Agent + Video Generator + Video Editor | **Video Agent** | The generator just translated briefs into API calls (mechanical). The editor is a post-processing step, not independent creative work. One agent handles brief → generation → editing as a pipeline. |
| Design Agent + Image Generator Agent | **Design Agent** | Same logic. The image generator was a function call, not a thinker. Design Agent now generates its own images directly. |
| Social Media Agent + Community Agent + Trend Monitor | **Social Media Agent** | Content strategy, posting, engagement, trend monitoring, and community management are one continuous loop. Separating them created handoff overhead with no quality gain. |
| Product Agent + Pricing Agent | **Commerce Agent** | Product catalog and pricing are tightly coupled. You can't price without knowing the product. You can't source without knowing the price target. One agent handles the full product lifecycle. |
| Copy Agent + Customer Support Agent (copy duties) | **Copy Agent** | Support templates, FAQs, knowledge bases, and chatbot scripts are writing tasks. The Copy Agent already writes everything else — adding support copy is natural. |
| SEO Agent (absorbed into Copy + Web) | **Split across Copy Agent and Web Agent** | SEO is two things: content optimization (Copy Agent's job) and technical SEO (Web Agent's job). A dedicated SEO agent was doing work that naturally belongs to these two. |
| Email Agent (absorbed into Copy + Web) | **Split across Copy Agent and Web Agent** | Email copy is writing (Copy Agent). Email infrastructure, automation flows, and integrations are code (Web Agent). |

### What Stayed Separate and Why

| Agent | Why It Stays Separate |
|---|---|
| Floor Manager | Coordination role. Must never do production work. Separate context prevents role confusion. |
| Brand Agent | Quality gate. Reviews ALL other agents' work. Needs independence to reject without bias. |
| Strategy Agent | Business architecture. Heavy reasoning work during Foundation Sprint. Distinct expertise from Brand. |
| Finance Agent | Money watchdog. Must independently verify financial claims from other agents. Independence = integrity. |
| Web Agent | Writes code. Fundamentally different skill set from writing copy or creating visuals. |
| Ads Agent | Manages live campaigns with real money. Platform-specific expertise (Meta, TikTok, Google). Needs its own persistent context to track campaign performance over time. |
| Analytics Agent | Data infrastructure. Tracking setup, dashboard config, performance reporting. Technical + analytical. |
| Launch Agent | QA and verification. Needs to independently verify what other agents built. Can't be the builder AND the inspector. |

---

## The 13 Agents

### CORE AGENTS (Every floor gets all 8)

---

### 1. Floor Manager
**Model:** Opus | **Role:** Project Commander

**What it does:**
- Breaks the goal into phases, milestones, and dependencies
- Tracks every agent's status, progress, and blockers in real-time
- Unblocks agents proactively
- Reviews key deliverables against acceptance criteria
- Coordinates handoffs between agents
- Adapts the plan when reality changes
- Reports progress to CEO Mode and you
- Single point of contact — you talk to the Floor Manager, never to other agents
- Routes approval items upward
- Manages help requests from agents

**Works with:** Every agent. Finance Agent (budget partner). Brand Agent (quality partner).

**Does NOT:** Do the work itself. Tell agents HOW to do their work. Approve every small decision.

**Skills:** `biz-pm`, `biz-clevel`, `mkt-launch`

---

### 2. Brand Agent
**Model:** Opus | **Role:** Brand Guardian + Creative Director

**What it does:**
- Creates brand identity (name, mission, tagline, logo direction, visual language)
- Defines voice and tone guidelines with examples
- Sets visual direction (colors, typography, photography style, mood)
- Defines target customer profile and psychographics
- Creates the brand section of the Foundation Package
- Reviews ALL other agents' outputs for brand consistency
- Approves or rejects any creative output that doesn't match the brand
- **For content:** Acts as Creative Director — sets the visual and creative standard for all content, defines creative frameworks, reviews every piece before publishing
- Studies top-performing content in the niche and deconstructs why it works
- Creates content templates and style guides that production agents follow

**What "Creative Director" means in practice:**
- Intentional color grading (custom palettes, not default filters)
- Typography that's readable, on-brand, and adds weight
- Compositions following cinematic rules
- Every frame looks designed, never like an afterthought
- Thumbnails that stop the scroll

**Works with:** Every agent. Special partnership with Floor Manager as quality right hand.

**Skills:** `design-creative-dir`, `mkt-brand`, `write-brand-voice`

---

### 3. Strategy Agent
**Model:** Opus | **Role:** Business Architect

**What it does:**
- Defines business model and revenue targets
- Maps product categories and market positioning
- Creates pricing framework (the logic, not final numbers)
- Analyzes competitors and identifies differentiation
- Defines KPIs and success metrics
- Creates the strategy section of the Foundation Package
- Collaborates directly with Brand Agent during Foundation Sprint

**Works with:** Brand Agent (positioning ↔ brand), Finance Agent (revenue model), Commerce Agent (pricing framework handoff), Floor Manager (business model informs the plan)

**Phase active:** Foundation Sprint primarily. Consulted during strategy pivots.

**Skills:** `mkt-positioning`, `mkt-competitors`, `biz-growth`

---

### 4. Finance Agent
**Model:** Opus | **Role:** CFO

**What it does:**
- Builds initial budget and revenue model during Foundation Sprint
- Tracks all project costs (hosting, domains, API usage, ads, tools, subscriptions)
- Maintains running budget vs. actual spend comparison
- Models revenue projections (conservative, moderate, aggressive)
- Calculates break-even point and time to profitability
- Tracks gross and net margin per product
- Monitors ROAS once ad campaigns are live
- Flags overspending, low-margin products, unprofitable campaigns
- Recommends budget reallocation based on performance
- Produces weekly P&L summaries, cash flow reports, revenue dashboards
- Reviews any agent action that costs money
- Cross-checks financial claims from other agents (Ads Agent says "ROAS is 4.5x" → Finance Agent verifies from actual data)

**Works with:** Commerce Agent (validates margins), Ads Agent (monitors ad spend/ROAS), Analytics Agent (shares conversion/revenue data), Strategy Agent (revenue targets), Floor Manager (budget partner)

**Skills:** `infra-xlsx`, `biz-growth`

---

### 5. Copy Agent
**Model:** Sonnet | **Role:** Writer + Support Content

**What it does:**
- Homepage headline and value proposition
- Product descriptions (from Commerce Agent's catalog data)
- Category and collection page copy
- About page, FAQ, policies, terms
- CTAs across the entire site
- Email templates (welcome, order confirmation, shipping, abandoned cart)
- Email sequence copy (post-purchase, win-back, nurture)
- Ad copy variations (headlines, body, CTAs for Meta, Google, TikTok)
- Social media post captions, hooks, hashtags, text overlays
- Video scripts with hook → story → CTA structure
- Carousel text (each slide's headline and body)
- **Support content:** Knowledge base articles, chatbot conversation flows, support response templates, escalation procedures, return/refund policy
- **Privacy/legal:** Privacy policy, terms of service (with legal review flagged)
- **SEO content:** On-page optimization, meta descriptions, keyword integration
- Adapts voice per platform (TikTok casual, Instagram aspirational, Facebook conversational)
- A/B tests different captions and headlines

**Works with:** Brand Agent (ongoing voice review), Web Agent (page content), Ads Agent (ad copy), Social Media Agent (captions), Video Agent (scripts), Commerce Agent (product info)

**Skills:** `mkt-copy`, `write-humanizer`, `mkt-seo`

---

### 6. Web Agent
**Model:** Sonnet | **Role:** Developer + Technical Infrastructure

**What it does:**
- Implements website from Design Agent's wireframes and mockups
- Full Next.js + Tailwind CSS + TypeScript development
- Responsive design (mobile-first, since 70%+ traffic is mobile)
- Stripe integration (checkout, webhooks, test mode → live mode)
- Analytics integration (GA4, Meta Pixel, tracking scripts)
- Email capture forms and integration with email provider (Resend/ConvertKit)
- Cookie consent banner implementation
- **Email infrastructure:** Automation flows, trigger-based sequences, list management, unsubscribe handling
- **Technical SEO:** Site speed, meta tags, structured data, sitemap, robots.txt, canonical URLs
- Performance optimization (Core Web Vitals, lazy loading, image optimization)
- Accessibility (WCAG basics)
- Dev server management, preview system, Vercel deployment
- Bug fixes and technical revisions

**Works with:** Design Agent (tight team — implements designs as they arrive), Copy Agent (receives page content), Commerce Agent (product catalog integration), Analytics Agent (tracking scripts), Launch Agent (deployment)

**Terminal access:** Tier 1 for all development. Tier 2 for env variables, database ops. Tier 3 for deployment.

**Skills:** `design-frontend`, `mkt-landing`, `vfx-motion` (or `vfx-gsap` if the floor needs scroll animations)

---

### 7. Analytics Agent
**Model:** Haiku | **Role:** Data & Performance Tracking

**What it does:**
- Sets up GA4, Meta Pixel, and conversion tracking
- Creates UTM parameter system for all marketing links
- Tracks per-post performance: views, engagement, saves, shares, clicks, conversions
- Tracks per-campaign ad performance: spend, impressions, CTR, ROAS
- Tracks customer journey: content view → site visit → product view → add to cart → purchase
- Identifies top-performing content types, formats, posting times
- Calculates content ROI (cost to produce vs. revenue attributed)
- Produces daily/weekly performance reports
- Tracks follower growth, audience demographics, audience behavior
- Feeds performance data back to Social Media Agent and Ads Agent
- Comment-to-conversion tracking (which comments/DMs led to purchases)

**Works with:** Web Agent (tracking implementation), Finance Agent (shares revenue data), Social Media Agent (content performance), Ads Agent (campaign data), Floor Manager (reports)

**Skills:** `infra-xlsx`

---

### 8. Launch Agent
**Model:** Sonnet | **Role:** QA Inspector + Go-Live Manager

**What it does:**
- Independent verification of everything other agents built
- Runs the full launch checklist (security, privacy, functionality, performance)
- Verifies: SSL active, privacy policy live, cookie consent working, unsubscribe flow working, Stripe webhooks verified, no PII in logs, analytics firing, all links working, mobile responsive, load time acceptable
- Manages the go-live sequence: deploy → domain connect → Stripe activate → analytics verify → ad campaigns create (paused)
- Post-launch verification: confirms everything is working on the live URL
- Produces launch summary with all live links and status

**Works with:** Web Agent (deployment), Floor Manager (launch coordination), every agent (verification of their deliverables)

**Skills:** `mkt-launch`

---

### SPECIALIST AGENTS (Added based on goal type)

---

### 9. Design Agent
**Model:** Opus | **Role:** Visual Designer + Image Generator

**What it does:**
- Creates wireframes and mockups for the website
- Designs the complete visual system (component library, page layouts, interaction patterns)
- **Generates all images directly:** Product mockups, lifestyle imagery, branded graphics, hero images, social post visuals, carousel graphics, thumbnails
- Uses appropriate model per image type: Nano Banana Pro for fast iteration, Flux 2 Max for photorealism, GPT Image 1.5 for product accuracy
- Creates 3 variations per visual for review
- Designs email templates, ad creative layouts
- Creates story templates and carousel layouts with storytelling flow
- Designs the floor-specific UI components (image picker layout, brand selector, product review screens)

**Works with:** Web Agent (tight team — real-time design-to-code handoffs), Brand Agent/Creative Director (visual consistency review), Copy Agent (content integration), Ads Agent (ad creative), Social Media Agent (post templates)

**Terminal access:** Tier 1 for file operations. Tier 2 for API calls to image generation services.

**Skills:** `design-frontend`, `design-image-gen`, `design-ui-ux`

---

### 10. Video Agent
**Model:** Opus | **Role:** Video Director + Producer + Editor

**What it does:**
- **Creative direction:** Writes video briefs with concept, mood, duration, camera movement, audio direction, key frames
- **Path A (image-first, quality):** Defines key frames → generates still frames → reviews → generates video from approved frames → post-production → final review
- **Path B (text-to-video, speed):** Writes optimized prompt → generates video directly → light edit → publish
- **Selects the right video model per content type:** Veo 3.1 for cinematic, Runway Gen-4.5 for product demos, Seedance 2.0 for multi-scene, Kling 3.0 for social volume, Pika 2.5 for drafts
- **Post-production (formerly Video Editor Agent):** Color grading, audio (music + voiceover via ElevenLabs), captions (styled, animated, on-brand), pacing/beat sync, hook optimization, platform formatting, thumbnail generation
- Generates 2-3 takes per video, selects best
- Creates multiple variations for A/B testing

**The full pipeline in one agent:**
```
Brief → Key frames (if Path A) → Generation → Edit → Color grade →
Audio → Captions → Format → Thumbnail → Creative Director review
```

**Works with:** Brand Agent/Creative Director (review and approval), Copy Agent (scripts, captions), Social Media Agent (delivers finished video), Ads Agent (ad video creative)

**Terminal access:** Tier 2 (API calls to video generation and audio services)

**Skills:** `video-cinema`, `edit-postprod`, `edit-toolkit`

---

### 11. Commerce Agent
**Model:** Sonnet | **Role:** Product Manager + Pricing Strategist

**What it does:**
- **Product management:** Builds and maintains the product catalog (names, descriptions, categories, variants, images)
- Research sourcing options (print-on-demand, dropship, wholesale)
- Evaluates suppliers on quality, pricing, shipping times, reliability
- Manages product data flow to Web Agent (catalog), Copy Agent (product info), Ads Agent (product feed)
- **Pricing:** Sets prices using strategy from Foundation Package (anchoring, charm pricing, bundles, tiers)
- Calculates margins per product (cost + shipping + platform fees vs. selling price)
- Monitors competitor pricing
- Recommends pricing adjustments based on sales data
- Sets free shipping thresholds, bundle discounts, promotional pricing
- **Fulfillment:** Integrates with fulfillment APIs (Printful, Gooten, etc.)
- Flags where human action is needed ("you need to create an account with this supplier")

**Works with:** Strategy Agent (pricing framework), Finance Agent (margin validation), Web Agent (catalog integration, pricing display), Copy Agent (product descriptions), Ads Agent (product info for campaigns), Design Agent (product images)

**Skills:** `mkt-pricing`, `biz-product`

---

### 12. Social Media Agent
**Model:** Sonnet | **Role:** Content Strategist + Publisher + Community Manager + Trend Monitor

**What it does:**
- **Strategy:** Builds content calendar per platform, determines posting frequency, decides content mix, maps content to buyer journey, plans themes by week/month
- **Trend monitoring:** Monitors trending content on Instagram, TikTok, Facebook. Identifies trending audio, formats, transitions, challenges, hooks. Analyzes what's working in the niche. Monitors competitor posting and engagement. Tracks algorithm changes.
- **Publishing:** Manages the content queue, schedules posts at optimal times, publishes via platform API (Meta Graph API, TikTok API), confirms posts are live
- **Community management:** Monitors all comments and DMs across all platforms 24/7. Responds in brand voice within 30 minutes. Drives engagement that boosts algorithm distribution. Handles product questions and purchase-intent DMs. Escalates complaints and refund requests to you. Follows up on warm leads. Filters spam.
- **Coordination:** Works with production agents (Video Agent, Design Agent, Copy Agent) to produce the calendar. Coordinates with Ads Agent to align organic and paid strategy.

**Platform expertise:**
- Instagram: Reels for reach, Carousels for saves, Stories for engagement, Feed for brand
- TikTok: Trend-first, hook in 1 second, native feel
- Facebook: Longer storytelling, community, retargeting audience

**Works with:** Brand Agent/Creative Director (content standards), Video Agent (video content), Design Agent (visual content), Copy Agent (captions and copy), Ads Agent (organic ↔ paid alignment), Analytics Agent (performance data feeds back to strategy)

**Terminal access:** Tier 2 (API access to social platforms for posting and monitoring)

**Skills:** `mkt-social`, `social-instagram`, `social-tiktok`

---

### 13. Ads Agent
**Model:** Sonnet | **Role:** Paid Acquisition Manager

**What it does:**
- **Campaign structure:** Designs campaign architecture per platform (Campaign → Ad Sets → Ads)
- **Audience targeting:** Research and define target audiences, lookalike audiences, retargeting audiences
- **Creative pairing:** Combines creative assets (from Video Agent, Design Agent) with copy (from Copy Agent) into ad units
- **Platform management:** Meta Advantage+ campaigns, TikTok Spark Ads, Google Shopping/PMax (if added)
- **Optimization (post-launch):** Daily optimization loop — collect data → analyze → adjust budgets → pause losers → scale winners → refresh creative when fatigued
- **Budget management:** Shifts budget between ad sets, increases winning campaigns by up to 20%/day, pauses ads below 1.0x ROAS for 3+ days
- **Creative refresh:** Detects ad fatigue (declining CTR, high frequency), requests new creative from production agents
- **Scaling:** Follows the 20%/week budget increase rule while ROAS holds

**What it can do automatically:** Rebalance within campaigns, gradual scaling, pause losing ads, create variations from approved creative

**What needs your approval:** Increase total daily spend cap, launch new campaigns, add new platforms, increase floor budget

**Works with:** Finance Agent (spend tracking, ROAS verification), Analytics Agent (performance data), Social Media Agent (organic ↔ paid alignment), Video Agent + Design Agent + Copy Agent (creative production), Floor Manager (escalation)

**Skills:** `mkt-ads`, `mkt-funnel`

---

## Revised Agent Count by Goal Type

| Goal Type | Core | Specialists | Total |
|---|---|---|---|
| Ecommerce store | 8 | Commerce, Design, Video, Social Media, Ads | 13 |
| Service business | 8 | Design, Social Media, Ads | 11 |
| Content/media brand | 8 | Design, Video, Social Media | 11 |
| TikTok-first brand | 8 | Design, Video, Social Media, Ads | 12 |
| SaaS / digital product | 8 | Design, Social Media, Ads, Commerce | 12 |
| Personal brand / consulting | 8 | Design, Social Media | 10 |

---

## Model Tier Summary

| Tier | Model | Agents | Monthly Cost Estimate (per floor) |
|---|---|---|---|
| **Opus** | Claude Opus 4.6 | Floor Manager, Brand Agent, Strategy Agent, Finance Agent, Design Agent, Video Agent | ~$120-160 |
| **Sonnet** | Claude Sonnet 4.6 | Copy Agent, Web Agent, Commerce Agent, Social Media Agent, Ads Agent, Launch Agent | ~$80-120 |
| **Haiku** | Claude Haiku 4.5 | Analytics Agent | ~$5-10 |
| | | **Total per floor** | **~$205-290** |

Previous 23-agent roster estimated ~$340. This is 15-35% cheaper with the same output quality.

---

## What You Lose (Nothing)

Every capability from the 23-agent roster still exists. The difference:

- **Before:** Video Agent writes brief → sends to Video Generator Agent (separate API call) → Video Generator calls the video API → sends to Video Editor Agent (separate API call) → Video Editor does post-production. Three agents, three separate conversations, constant handoffs.

- **After:** Video Agent writes brief → calls the video API itself → does post-production. One agent, one conversation, no handoffs. The video API call is a tool use, not a separate agent.

The same consolidation logic applies to Design + Image Generation and Social Media + Community + Trends.

---

## VFX Agent (Optional, Rare)

Not included in the default roster because very few floors need it. Added only when the goal specifically requires 3D product visualizations, WebGL experiences, AR features, or advanced scroll animations.

**Model:** Sonnet
**Skills:** `vfx-threejs`, `vfx-gsap`, `vfx-r3f`

If added, total becomes 14 agents max for the most complex floors.

---

## Key Rules (Unchanged)

1. Every floor gets 8 core agents. Specialists added based on goal.
2. No agent gets more than 3 skills.
3. Brand Agent and Finance Agent touch everything — quality and money watchdogs.
4. Floor Manager coordinates but doesn't do the work.
5. Agents collaborate directly. Help requests go through Floor Manager only when needed.
6. Terminal access follows the 3-tier safety system. Every command is logged.
7. The goal determines the agent configuration.
