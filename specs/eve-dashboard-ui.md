# EVE — Dashboard & Mobile UI
## The Interface You Actually Use Every Day

---

# DESIGN PHILOSOPHY

You manage EVE from your phone. The dashboard isn't a desktop app adapted for mobile — it's a mobile app that also works on desktop. Every design decision starts with "how does this work on a 375px screen held in one hand?"

**Three principles:**

1. **Notifications pull you in. You don't have to check.** The app tells you when something needs your attention. Between notifications, you can ignore it completely.

2. **Every action is one tap or one swipe.** Approve content: swipe right. Reject: swipe left. Approve a proposal: tap the green button. No multi-step forms, no dropdowns, no page navigation to make a decision.

3. **Glanceable by default, deep on demand.** The first screen shows you the number that matters most. Tap to see more detail. Tap again for the full picture. You choose how deep to go.

---

# TECHNICAL IMPLEMENTATION

## Progressive Web App (Next.js)

```
TECH STACK:
  Framework: Next.js (same as floor websites — one stack for everything)
  Styling: Tailwind CSS
  State: React Server Components + client-side state for interactions
  Real-time: Supabase Realtime (WebSocket subscriptions for live data)
  Push: Web Push API (via service worker)
  Auth: Supabase Auth (magic link — no passwords)
  Hosting: Vercel
  Offline: Service worker caches shell + recent data

PWA REQUIREMENTS:
  ├── manifest.json (app name, icons, theme color, display: standalone)
  ├── Service worker (cache shell, handle offline, push notifications)
  ├── HTTPS (automatic via Vercel)
  ├── Responsive design (375px primary, scales up)
  └── Install prompt (shows "Add to Home Screen" after 2nd visit)

PERFORMANCE TARGETS:
  ├── First load: < 2 seconds on 4G
  ├── Subsequent loads: < 500ms (cached shell)
  ├── Time to interactive: < 1.5 seconds
  ├── Offline: shows cached data + "offline" indicator
  └── Push notification delivery: < 5 seconds from trigger
```

## Authentication

```
SIMPLE AUTH FLOW:
  1. First launch → enter your email
  2. Magic link sent to email (no password to remember)
  3. Tap link → logged in
  4. Session persists for 30 days
  5. Biometric unlock option (Face ID / fingerprint via WebAuthn)

SECURITY:
  - Single user only (no multi-user in v1)
  - Session token stored in secure cookie
  - All API calls authenticated
  - Auto-logout after 30 days of inactivity
  - Can revoke all sessions from Settings
```

---

# THE NAVIGATION STRUCTURE

## Bottom Navigation Bar (always visible on mobile)

```
┌──────────────────────────────────────┐
│                                      │
│         [Current Screen]             │
│                                      │
│                                      │
├──────────────────────────────────────┤
│  🏠    📊    ✅    💬    ⚙️         │
│ Home  Floors Approve Chat  Settings  │
└──────────────────────────────────────┘

HOME: HQ Dashboard (cross-floor overview)
FLOORS: List of all floors (tap to enter a floor)
APPROVE: Unified approval queue (all pending items)
CHAT: Floor Manager conversations
SETTINGS: Global + per-floor settings
```

**Badge counts on nav icons:**
- Approve tab: red badge with count of pending approvals
- Chat tab: yellow badge if Floor Manager needs your input
- Home tab: red dot if any critical alert

---

# SCREEN-BY-SCREEN SPECIFICATION

## Screen 1: Home (HQ Dashboard)

The first thing you see when you open the app.

