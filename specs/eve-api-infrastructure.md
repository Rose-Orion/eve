# EVE — API Infrastructure Specification
## Every External Service, How It's Called, What It Costs

---

# OVERVIEW

EVE connects to 5 API providers to power all its capabilities. This document specifies every integration: authentication, endpoints, cost per call, rate limits, failover behavior, and how the Orchestrator's media generation module routes requests.

```
THE API STACK:

  ┌─────────────────────────────────────────────────┐
  │                  ORCHESTRATOR                     │
  │                                                   │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
  │  │ LLM      │  │ Media    │  │ External │       │
  │  │ Router   │  │ Router   │  │ Services │       │
  │  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
  └───────┼──────────────┼─────────────┼─────────────┘
          │              │             │
          ▼              ▼             ▼
    ┌──────────┐   ┌──────────┐  ┌──────────────────┐
    │ Anthropic│   │  fal.ai  │  │ Stripe           │
    │ (Claude) │   │ (images  │  │ ElevenLabs       │
    │          │   │  + video)│  │ Resend            │
    └──────────┘   ├──────────┤  │ Kit (ConvertKit)  │
                   │  OpenAI  │  │ Meta Graph API    │
                   │ (GPT Img)│  │ TikTok API        │
                   └──────────┘  │ Printful          │
                                 │ Late.dev (social) │
                                 └──────────────────┘
```

**API keys managed:** 8 total
**Where stored:** `.env.local` on Mac Mini (never committed to Git)
**Rotation:** Keys rotated quarterly, Orchestrator handles refresh

---

# PROVIDER 1: ANTHROPIC (LLM)

## Purpose
All agent reasoning, creative writing, analysis, and decision-making.

## Access Method
Direct API via OpenClaw. OpenClaw manages sessions, context, and tool use.
The Orchestrator dispatches tasks to OpenClaw, which calls Anthropic.

## Authentication
```
ANTHROPIC_API_KEY=sk-ant-...
```
Single API key. Set in OpenClaw's configuration, not managed by Orchestrator directly.

## Models & Pricing (March 2026)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Use Case |
|---|---|---|---|
| Claude Opus 4.6 | $15.00 | $75.00 | Floor Manager, foundation tasks, complex reasoning |
| Claude Sonnet 4.6 | $3.00 | $15.00 | Copy, web, commerce, social, ads, routine brand/strategy |
| Claude Haiku 4.5 | $0.25 | $1.25 | Analytics, sub-agents, simple lookups |

## Estimated Monthly Cost Per Floor

| Phase | Opus Calls | Sonnet Calls | Haiku Calls | Estimated Cost |
|---|---|---|---|---|
| Foundation Sprint (one-time) | ~50 | ~20 | ~5 | $15-25 |
| Build Phase (5-7 days) | ~100 | ~300 | ~50 | $60-100 |
| Operations (monthly) | ~200 (FM heartbeat) | ~500 | ~200 | $80-150 |

## Rate Limits
```
Tier 1 (default):
  Opus: 2,000 RPM (requests per minute), 300,000 TPM (tokens per minute)
  Sonnet: 2,000 RPM, 300,000 TPM
  Haiku: 2,000 RPM, 300,000 TPM

With EVE's concurrency limits (max 4 agents):
  Typical burst: 10-20 requests/minute
  Well within rate limits for Tier 1
  
  If rate limited:
  → Orchestrator exponential backoff (5s, 10s, 20s, 40s)
  → If Opus limited: downgrade queued Opus tasks to Sonnet temporarily
  → If all models limited: pause dispatches, resume when window resets
```

## Failover
No failover to non-Anthropic models. If Anthropic is down entirely:
→ All agent work pauses
→ Floor Manager sends cached status ("Anthropic API unavailable")
→ Push notification to you
→ Auto-resume when API recovers (health check every 60 seconds)

---

# PROVIDER 2: FAL.AI (Image + Video Generation)

