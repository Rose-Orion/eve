# EVE — Creative Production Workflows
## Research-Backed Best Practices for Maximum Quality Output

---

# THE CORE PRINCIPLE: MULTI-MODEL ROUTING

The single most important finding across all creative domains in 2026: **no single model is the best choice for every task.** The teams producing the best output use multi-model strategies — routing each specific task to the model that handles it best. This is EVE's competitive advantage. While solo creators are locked into one tool, EVE's agents can automatically select the optimal model for each shot, each image, each video.

This principle applies to every creative domain: image generation, video production, ad creative, and content creation.

---

# SECTION 1: IMAGE GENERATION WORKFLOW

## The Model Routing Table (Updated March 2026)

| Task | Best Model | Why | Cost | Fallback |
|---|---|---|---|---|
| Product photography | Flux 2 Max | Best photorealism, DSLR-quality skin/lighting | ~$0.03/img | Imagen 4 |
| Brand/artistic visuals | Midjourney v8 | Unmatched aesthetic quality, 5x faster, native 2K | $30/mo sub | Flux 2 Pro |
| Text in images (logos, banners) | GPT Image 1.5 | Best text rendering (~95% accuracy) | $0.04-0.12/img | Ideogram 3.0 |
| Logos and vector assets | Recraft V4 | #1 on HuggingFace for vectors, native SVG export | ~$0.04/img | Ideogram 3.0 |
| High-volume social content | Nano Banana 2 (Gemini Flash) | Pro quality at Flash speed, 4K, ~1-3 seconds | ~$0.04/img | Seedream 4.5 |
| Fast iteration/prototyping | Nano Banana 2 (Gemini Flash) | Fastest generation, cheapest for rapid testing | ~$0.02/img | Flux 2 Dev (free) |
| Character consistency | Flux Kontext / Ideogram V3 | Maintains visual identity across generations | ~$0.03/img | Leonardo AI |
| E-commerce lifestyle imagery | Flux 2 Pro | Precise prompt adherence, clean backgrounds | ~$0.03/img | Nano Banana Pro |

## The Image Production Pipeline

```
BRIEF (from Brand Agent / Creative Director)
  │
  ├── What type of image? → routes to correct model
  ├── Prompt construction (detailed: subject, lighting, composition, style, mood)
  ├── Brand context injection (colors, typography, visual style from Foundation Package)
  │
  ▼
GENERATION (3 variations per image)
  │
  ├── Generate at target resolution
  ├── If text needed → GPT Image 1.5 or Ideogram 3.0
  ├── If product → Flux 2 Max with reference image
  ├── If social content → Nano Banana 2 for speed
  │
  ▼
REVIEW (Brand Agent / Creative Director)
  │
  ├── Does it match the brand? (colors, mood, style)
  ├── Is the quality top 1%? (composition, lighting, detail)
  ├── Is text rendered correctly? (if applicable)
  ├── APPROVED → goes to intended use
  ├── REVISION → specific feedback → regenerate with adjusted prompt
  │
  ▼
POST-PROCESSING (if needed)
  │
  ├── Resize for platform (1080x1080 feed, 1080x1920 stories, etc.)
  ├── Add brand overlays (logo watermark, text overlay)
  ├── Color correction to match brand palette
  └── Export in correct format
```

## Key Insight: Prompt Quality > Model Choice

Research consistently shows that the quality of the prompt matters more than which model you use. A detailed prompt with specific subject, lighting, camera angle, composition, and mood produces excellent results on almost any model. A vague prompt produces mediocre results everywhere.

**EVE's advantage:** The Design Agent (Opus) writes the prompts. It understands cinematographic principles, composition rules, and brand aesthetics. The Image Generator function (Haiku sub-agents for batch work) executes the API calls. The creative intelligence is in the prompt, not the generation.

**Prompt structure for best results:**
```
[Subject] — specific, detailed description of the main element
[Setting/Environment] — where it takes place, background details
[Lighting] — natural, studio, golden hour, dramatic, soft
[Camera] — angle, lens (85mm, wide angle), depth of field
[Style] — photorealistic, editorial, cinematic, minimalist
[Mood] — warm, energetic, serene, bold, luxurious
[Brand elements] — color palette, aesthetic direction from Foundation Package
[Negative] — what to avoid (generic, AI-looking, oversaturated)
```

---

# SECTION 2: VIDEO PRODUCTION WORKFLOW

## The Video Model Routing Table (Updated March 2026)