```
┌──────────────────────────────────────┐
│ EVE                        [👤]    │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │        $28,450                   │ │
│ │    Total Revenue (this month)    │ │
│ │         ↑ 12% vs last month     │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌────────────┐ ┌────────────┐       │
│ │ 3 floors   │ │ 47 agents  │       │
│ │ active     │ │ running    │       │
│ └────────────┘ └────────────┘       │
│                                      │
│ FLOORS                               │
│ ┌──────────────────────────────────┐ │
│ │ FaithForge            ✅ Live    │ │
│ │ $18,200 rev | ROAS 4.1x         │ │
│ │ ████████████░░ 89% health       │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ LuxeWick           🔨 Building   │ │
│ │ Phase 4/10 | 67% complete        │ │
│ │ ████████░░░░░░ 67% progress     │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 🔴 1 APPROVAL NEEDED                │
│ ┌──────────────────────────────────┐ │
│ │ LuxeWick Foundation Package      │ │
│ │ Ready for review →               │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 💡 CEO MODE INSIGHT                  │
│ ┌──────────────────────────────────┐ │
│ │ "FaithForge ready to scale.      │ │
│ │  Recommend 20% budget increase." │ │
│ │  [Review →]                      │ │
│ └──────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│  🏠    📊    ✅    💬    ⚙️         │
└──────────────────────────────────────┘

INTERACTIONS:
- Tap a floor card → enters that floor's dashboard
- Tap approval item → goes to approval screen
- Tap CEO insight → opens detail with approve/dismiss
- Pull down to refresh all data
- Hero revenue number animates on load (count-up)
```

## Screen 2: Floor Dashboard — Overview Tab (Post-Launch)

What you see when a floor is live and selling.

```
┌──────────────────────────────────────┐
│ ← FaithForge                        │
│                                      │
│ [Overview] [Build] [Review] [⚙️]    │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │        $847                      │ │
│ │     Revenue Today                │ │
│ │      ↑ 23% vs yesterday         │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │ 24     │ │ $35.29 │ │ 2.8%   │   │
│ │ Orders │ │ AOV    │ │ Conv.  │   │
│ └────────┘ └────────┘ └────────┘   │
│                                      │
│ REVENUE CHART                        │
│ ┌──────────────────────────────────┐ │
│ │ [24h] [7d] [30d] [All]          │ │
│ │ ╭─────────────╮                  │ │
│ │ │  📈 chart   │                  │ │
│ │ ╰─────────────╯                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ AD PERFORMANCE                       │
│ ┌──────────────────────────────────┐ │
│ │ Meta Prospecting    $25 → $94   │ │
│ │ ROAS: 3.8x  ██████████░ 🟢     │ │
│ │                                  │ │
│ │ Meta Retargeting    $15 → $89   │ │
│ │ ROAS: 5.9x  █████████████ 🟢   │ │
│ │                                  │ │
│ │ TikTok             $10 → $22    │ │
│ │ ROAS: 2.2x  ██████░░░░░ 🟡     │ │
│ └──────────────────────────────────┘ │
│                                      │
│ TOP PRODUCTS TODAY                   │
│ ┌──────────────────────────────────┐ │
│ │ 1. Walk By Faith Tee    $340    │ │
│ │ 2. Kingdom Minded Hood  $295    │ │
│ │ 3. Psalm 23 Crewneck    $212    │ │
│ └──────────────────────────────────┘ │
│                                      │
│ CONTENT                              │
│ ┌──────────────────────────────────┐ │
│ │ Published today: 3               │ │
│ │ Queued: 5  |  Engagement: 4.2%  │ │
│ │ [View queue →]                   │ │
│ └──────────────────────────────────┘ │
│                                      │
│ COMMUNITY                            │
│ ┌──────────────────────────────────┐ │
│ │ Response time: 12 min avg        │ │
│ │ Unread DMs: 3  |  Comments: 8   │ │
│ │ 🔴 1 escalation waiting          │ │
│ └──────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│  🏠    📊    ✅    💬    ⚙️         │
└──────────────────────────────────────┘
```

## Screen 3: Floor Dashboard — Build Tab (During Build)

What you see while agents are building.