## Purpose
Primary gateway for all image and video generation. One SDK, one API key, access to most models EVE uses.

## Access Method
`@fal-ai/client` npm package (TypeScript SDK)

## Authentication
```
FAL_KEY=fal-...
```

## Setup
```typescript
import { fal } from "@fal-ai/client";

fal.config({
  credentials: process.env.FAL_KEY,
});
```

## Image Models Available on fal.ai

| Model | fal.ai Endpoint | Cost/Image | Best For |
|---|---|---|---|
| Flux 2 Max | `fal-ai/flux-2-max` | ~$0.03-0.05 | Photorealism, product shots, hero images |
| Flux 2 Flex | `fal-ai/flux-2-flex` | ~$0.02-0.04 | General purpose, fast iteration |
| Nano Banana 2 | `fal-ai/nano-banana-2` | ~$0.01-0.02 | Speed-priority, social graphics, batch production |
| Recraft V4 | `fal-ai/recraft-v4` | ~$0.03-0.05 | Logos, vectors, SVG export, brand assets |
| Ideogram 3.0 | `fal-ai/ideogram-v3` | ~$0.03-0.05 | Text-in-images, typography-heavy designs |
| Stable Diffusion XL | `fal-ai/stable-diffusion-xl` | ~$0.01-0.02 | Backgrounds, textures, abstract patterns |

## Video Models Available on fal.ai

| Model | fal.ai Endpoint | Cost/Video | Duration | Best For |
|---|---|---|---|---|
| Kling 3.0 | `fal-ai/kling-video/v3` | ~$0.10-0.30 | 5-15s | Social content, UGC-style, TikTok |
| Kling 2.5 Pro | `fal-ai/kling-video/v2.5/pro` | ~$0.08-0.20 | 5-10s | Budget social content |
| Runway Gen-4.5 | `fal-ai/runway-gen4.5` | ~$0.30-0.80 | 5-10s | Product showcases, hero videos |
| Seedance 2.0 | `fal-ai/seedance-2.0` | ~$0.15-0.40 | 5-10s | Audio+video combined |
| Veo 3.1 | Check availability | ~$0.20-0.50 | 5-15s | Brand story, premium content |

*Note: Exact endpoints and pricing change frequently. Verify on fal.ai/models before implementation.*

## How the Design Agent Calls fal.ai