| Content Type | Best Model | Why | Cost/10s | Fallback |
|---|---|---|---|---|
| Cinematic hero/brand video | Veo 3.1 | Best photorealism, native 4K, native audio | $4.00-6.00 | Runway Gen-4.5 |
| Product showcase/demo | Runway Gen-4.5 | Best temporal consistency, motion control | $2.00-4.00 | Kling 3.0 |
| Multi-scene storytelling | Seedance 2.0 | Up to 9 image + 3 video + 3 audio references | $1.50-3.00 | Kling 3.0 |
| High-volume social (Reels/TikTok) | Kling 3.0 | Best cost-efficiency, native audio, lip sync | $0.29-1.00 | Pika 2.5 |
| UGC-style ads | Kling 3.0 | Slightly imperfect look matches UGC aesthetic | $0.29-1.00 | Seedance 2.0 |
| Quick drafts/tests | Pika 2.5 | Cheapest, fastest, good for iteration | $0.08-0.25 | Kling free tier |
| Abstract/motion design | Runway Gen-4.5 | Best stylized/non-photorealistic capabilities | $2.00-4.00 | Luma Ray 3.14 |
| Avatar/talking head | Kling 3.0 | Native lip sync, facial expression control | $0.29-1.00 | HeyGen |

**Critical update:** Sora was shut down March 25, 2026. Removed from all workflows. Kling 3.0 and Veo 3.1 absorb its use cases.

## The Two-Path Video Pipeline (Refined)

### Path A: Image-First (Quality Priority)

Best for: hero content, product showcases, ad creative, anything the Brand Agent will scrutinize.

```
1. CREATIVE BRIEF (Video Agent, Opus)
   │ Concept, mood, duration, camera movement, audio direction
   │ Key frame descriptions (what each moment looks like)
   │ Model selection (auto-routed based on content type)
   │
2. KEY FRAME GENERATION (Design Agent or sub-agent)
   │ Generate still frames using image model best suited:
   │   Product shots → Flux 2 Max
   │   Lifestyle/mood → Nano Banana Pro
   │   Specific accuracy → GPT Image 1.5
   │ Generate 3 variations per key frame
   │
3. KEY FRAME REVIEW (Video Agent + Brand Agent)
   │ Select best variation per frame
   │ Ensure visual consistency across all frames
   │ Reject → specific feedback → regenerate
   │
4. VIDEO GENERATION (Video Agent)
   │ Image-to-video using selected model:
   │   Veo 3.1: upload reference images as "ingredients"
   │   Runway Gen-4.5: upload start frame, motion brush for movement
   │   Seedance 2.0: up to 12 reference inputs for multi-scene
   │   Kling 3.0: start + end frame, AI fills motion between
   │ Generate 2-3 takes per segment
   │
5. SELECT + POST-PRODUCTION (Video Agent)
   │ Select best take
   │ Color grade to brand palette
   │ Audio layer:
   │   - Voiceover via ElevenLabs (brand voice)
   │   - Background music (royalty-free or AI-generated)
   │   - Sound effects if needed
   │ Captions:
   │   - Auto-transcribe or use text overlay from brief
   │   - Style to brand (font, color, position, animation)
   │ Pacing:
   │   - Speed ramps on reveals
   │   - Beat sync (cuts aligned to music)
   │ Hook optimization:
   │   - First 1 second gets special attention
   │   - Text hook or visual hook to stop scroll
   │ End screen:
   │   - CTA (text overlay, product tag, or "follow for more")
   │ Platform formatting:
   │   - 9:16 (Reels/TikTok/Stories)
   │   - 1:1 (Feed)
   │   - 16:9 (YouTube)
   │ Thumbnail: extract 3 frames, enhance, Brand Agent picks best
   │
6. FINAL REVIEW (Brand Agent / Creative Director)
   │ Brand consistency ✓
   │ Quality bar ✓
   │ Hook strength ✓
   │ CTA clarity ✓
   │ APPROVED → publishing queue
   │ REJECTED → specific feedback → back to step 5 (or earlier)
```

### Path B: Text-to-Video Direct (Speed Priority)

Best for: daily social content, trend-driven posts, high volume where speed > perfection.

```
1. QUICK BRIEF (Video Agent or Social Media Agent)
   │ Concept, mood, duration, model selection
   │ Trending audio reference (if applicable)
   │
2. DIRECT GENERATION (Video Agent or sub-agent)
   │ Text-to-video using Kling 3.0 (default for social volume)
   │ Generate 3-5 variations
   │
3. SELECT + LIGHT EDIT (Video Agent)
   │ Pick best variation
   │ Trim to exact duration
   │ Add text overlay / trending audio
   │ Add captions
   │ Format for platform
   │
4. QUICK REVIEW (Brand Agent)
   │ Brand check (quick pass, not deep review)
   │ APPROVED → publishing queue
   │
   Total time: 15-30 minutes from brief to ready
```