```
┌──────────────────────────────────────┐
│ ← FaithForge                        │
│                                      │
│ [Overview] [Build] [Review] [⚙️]    │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │        67%                       │ │
│ │    Build Progress                │ │
│ │    Phase 4 of 10 · Content      │ │
│ │    ETA: 3 days                   │ │
│ │ ████████████░░░░░░░             │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │ $34.20 │ │ 11/13  │ │ Day 5  │   │
│ │ Spent  │ │ Active │ │ of 10  │   │
│ └────────┘ └────────┘ └────────┘   │
│                                      │
│ AGENT STATUS                         │
│ ┌──────────────────────────────────┐ │
│ │ 🟢 Copy Agent                    │ │
│ │    Writing product descriptions  │ │
│ │    14 of 30 complete             │ │
│ │                                  │ │
│ │ 🟢 Web Agent                     │ │
│ │    Building product pages        │ │
│ │    Waiting on: product images    │ │
│ │                                  │ │
│ │ 🟢 Design Agent                  │ │
│ │    Generating product mockups    │ │
│ │    Batch 2 of 3                  │ │
│ │                                  │ │
│ │ 🟡 Video Agent                   │ │
│ │    Waiting on: approved designs  │ │
│ │                                  │ │
│ │ ⚫ Ads Agent                     │ │
│ │    Not started (Phase 7)         │ │
│ │                                  │ │
│ │ [View all 13 agents →]          │ │
│ └──────────────────────────────────┘ │
│                                      │
│ APPROVAL GATES                       │
│ ┌──────────────────────────────────┐ │
│ │ ✅ Gate 1: Foundation  Approved  │ │
│ │ ⏳ Gate 2: Launch      Phase 8  │ │
│ │ ⏳ Gate 3: Ads         Phase 9  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ COST TRACKER                         │
│ ┌──────────────────────────────────┐ │
│ │ $34.20 of $200 budget            │ │
│ │ ███░░░░░░░░░░░░ 17%             │ │
│ │ API: $28 | Images: $4 | Video: $2│ │
│ └──────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│  🏠    📊    ✅    💬    ⚙️         │
└──────────────────────────────────────┘

INTERACTIONS:
- Tap any agent → slides in Agent Detail panel
- Agent Detail shows: role, model, current task, recent outputs,
  cost breakdown, time spent
- Tap "View all agents" → full agent list with status filters
```

## Screen 4: Floor Dashboard — Review Tab (Dynamic Components)

This tab is assembled per floor based on what needs your review. The Floor Manager selects which components appear.

```
┌──────────────────────────────────────┐
│ ← FaithForge                        │
│                                      │
│ [Overview] [Build] [Review] [⚙️]    │
│                                      │
│ 🔴 3 items need your review          │
│                                      │
│ BRAND OPTIONS (during Foundation)     │
│ ┌──────────────────────────────────┐ │
│ │ Choose your brand direction:     │ │
│ │                                  │ │
│ │ [A]  Bold &     [B]  Humble    │ │
│ │      Prophetic        Street    │ │
│ │ ┌──────────┐  ┌──────────┐     │ │
│ │ │  🎨 mood │  │  🎨 mood │     │ │
│ │ │  board   │  │  board   │     │ │
│ │ └──────────┘  └──────────┘     │ │
│ │                                  │ │
│ │ [C]  Urban                      │ │
│ │      Revival                    │ │
│ │ ┌──────────┐                    │ │
│ │ │  🎨 mood │ [Tap to expand]   │ │
│ │ │  board   │                    │ │
│ │ └──────────┘                    │ │
│ └──────────────────────────────────┘ │
│                                      │
│ DESIGN APPROVALS                     │
│ ┌──────────────────────────────────┐ │
│ │ 12 designs ready for review      │ │
│ │                                  │ │
│ │ ┌──────────────────────────┐    │ │
│ │ │                          │    │ │
│ │ │    [Shirt design on      │    │ │
│ │ │     model mockup]        │    │ │
│ │ │                          │    │ │
│ │ │  "Walk By Faith"         │    │ │
│ │ │   ← SWIPE →              │    │ │
│ │ │                          │    │ │
│ │ │  [❌ Reject]  [✅ Approve]│    │ │
│ │ └──────────────────────────┘    │ │
│ │                                  │ │
│ │ 4 of 12 reviewed                │ │
│ └──────────────────────────────────┘ │
│                                      │
│ CONTENT QUEUE                        │
│ ┌──────────────────────────────────┐ │
│ │ 5 posts ready for approval       │ │
│ │                                  │ │
│ │ ┌──────────────────────────┐    │ │
│ │ │ [Instagram Reel preview]  │    │ │
│ │ │ Caption: "Faith meets..." │    │ │
│ │ │ Scheduled: Today 7pm CT   │    │ │
│ │ │                          │    │ │
│ │ │  [❌ Reject]  [✅ Approve]│    │ │
│ │ └──────────────────────────┘    │ │
│ │                                  │ │
│ │ Swipe for next →                │ │
│ └──────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│  🏠    📊    ✅    💬    ⚙️         │
└──────────────────────────────────────┘
```