```typescript
// In the Orchestrator's media generation module:

class MediaGenerator {
  
  async generateImage(request: ImageGenRequest): Promise<ImageResult> {
    // 1. Select model based on task type
    const model = this.selectImageModel(request.taskType);
    
    // 2. Call fal.ai
    const result = await fal.subscribe(model.endpoint, {
      input: {
        prompt: request.prompt,
        image_size: request.dimensions,    // "square_hd", "landscape_16_9", etc.
        num_images: request.variations,     // Usually 3
        enable_safety_checker: true,
        // Model-specific params
        ...(model.extraParams || {}),
      },
      logs: true,
      onQueueUpdate: (update) => {
        // Track progress for dashboard
        this.updateTaskProgress(request.taskId, update);
      },
    });
    
    // 3. Download images to workspace
    const images = [];
    for (const image of result.data.images) {
      const localPath = await this.downloadToWorkspace(
        image.url,
        request.floorSlug,
        request.outputDir,
      );
      images.push(localPath);
    }
    
    // 4. Record cost
    await this.recordCost({
      floorId: request.floorId,
      service: 'fal.ai',
      model: model.name,
      costCents: this.estimateCost(model, request),
      taskId: request.taskId,
    });
    
    return { images, model: model.name };
  }
  
  async generateVideo(request: VideoGenRequest): Promise<VideoResult> {
    const model = this.selectVideoModel(request.taskType, request.sourceType);
    
    const input: any = {
      prompt: request.prompt,
      duration: request.durationSeconds || 10,
    };
    
    // Image-to-video (Path A) vs text-to-video (Path B)
    if (request.sourceType === 'image-to-video' && request.sourceImageUrl) {
      input.image_url = request.sourceImageUrl;
    }
    
    const result = await fal.subscribe(model.endpoint, {
      input,
      logs: true,
      onQueueUpdate: (update) => {
        this.updateTaskProgress(request.taskId, update);
      },
    });
    
    const videoPath = await this.downloadToWorkspace(
      result.data.video.url,
      request.floorSlug,
      request.outputDir,
    );
    
    await this.recordCost({
      floorId: request.floorId,
      service: 'fal.ai',
      model: model.name,
      costCents: this.estimateCost(model, request),
      taskId: request.taskId,
    });
    
    return { videoPath, model: model.name };
  }
  
  // MODEL SELECTION LOGIC
  private selectImageModel(taskType: string): ModelConfig {
    const routing: Record<string, ModelConfig> = {
      'product-hero':       { name: 'Flux 2 Max', endpoint: 'fal-ai/flux-2-max' },
      'product-mockup':     { name: 'Flux 2 Max', endpoint: 'fal-ai/flux-2-max' },
      'social-graphic':     { name: 'Nano Banana 2', endpoint: 'fal-ai/nano-banana-2' },
      'social-batch':       { name: 'Nano Banana 2', endpoint: 'fal-ai/nano-banana-2' },
      'logo':               { name: 'Recraft V4', endpoint: 'fal-ai/recraft-v4' },
      'brand-asset':        { name: 'Recraft V4', endpoint: 'fal-ai/recraft-v4' },
      'text-heavy':         { name: 'GPT Image 1.5', endpoint: 'OPENAI_DIRECT' },
      'scripture-design':   { name: 'GPT Image 1.5', endpoint: 'OPENAI_DIRECT' },
      'background':         { name: 'SDXL', endpoint: 'fal-ai/stable-diffusion-xl' },
      'ad-creative':        { name: 'Flux 2 Flex', endpoint: 'fal-ai/flux-2-flex' },
      'mood-board':         { name: 'Flux 2 Flex', endpoint: 'fal-ai/flux-2-flex' },
      'thumbnail':          { name: 'Nano Banana 2', endpoint: 'fal-ai/nano-banana-2' },
    };
    return routing[taskType] || routing['social-graphic']; // default to fast/cheap
  }
  
  private selectVideoModel(taskType: string, sourceType: string): ModelConfig {
    const routing: Record<string, ModelConfig> = {
      'product-showcase':   { name: 'Runway Gen-4.5', endpoint: 'fal-ai/runway-gen4.5' },
      'brand-story':        { name: 'Runway Gen-4.5', endpoint: 'fal-ai/runway-gen4.5' },
      'social-reel':        { name: 'Kling 3.0', endpoint: 'fal-ai/kling-video/v3' },
      'tiktok-content':     { name: 'Kling 3.0', endpoint: 'fal-ai/kling-video/v3' },
      'ugc-style':          { name: 'Kling 2.5 Pro', endpoint: 'fal-ai/kling-video/v2.5/pro' },
      'ad-video':           { name: 'Kling 3.0', endpoint: 'fal-ai/kling-video/v3' },
      'hero-video':         { name: 'Runway Gen-4.5', endpoint: 'fal-ai/runway-gen4.5' },
    };
    return routing[taskType] || routing['social-reel'];
  }
}
```

## Rate Limits & Queuing
```
fal.ai handles queuing internally.
The fal.subscribe() call waits for the result (polling under the hood).

Concurrency: fal.ai allows multiple concurrent requests.
EVE's limit: max 3 concurrent media generation requests
(prevents cost spikes and respects downstream provider limits)

Timeout: 5 minutes per image, 10 minutes per video
If timeout → retry once → if still timeout → fail task
```

---

# PROVIDER 3: OPENAI (GPT Image 1.5 Only)

## Purpose
Text-in-image generation ONLY. Used when the design requires readable text in the image (scripture on shirts, text overlays, typographic designs). Not used for LLM reasoning.