## Cost Optimization Strategy

**Draft in cheap, finish in premium.** Use Pika 2.5 or Kling free tier for initial concept testing. Once the concept is approved, produce the final version with the premium model. This saves 60-80% on iteration costs.

**Batch production with sub-agents.** When producing 10+ social videos in a week, the Video Agent writes all briefs, then spawns Haiku sub-agents to handle the API calls in parallel. Video Agent (Opus) reviews all results. This is 3-5x faster and significantly cheaper than sequential production.

---

# SECTION 3: AD CREATIVE WORKFLOW

## The Performance Creative Pipeline

The research reveals that the best-performing ads in 2026 don't look like ads. They look like native social content — UGC-style, authentic, casual. This changes how EVE produces ad creative.

```
1. RESEARCH (Ads Agent + Analytics Agent)
   │ Analyze competitor ads (Meta Ad Library, TikTok Creative Center)
   │ Identify winning hooks, formats, and angles in the niche
   │ Review own floor's top-performing organic content
   │ Identify which product benefits convert best
   │
2. CREATIVE STRATEGY (Ads Agent + Brand Agent)
   │ Define 3-5 creative angles to test
   │ Each angle gets multiple executions:
   │   - Hook variations (different first 1-2 seconds)
   │   - Format variations (video, image, carousel)
   │   - Copy variations (different headlines, CTAs)
   │
3. BATCH PRODUCTION (parallel)
   │
   │ FOR EACH ANGLE:
   │   Copy Agent → 3 headline variations + 3 body copy variations
   │   Design Agent → 3 image ad variations (Nano Banana 2 for speed)
   │   Video Agent → 2 video ad variations:
   │     - Path B for UGC-style (Kling 3.0)
   │     - Path A for product showcase (if needed)
   │
   │ Result: 15-30 ad creative variations per angle
   │ Total: 45-150 variations across all angles
   │
4. QUALITY FILTER (Brand Agent)
   │ Review all variations
   │ Kill anything off-brand or low quality
   │ Approve the top performers from each angle
   │ Result: 20-50 approved variations
   │
5. CAMPAIGN BUILD (Ads Agent)
   │ Pair creative + copy into ad units
   │ Build campaign structure:
   │   Campaign (per angle) → Ad Sets (per audience) → Ads (creative variations)
   │ Define audiences:
   │   - Broad interest targeting
   │   - Lookalike audiences (from customer list)
   │   - Retargeting (site visitors, cart abandoners)
   │ Set budgets within approved limits
   │ Create as PAUSED → Gate 3 approval
   │
6. TESTING (post-activation)
   │ Run all variations simultaneously
   │ After 48-72 hours: kill losers, scale winners
   │ Winning creative gets more budget
   │ Losing angles get new creative (back to step 3)
   │
7. CREATIVE REFRESH (ongoing)
   │ Monitor for fatigue signals:
   │   - CTR declining 3+ days
   │   - Frequency above 3.0
   │   - Conversion rate dropping
   │ When fatigue detected:
   │   - Request new creative from production pipeline
   │   - New variations launched alongside old
   │   - Old paused once new proves performance
```

## UGC-Style Ad Production

The highest-converting ad format in 2026. Feels like a real person talking about the product, not a polished brand ad.

```
SCRIPT (Copy Agent)
  │ Hook → Problem → Solution → Social Proof → CTA
  │ Written in conversational, first-person voice
  │ 15-30 seconds for social, 30-60 seconds for retargeting
  │
PRODUCTION OPTIONS:
  │
  ├── Option A: AI Avatar (fastest, cheapest)
  │   Use Kling 3.0 lip sync or dedicated UGC platform
  │   Select avatar matching target demographic
  │   Generate multiple demographic variations for testing
  │
  ├── Option B: AI-Generated UGC-style (medium)
  │   Kling 3.0 text-to-video with UGC-style prompt
  │   Intentionally slightly imperfect (matches casual UGC aesthetic)
  │   Add jump cuts, B-roll, captions in post-production
  │
  └── Option C: Product-focused with voiceover (premium feel)
      Generate product footage via Runway Gen-4.5
      Add ElevenLabs voiceover
      Styled captions + music
      More polished but still native-feeling

POST-PRODUCTION (all options):
  - Add captions (styled, animated — 85% watch without sound)
  - Add background music (subtle, not overpowering)
  - Platform formatting (9:16 for TikTok/Reels, 1:1 for feed)
  - Hook optimization (first 1 second must stop scroll)
```