## Screen 5: Unified Approval Queue

All pending approvals across all floors in one place.

```
┌──────────────────────────────────────┐
│ Approvals                    [All ▼] │
│                                      │
│ 🔴 APPROVAL REQUIRED (2)             │
│ ┌──────────────────────────────────┐ │
│ │ LuxeWick · Foundation Package    │ │
│ │ Brand, strategy, budget ready    │ │
│ │ [Review →]              2h ago   │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ FaithForge · Ad Campaign         │ │
│ │ TikTok Prospecting — $10/day     │ │
│ │ [Review →]              4h ago   │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 🟡 NEEDS YOUR INPUT (1)              │
│ ┌──────────────────────────────────┐ │
│ │ FaithForge · Floor Manager       │ │
│ │ "Video content delayed. 3 opts:" │ │
│ │ [Respond →]             1h ago   │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 🔧 IMPROVEMENT PROPOSALS (3)         │
│ ┌──────────────────────────────────┐ │
│ │ Copy Agent — Product Descriptions│ │
│ │ "Add 50-word limit to prompt"    │ │
│ │ Risk: Low | Impact: High         │ │
│ │ [✅ Approve] [❌ Reject] [✏️]    │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ Content Mix — FaithForge         │ │
│ │ "Increase video from 40% to 55%" │ │
│ │ Risk: Low | Impact: Medium       │ │
│ │ [✅ Approve] [❌ Reject] [✏️]    │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ Design Default — All Floors      │ │
│ │ "Lead with bold/dark designs"    │ │
│ │ Risk: Low | Confidence: 87%      │ │
│ │ [✅ Approve] [❌ Reject] [✏️]    │ │
│ └──────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│  🏠    📊    ✅    💬    ⚙️         │
└──────────────────────────────────────┘
```

## Screen 6: Chat (Floor Manager Conversations)

```
┌──────────────────────────────────────┐
│ Chat                                 │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ 🏗️ FaithForge FM          12m   │ │
│ │ "67% done. Content phase.        │ │
│ │  On track for May 5. No blockers"│ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ 🕯️ LuxeWick FM            2h    │ │
│ │ "Foundation Package ready for    │ │
│ │  your review."                   │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ 🏛️ CEO Mode               1d    │ │
│ │ "FaithForge scaling recommend."  │ │
│ └──────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│  🏠    📊    ✅    💬    ⚙️         │
└──────────────────────────────────────┘

TAP A CONVERSATION → opens chat thread:

┌──────────────────────────────────────┐
│ ← FaithForge FM                     │
│                                      │
│         FM: "67% done. Content       │
│         phase — 14 of 30 products.   │
│         On track for May 5.          │
│         No blockers."      12m ago   │
│                                      │
│ YOU: "The hero section needs to      │
│ feel more premium"          10m ago  │
│                                      │
│         FM: "Routing to Design       │
│         Agent. Specifics:            │
│         1. More whitespace?          │
│         2. Different hero image?     │
│         3. Different font weight?    │
│         Or screenshot what to        │
│         change."             9m ago  │
│                                      │
│ YOU: "More whitespace, bigger hero   │
│ image, less text above fold" 8m ago  │
│                                      │
│         FM: "Done. Design Agent      │
│         updated. Preview refresh     │
│         in ~10 min."         7m ago  │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Type a message...     [🎤] [📎] │ │
│ └──────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│  🏠    📊    ✅    💬    ⚙️         │
└──────────────────────────────────────┘

FEATURES:
- Text input (keyboard)
- Voice input (🎤 button — speech-to-text)
- Image/screenshot upload (📎 button)
- Floor Manager responds in character (short, direct, actionable)
```

---

# NOTIFICATION SYSTEM