## Access Method
Direct OpenAI API call from the Orchestrator's media module.

## Authentication
```
OPENAI_API_KEY=sk-...
```

## Endpoint
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateTextImage(prompt: string, size: string): Promise<string> {
  const response = await openai.images.generate({
    model: "gpt-image-1.5",
    prompt: prompt,
    n: 1,
    size: size,              // "1024x1024", "1792x1024", etc.
    quality: "hd",
    response_format: "url",
  });
  return response.data[0].url;
}
```

## Cost
~$0.04-0.08 per image (HD quality, 1024x1024)

## When to Use vs fal.ai
```
ROUTING RULE:
  Does the image need readable text (words, scripture, brand name)?
    YES → GPT Image 1.5 (OpenAI)
    NO  → fal.ai (appropriate model per task type)

EXAMPLES:
  "Walk By Faith" shirt design with scripture text → GPT Image 1.5
  Product mockup of shirt on model → Flux 2 Max (fal.ai)
  Instagram carousel slide with statistics → GPT Image 1.5
  Social post background graphic → Nano Banana 2 (fal.ai)
  Logo with company name → Recraft V4 (fal.ai) — also good at text
```

---

# PROVIDER 4: ELEVENLABS (Voice & Audio)

## Purpose
Voiceovers for video content, brand audio, product demos.

## Access Method
Direct ElevenLabs API.

## Authentication
```
ELEVENLABS_API_KEY=xi-...
```

## Endpoint
```typescript
async function generateVoiceover(
  text: string, 
  voiceId: string
): Promise<Buffer> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );
  return Buffer.from(await response.arrayBuffer());
}
```

## Cost
~$0.15-0.30 per 1,000 characters (Starter plan: $5/month for 30,000 chars)

## Brand Voice Setup
During Foundation Sprint, the Brand Agent selects a voice from ElevenLabs' library (or clones a custom voice if you provide a sample). Voice ID is stored in the floor's brand config and used for all voiceover generation.

---

# PROVIDER 5: EXTERNAL SERVICES (Commerce & Marketing)

These are documented in their respective workflow specs. Summary here for reference.

## Stripe (Payments)
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

Used by: Web Agent (checkout), Orchestrator (webhook processing)
Calls: Checkout Sessions, Webhooks, Payment Intents
Cost: 2.9% + $0.30 per transaction (no monthly fee)
```

## Resend (Transactional Email)
```
RESEND_API_KEY=re_...

Used by: Orchestrator (order confirmation, shipping notifications)
Calls: POST /emails
Cost: Free for 100 emails/day, $20/month for 50,000 emails/month
```

## Kit / ConvertKit (Marketing Email)
```
KIT_API_KEY=...
KIT_API_SECRET=...

Used by: Commerce Agent (subscriber management, automation triggers)
Calls: Subscribers, Tags, Sequences, Broadcasts
Cost: Free for 10,000 subscribers, $29/month for advanced automation
```

## Meta Graph API (Social Publishing + Ads)
```
META_ACCESS_TOKEN=... (long-lived, 60-day, auto-refreshed)
META_APP_ID=...
META_APP_SECRET=...
META_PIXEL_ID=...
META_AD_ACCOUNT_ID=act_...

Used by: Social Media Agent (publishing), Ads Agent (campaigns), 
         Web Agent (Conversions API)
Calls: Content Publishing, Comments, Insights, Marketing API, CAPI
Cost: Free (API access), paid (ad spend)
Rate limit: 200 calls/user/hour (Graph API), varies for Marketing API
```

## TikTok Content Posting API
```
TIKTOK_CLIENT_KEY=...
TIKTOK_CLIENT_SECRET=...
TIKTOK_ACCESS_TOKEN=... (OAuth, requires refresh)

Used by: Social Media Agent (publishing)
Calls: Content Posting (Direct Post), Creator Info
Cost: Free (API access)
Rate limit: 6 requests/minute per user token
```