---

# SECTION 4: SOCIAL MEDIA CONTENT WORKFLOW

## Platform-Specific Production Rules

### Instagram
```
REELS (primary reach driver):
  - 7-15 seconds optimal (hook in first 1 second)
  - 9:16 vertical
  - Captions always on
  - Music: trending audio when relevant, brand music otherwise
  - Style: aspirational, aesthetic, satisfying
  - Post 1/day minimum

CAROUSELS (highest save rate):
  - 7-10 slides
  - Slide 1: hook/curiosity (determines if they swipe)
  - Slides 2-9: value delivery
  - Slide 10: CTA + follow prompt
  - Consistent visual template per brand
  - Post 3/week

STORIES (engagement driver):
  - Behind-the-scenes, polls, questions, urgency
  - Less polished, more authentic
  - 3-5/day
  - Use interactive stickers (polls, quizzes, countdowns)

FEED POSTS (brand credibility):
  - High-quality, on-brand visuals
  - Longer captions with value
  - 2/week
```

### TikTok
```
- Trend-first: monitor what's working NOW
- Hook in first 1 second (text hook or visual hook)
- Native feel: NOT polished ads
- 15-30 seconds optimal
- Raw, authentic, storytelling format
- Post 1-2/day
- Use trending audio AGGRESSIVELY
- Captions always on (styled to trend)
- Pattern interrupts: zoom, cut, transition every 2-3 seconds
```

### Facebook
```
- Longer storytelling format (30-60 seconds video, longer captions)
- Emotional triggers work best
- Community-building content
- 35+ demographic skews here
- Retargeting gold (best platform for warm audiences)
- 1 post/day
- Videos: 16:9 or 1:1
```

## The Content Calendar System

```
WEEKLY CALENDAR STRUCTURE:

Monday:
  - Instagram: Reel (motivational/hook) + Story series + Feed post
  - TikTok: Trend-based video + educational video
  - Facebook: Story post + community question

Tuesday:
  - Instagram: Carousel (educational) + Reel + Stories
  - TikTok: Product showcase + behind-the-scenes

Wednesday:
  - Instagram: Reel (product-focused) + Stories + Feed post
  - TikTok: Trend video + satisfying/ASMR
  - Facebook: Value post + retargeting content

Thursday:
  - Instagram: Carousel (social proof/reviews) + Reel + Stories
  - TikTok: UGC-style + trend video

Friday:
  - Instagram: Reel (weekend energy) + Feed post + Stories
  - TikTok: Behind-the-scenes + fun/personality
  - Facebook: Weekend promotion + story

Saturday-Sunday:
  - Lighter posting (1 per platform)
  - Stories only on Instagram
  - Engagement focus: respond to all comments/DMs

CONTENT MIX TARGET:
  - 40% value/educational (earns trust)
  - 25% entertainment/trend (earns reach)
  - 20% product/selling (earns revenue)
  - 15% community/engagement (earns loyalty)
```

## The Engagement Flywheel

```
POST goes live
  │
  ├── FIRST 60 MINUTES (critical algorithm window)
  │   Social Media Agent monitors ALL incoming engagement
  │   Responds to every genuine comment in brand voice
  │   Likes all genuine comments
  │   Extends conversations with follow-up questions
  │   Priority: purchase-intent comments first
  │
  ├── FIRST 24 HOURS
  │   Continue monitoring and responding
  │   Track: views, engagement rate, saves, shares
  │   If post performs well → boost with paid (Spark Ad on TikTok)
  │
  ├── DM FOLLOW-UP
  │   Product questions → answer + product link
  │   Purchase intent → guide to checkout
  │   Warm leads → follow up if no conversion in 24h
  │   Complaints → acknowledge + escalate to you
  │
  └── PERFORMANCE TRACKING
      Analytics Agent tracks: views, engagement, saves, shares,
      clicks, conversions, revenue attributed
      Feeds back to next week's content planning
```

---

# SECTION 5: GRAPHIC DESIGN WORKFLOW

## Brand Asset Production