```
NOTIFICATION TIERS:

🔴 CRITICAL (push immediately + sound + vibration):
  - Approval gates ready (Foundation, Launch, Ads)
  - Budget alert at 90% ceiling
  - Incident (something went wrong that needs your attention)
  - Ad account restricted
  Delivery: push notification → tap opens the relevant screen

🟡 IMPORTANT (push quietly — no sound):
  - Major milestone completed
  - Floor Manager needs your input
  - Design approvals ready
  - Content batch ready for review
  - Improvement proposals available
  - ROAS declining for 3+ days
  Delivery: push notification → badge on Approve tab

🟢 INFORMATIONAL (in-app only — no push):
  - Daily/weekly reports available
  - Agent status changes
  - Content published successfully
  - Orders received
  Delivery: visible in-app, no push notification

NOTIFICATION PREFERENCES (configurable):
  ├── You can promote/demote any notification type
  ├── Quiet hours (e.g., 11pm-7am — no push at all)
  ├── Per-floor notification settings
  └── "Mute all" for vacation mode (critical alerts still queue)

MORNING BRIEFING (daily, configurable time):
  Push notification at your chosen time (default 8am):
  "Good morning. Here's your EVE briefing:
   
   FaithForge: $847 yesterday, ROAS 3.8x, 3 posts published
   LuxeWick: 67% built, on track, no blockers
   
   1 approval waiting. 2 improvement proposals."
  
  Tap → opens Home screen with all details.
```

---

# DYNAMIC FLOOR UI COMPONENT LIBRARY

The Review Tab is assembled from these components based on what the floor needs.

```
AVAILABLE COMPONENTS:

1. BRAND SELECTOR
   Shows 2-3 brand direction options with mood boards
   Tap to expand, tap to select
   Used during: Foundation Sprint

2. IMAGE GALLERY APPROVAL
   Swipeable gallery of designs/images
   Swipe right = approve, left = reject
   Tap to enlarge, pinch to zoom
   Type feedback on rejected items
   Counter: "4 of 12 reviewed"
   Used during: design phase, ongoing content

3. CONTENT APPROVAL QUEUE
   Stack of content cards (image/video + caption + schedule)
   Approve/reject per piece
   Preview video inline (tap to play)
   Edit caption before approving
   Used during: ongoing content production

4. A/B COMPARATOR
   Two options side by side
   Tap to choose winner
   Used for: design variations, headline testing

5. PRODUCT MOCKUP VIEWER
   Product images on mockups (shirt on model, etc.)
   Swipe between products
   Approve/reject product designs
   Used during: product creation phase

6. VIDEO REVIEW PLAYER
   Full-screen video preview
   Play/pause, scrub
   Approve/reject with feedback
   Used during: video production

7. PRICING TABLE
   Products with cost, price, margin displayed
   Editable prices (tap to change)
   Margin recalculates in real-time
   Used during: pricing approval

8. CAMPAIGN PREVIEW
   Ad campaign with creative previews
   Budget, audience, objective displayed
   Per-campaign approve/reject
   Used during: Gate 3 (Ad Activation)

9. SITE PREVIEW
   Embedded browser preview of staging URL
   Works on phone (responsive site in responsive app)
   Used during: Gate 2 (Launch Review)

10. IMPROVEMENT CARD
    Proposal with evidence, expected impact, risk level
    Approve/reject/edit
    Used during: weekly improvement review

ASSEMBLY LOGIC:
  Floor Manager tells the Orchestrator which components to show:
  
  Foundation Sprint: Brand Selector + Pricing Table
  Design Phase: Image Gallery + Product Mockup Viewer
  Content Phase: Content Approval Queue + Video Review Player
  Pre-Launch: Site Preview + Campaign Preview
  Post-Launch: Content Queue + Improvement Cards
  
  Components appear/disappear based on floor phase.
```

---

# DESIGN SYSTEM