## TikTok Marketing API
```
TIKTOK_ADS_ACCESS_TOKEN=...
TIKTOK_ADVERTISER_ID=...

Used by: Ads Agent (TikTok campaign management)
Calls: Campaign, Ad Group, Ad creation and management
Cost: Free (API access), paid (ad spend)
```

## Printful (Print on Demand)
```
PRINTFUL_API_KEY=...

Used by: Commerce Agent (product creation, order forwarding)
Calls: Products, Orders, Mockup Generator, Shipping
Cost: Free (API access), paid (per-order fulfillment)
Rate limit: 120 requests/minute
```

## Late.dev (Unified Social Publishing) — OPTIONAL
```
LATE_API_KEY=...

Alternative to direct Meta + TikTok APIs.
Unified endpoint for all social platforms.
Cost: ~$0.01-0.05 per post
Benefit: One integration instead of two
Tradeoff: Less control, added dependency
Decision: Start with direct APIs. Switch to Late.dev if managing 
          multiple platform APIs becomes too complex.
```

---

# API KEY MANAGEMENT

```
STORAGE:
  All keys in __PATH_EVE_PROJ__.env.local (root level, shared across floors)
  File permissions: 600 (owner read/write only)
  Never committed to Git (.gitignore entry)

ROTATION SCHEDULE:
  Anthropic: rotate quarterly (or if compromised)
  fal.ai: rotate quarterly
  OpenAI: rotate quarterly
  ElevenLabs: rotate quarterly
  Stripe: rotate annually (or if compromised)
  Meta: auto-refreshes every 60 days (Orchestrator handles this)
  TikTok: OAuth refresh flow (Orchestrator handles this)
  Printful: rotate annually
  
AUTO-REFRESH (Orchestrator handles):
  Meta long-lived token: refresh 7 days before expiry
  TikTok OAuth: refresh when token nears expiry
  If refresh fails → push notification to you with manual steps

MONITORING:
  Orchestrator checks all API keys on startup
  Daily health check: make a lightweight call to each provider
  If any key fails → push notification: "API key for [service] is invalid"
  Dashboard Settings → API Keys shows status: ✅ Valid | ❌ Invalid | ⚠️ Expiring
```

---

# COST TRACKING

```
EVERY API CALL IS TRACKED:

  The Orchestrator's cost tracker records:
  {
    floorId: string,
    service: 'anthropic' | 'fal.ai' | 'openai' | 'elevenlabs' | 'stripe' | 'resend' | 'kit',
    model: string,               // "opus-4.6", "flux-2-max", "kling-3.0", etc.
    endpoint: string,            // The specific API endpoint called
    costCents: number,           // Calculated or estimated cost
    taskId: string,              // Which task triggered this call
    agentRole: string,           // Which agent was responsible
    timestamp: Date,
  }

COST ESTIMATION:
  LLM: calculated from token usage (input_tokens × rate + output_tokens × rate)
  Images: estimated from model pricing (fixed per-image rate)
  Video: estimated from model + duration pricing
  Email: tracked from Resend/Kit usage APIs
  Stripe: calculated from transaction amount × 2.9% + $0.30

BUDGET ENFORCEMENT:
  Before every API call that costs money:
  1. Orchestrator checks: floor budget remaining > estimated cost?
  2. YES → proceed
  3. NO → block the call, notify Floor Manager, push alert to you

DASHBOARD DISPLAY:
  Settings → Costs shows:
  - Total spend by provider (pie chart)
  - Daily spend trend (line chart)
  - Per-agent cost breakdown
  - Per-model cost breakdown
  - Budget remaining with projection: "At current rate, budget lasts X more days"
```

---

# MONTHLY COST PROJECTIONS

## Test Phase (Single Floor, Building)