```
FOUNDATION (during brand creation):
  │
  ├── Logo options (3 variations)
  │   Model: Recraft V4 (SVG, vector-native)
  │   Export: SVG for scalability + PNG for social
  │
  ├── Color palette
  │   Primary, secondary, accent colors with hex codes
  │   Light and dark mode variants
  │
  ├── Typography
  │   Heading font + body font
  │   Web-safe or Google Fonts for web use
  │
  ├── Visual style guide
  │   Photography style (warm, cool, high-contrast, minimal)
  │   Illustration style (if applicable)
  │   Composition rules (rule of thirds, negative space)
  │   What the brand looks like vs. what it does NOT
  │
  └── Template library
      Social post templates (per platform, per content type)
      Email template
      Ad creative templates
      Story template
      Carousel template

ONGOING PRODUCTION:
  │
  ├── Social graphics
  │   Model: Nano Banana 2 for speed, Midjourney for hero pieces
  │   Always start from brand templates
  │   Consistent color grading, typography, layout
  │
  ├── Product mockups
  │   Model: Flux 2 Max for photorealism
  │   Products on models, in lifestyle settings, flat lays
  │   Multiple angles per product
  │
  ├── Ad creative
  │   Model: varies by format (see Ad Creative section)
  │   Always A/B test: imagery, text, layout, CTA placement
  │
  └── Website visuals
      Hero images: Midjourney or Flux 2 Max
      Product images: Flux 2 Max
      Icons: Recraft V4 (SVG)
      Background textures: Nano Banana 2
```

## The Design Review Loop

Every visual output goes through this before use:

```
GENERATED → DESIGN AGENT self-review → BRAND AGENT review
  │
  Brand Agent checks:
  ├── Color palette match? (exact hex, not "close enough")
  ├── Typography correct? (right fonts, weights, sizes)
  ├── Composition intentional? (rule of thirds, balance, hierarchy)
  ├── Mood match? (does it FEEL like the brand?)
  ├── Platform appropriate? (right size, right energy for platform)
  ├── Text readable? (if text in image — check spelling, contrast)
  └── Top 1% standard? (would this stop a scroll? would you save it?)
  
  APPROVED → use
  REJECTED → specific feedback (not vague — "the blue is too saturated, 
             use #2E75B6 not #4488CC" or "the composition feels cluttered,
             add more negative space on the left")
```

---

# SECTION 6: QUALITY STANDARDS

## What "Top 1%" Actually Means

These are the specific, measurable criteria that separate excellent content from good content:

**Visual quality:**
- Color grading is intentional and consistent (not default filters)
- Typography is readable, on-brand, and adds visual weight
- Compositions follow cinematic rules (rule of thirds, leading lines, negative space)
- Every element is designed, nothing is an afterthought
- Thumbnails work at small sizes (phone screen in a feed)

**Video quality:**
- Hook in first 1 second (viewer decides to watch or scroll)
- Pacing matches the energy (fast cuts for excitement, slow for luxury)
- Audio is clean and intentional (music matches mood, voiceover is clear)
- Captions are styled and timed, not generic auto-generated
- Transitions feel intentional, not random
- The video loops well (for Reels/TikTok)

**Copy quality:**
- Hook line creates curiosity or emotion (not clickbait)
- Voice matches the platform (casual on TikTok, aspirational on Instagram)
- CTA is clear but not aggressive ("Link in bio" not "BUY NOW")
- Hashtags are researched, not generic
- No AI-sounding phrases (no "in today's fast-paced world" or "let's dive in")

**Ad creative quality:**
- Feels native to the platform (not obviously an ad)
- Product benefits are clear within first 3 seconds
- Social proof is present when possible
- Multiple variations exist for testing
- Creative refreshes happen before fatigue sets in

---

# SECTION 7: COST OPTIMIZATION

## Creative Production Cost Targets

| Content Type | Target Cost | How |
|---|---|---|
| Social image post | $0.05-0.15 | Nano Banana 2 + branded template |
| Carousel (10 slides) | $0.30-0.80 | Nano Banana 2 batch + template |
| Social video (Path B) | $0.30-1.00 | Kling 3.0 + light edit |
| Hero video (Path A) | $1.50-4.00 | Veo 3.1 or Runway + full post-production |
| Ad image creative | $0.05-0.15 | Nano Banana 2 + ad template |
| Ad video creative (UGC) | $0.50-2.00 | Kling 3.0 + captions + music |
| Product photography set | $0.30-1.00 | Flux 2 Max × 5-10 angles |
| Logo/brand mark | $0.20-0.50 | Recraft V4 (3 variations) |

## The 80/20 Rule for Model Spending

- 80% of content uses fast/cheap models (Nano Banana 2, Kling 3.0, Pika 2.5)
- 20% of content uses premium models (Veo 3.1, Runway, Midjourney, Flux 2 Max)
- The 20% is hero content, key ad creative, and brand-defining visuals
- The 80% is daily social, batch production, and iteration

**Monthly creative production budget target (per floor):**
- Image generation: $15-30
- Video generation: $30-80
- Audio (voiceover): $5-15
- Total creative API costs: $50-125/month

This is separate from agent API costs (Anthropic) and ad spend.