```
COLORS:
  Primary: #0A0A0F (near-black — premium feel)
  Surface: #1A1A2E (card backgrounds)
  Accent: #6C63FF (actions, links, active states)
  Success: #10B981
  Warning: #F59E0B
  Error: #EF4444
  Text: #FAFAFA (on dark), #1A1A2E (on light)
  
  Auto light/dark mode based on system preference
  Dark mode is primary (most phone users use dark mode)

TYPOGRAPHY:
  Headings: Sora (clean, modern, tech-forward)
  Body: Inter (highly legible at small sizes)
  Numbers/metrics: Space Mono (monospace for alignment)
  
  Sizes:
  Hero number: 48px (revenue, progress %)
  Section header: 18px bold
  Card title: 16px semibold
  Body text: 14px regular
  Caption/metadata: 12px regular

SPACING:
  Card padding: 16px
  Section gap: 24px
  Screen padding: 16px horizontal
  Bottom nav height: 64px + safe area

COMPONENTS:
  Cards: rounded-lg (12px radius), subtle border, slight shadow
  Buttons: rounded-full for primary actions, rounded-lg for secondary
  Badges: small rounded pills with colored backgrounds
  Charts: simple line/bar using lightweight chart library (Chart.js)
  Progress bars: rounded, gradient fill, animated
  Avatars: 32px circles for agent icons
  
ANIMATIONS:
  Page transitions: slide left/right (native-feeling)
  Card tap: subtle scale (0.98 → 1.0)
  Number changes: count-up animation
  Progress bars: fill animation on load
  Pull-to-refresh: standard iOS/Android pull gesture
  Swipe actions: card slides with approve/reject color reveal

NO:
  - No glassmorphism (too heavy for mobile performance)
  - No canvas animations (battery drain)
  - No backdrop-filter blur (laggy on older phones)
  - No heavy gradients (keep it clean and fast)
  The desktop mockups had these — mobile version is simpler and faster.
```

---

# REAL-TIME UPDATES

```
WHAT UPDATES IN REAL-TIME (via Supabase Realtime):
  - Agent status changes (working → complete → blocked)
  - New orders (counter increments)
  - Build progress percentage
  - Cost tracker
  - Content published confirmations
  - New comments/DMs received

WHAT UPDATES ON PULL-TO-REFRESH:
  - Revenue numbers (recalculated)
  - Ad performance (pulled from Meta/TikTok APIs)
  - Analytics data
  - Improvement proposals

WHAT UPDATES ON SCREEN LOAD:
  - Full data refresh when switching tabs
  - Stale data indicator if offline (shows last updated time)
```

---

# OFFLINE BEHAVIOR

```
WHAT WORKS OFFLINE:
  - App shell loads (navigation, layout, cached screens)
  - Recently viewed data displays with "Offline — showing cached data" indicator
  - Chat history readable (not sendable)
  - Approval queue viewable (approvals queue locally, sync when back online)

WHAT DOESN'T WORK OFFLINE:
  - New data fetching
  - Sending messages
  - Live preview URLs
  - Real-time agent status

SYNC BEHAVIOR:
  When connection restores:
  - Queued approvals sync automatically
  - Fresh data loads in background
  - Push notifications deliver queued items
  - No data loss — everything queued locally
```

---

# DESKTOP EXPERIENCE

The PWA scales up to desktop but remains the same app, not a redesigned layout.

```
DESKTOP ADAPTATIONS (>768px):
  - Bottom nav moves to left sidebar
  - Cards arrange in 2-3 column grid
  - Chat opens as side panel (not full screen)
  - Agent status shows more detail inline
  - Charts are wider with more data points
  - Review Tab shows items in grid instead of stack
  
  Same components, same data, more space.
  Mobile is the source of truth — desktop adapts from mobile, not vice versa.
```

---

# IMPLEMENTATION PHASES

```
PHASE 4A (Week 7): Core Shell
  - PWA setup (manifest, service worker, install prompt)
  - Auth flow (magic link + session)
  - Bottom navigation
  - Home screen (HQ Dashboard)
  - Floor list
  - Push notification infrastructure

PHASE 4B (Week 8): Floor Dashboards
  - Overview Tab (revenue, orders, ads, content, community)
  - Build Tab (progress, agents, costs, gates)
  - Settings Tab (per-floor config)
  - Real-time updates via Supabase Realtime
  - Chart components (revenue, progress)

PHASE 4C (Week 9): Interaction Screens
  - Review Tab with dynamic components
  - Brand Selector
  - Image Gallery Approval (swipe)
  - Content Approval Queue
  - Video Review Player
  - Chat interface (text + voice + image)
  - Approval Queue (unified)
  - Improvement Cards
  - Notification system (push + in-app)
  - Morning briefing
```