| Service | Monthly Est. | Notes |
|---|---|---|
| Anthropic (Claude) | $80-150 | FM heartbeat + build tasks |
| fal.ai (images) | $5-15 | ~200-300 images during build |
| fal.ai (video) | $5-20 | ~20-50 videos during build |
| OpenAI (GPT Image) | $2-5 | ~30-50 text-heavy images |
| ElevenLabs | $5 | Starter plan, ~30k chars |
| Resend | $0 | Free tier sufficient |
| Kit | $0 | Free tier sufficient |
| Stripe | $0 | No transactions during build |
| Printful | $0 | No orders during build |
| **Total** | **$97-195** | Within $200 test ceiling |

## Production Phase (Single Floor, Live)

| Service | Monthly Est. | Notes |
|---|---|---|
| Anthropic (Claude) | $100-200 | FM heartbeat + daily operations |
| fal.ai (images) | $15-40 | ~400-800 images/month (content + ads) |
| fal.ai (video) | $15-50 | ~60-100 videos/month |
| OpenAI (GPT Image) | $3-8 | ~50-100 text-heavy images |
| ElevenLabs | $5-22 | Depends on voiceover volume |
| Resend | $0-20 | Based on order volume |
| Kit | $0-29 | Based on subscriber count |
| Stripe | Variable | 2.9% + $0.30 per sale |
| Printful | Variable | Per-order (built into margins) |
| Ad spend | $300-1,500 | Your budget choice |
| **Total (ex. ads)** | **$138-369** | |
| **Total (inc. ads)** | **$438-1,869** | |

---

# COMMERCIAL LICENSING FOR AI-GENERATED IMAGES

EVE puts AI-generated designs on physical products for sale. All models used must be cleared for commercial use.

```
CLEARED FOR COMMERCIAL USE ON PHYSICAL PRODUCTS:

  Flux 2 (via fal.ai)         ✅ Black Forest Labs allows commercial use
  Nano Banana 2 (via fal.ai)  ✅ Google Gemini terms allow commercial use
  Recraft V4 (via fal.ai)     ✅ Commercial license included
  Ideogram 3.0 (via fal.ai)   ✅ Commercial use allowed on paid plans
  SDXL (via fal.ai)           ✅ Open license, commercial use allowed
  GPT Image 1.5 (OpenAI)      ✅ OpenAI terms grant commercial rights to output
  Kling (video, via fal.ai)   ✅ Commercial use on paid API access
  Runway (video, via fal.ai)  ✅ Commercial use on paid plans

  IMPORTANT: fal.ai is the access layer, not the licensor.
  Commercial rights come from the MODEL PROVIDER's terms, not fal.ai's.
  Each model's license should be verified at integration time as terms evolve.

WHAT THE COMMERCE AGENT SHOULD FLAG:
  - If any model's terms change, flag to Floor Manager
  - All generated images used on products should be logged (design ID, model used)
  - If a customer claims copyright infringement on a design, the log enables investigation
```

---

# NETWORK REQUIREMENTS

```
MAC MINI MUST HAVE:
  - Stable internet connection (wired ethernet recommended)
  - No firewall blocking outbound HTTPS (port 443)
  - Sufficient bandwidth for video uploads/downloads
  
OUTBOUND CONNECTIONS (whitelist if using firewall):
  api.anthropic.com          (Anthropic LLM)
  api.fal.ai                 (Image + video generation)
  api.openai.com             (GPT Image)
  api.elevenlabs.io          (Voice)
  api.stripe.com             (Payments)
  api.resend.com             (Transactional email)
  api.convertkit.com         (Marketing email)
  graph.facebook.com         (Meta Graph API)
  graph.instagram.com        (Instagram)
  rupload.facebook.com       (Meta video upload)
  open.tiktokapis.com        (TikTok)
  api.printful.com           (Print on demand)
  *.supabase.co              (Database)
  api.vercel.com             (Hosting/deployment)
  
  NO inbound connections required.
  EVE is a client, not a server (except for the Dashboard API 
  which runs on localhost and is accessed via Tailscale or local network).
```
