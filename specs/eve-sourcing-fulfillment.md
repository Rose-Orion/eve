# EVE — Sourcing & Fulfillment Workflow
## How EVE Handles Physical Products From Design to Delivery

---

# THE REALITY CHECK

EVE can research, compare, recommend, and integrate with fulfillment providers. EVE **cannot** physically produce products, negotiate custom manufacturing deals, or create accounts on your behalf. The Commerce Agent gets you 90% of the way and clearly flags where your action is needed.

This document covers the three fulfillment models EVE supports: print-on-demand (POD), dropshipping, and hybrid approaches.

---

# FULFILLMENT MODEL SELECTION

When CEO Mode evaluates a business idea, it determines the best fulfillment model:

```
CEO MODE EVALUATION:

Is the product customizable/personalized (shirts, mugs, posters)?
  → PRINT ON DEMAND (POD)
  
Is the product a commodity you're curating/branding (gadgets, accessories)?
  → DROPSHIPPING
  
Is the product custom-manufactured to your spec?
  → CUSTOM MANUFACTURING (requires more human involvement)
  
Is the product digital (courses, templates, software)?
  → DIGITAL DELIVERY (no fulfillment needed)

RECOMMENDATION FOR EVE v1:
  Start with Print on Demand. It's the lowest-risk, most automated model.
  Zero upfront inventory cost. Zero fulfillment management. API-integrated.
  Perfect for the faith-based urban clothing use case.
```

---

# PRINT ON DEMAND (POD) — PRIMARY MODEL

## Provider Comparison (March 2026)

| Provider | Best For | Base T-Shirt Price | Production Time | API Quality | Branding Options |
|---|---|---|---|---|---|
| **Printful** | Premium branding, white-label | $8.95-12.95 | 2-5 days | Excellent (full REST API) | Custom packaging, neck labels, inserts |
| **Printify** | Lowest prices, provider choice | $5.95-9.95 | 2-7 days (varies by provider) | Good (REST API) | Limited (depends on provider) |
| **Gooten** | Automation, home goods | $7.95-11.95 | 3-5 days | Good (REST API, order routing) | Basic packaging |
| **SPOD** | Fastest production | $6.50-9.50 | 48 hours | Good | Basic |
| **Gelato** | International fulfillment | $7.95-11.95 | 2-5 days | Good | Custom packaging on premium plan |

## EVE's POD Recommendation

**Primary: Printful** — for floors where brand experience matters (premium clothing brands like FaithForge). Best branding options (custom packaging, neck labels), most reliable quality, excellent API.

**Alternative: Printify** — for price-sensitive floors where margin is the priority. Lowest base prices, ability to switch print providers for optimization.

**The Commerce Agent presents the comparison to you during the build phase. You choose the provider. EVE configures the integration.**

## POD Integration Workflow

```
PHASE 1: PROVIDER SETUP (Commerce Agent + You)

  Commerce Agent:
  1. Analyzes the floor's product strategy from Foundation Package
  2. Recommends a POD provider with reasoning:
     "FaithForge is a premium brand. Recommend Printful because:
      - Custom neck labels (removes Gildan/Bella+Canvas branding)
      - Custom packaging inserts (can include faith-based card/message)
      - Consistent quality across all products
      - Strong API for full automation
      Cost impact: $2-4 higher per shirt vs. Printify, but brand 
      experience justifies it for a premium positioning."
  3. Presents comparison table with margin analysis per provider
  
  You:
  1. Review recommendation
  2. CREATE YOUR ACCOUNT on the chosen provider (EVE cannot do this)
  3. Provide API key to EVE via Settings
  4. EVE verifies the connection

PHASE 2: PRODUCT CATALOG SETUP (Commerce Agent + Design Agent)

  Commerce Agent:
  1. Defines the product catalog from Foundation Package:
     - Product types (t-shirts, hoodies, crewnecks, hats)
     - Blank options (which base garments from the provider)
     - Size range (S-3XL)
     - Color options per product
  
  2. Calculates margins per product:
     Base cost (garment + printing) + shipping estimate = total cost
     Selling price (from pricing strategy) - total cost = margin
     
     Example:
     Bella+Canvas 3001 (Unisex Jersey Tee)
     Base: $8.95 + $4.50 DTG print = $13.45
     Shipping: ~$4.99 average
     Total cost: ~$18.44
     Selling price: $34.99
     Margin: $16.55 (47.3%)

  Design Agent:
  1. Creates the actual designs (the art that goes on the products)
     - Uses image generation models (Flux 2 Max for photorealism,
       Midjourney for artistic designs)
     - Creates print-ready files:
       * 300 DPI minimum
       * PNG with transparent background
       * Correct dimensions for each product/print area
       * CMYK color space (some providers require this)
  
  2. Generates product mockups:
     - Shirt designs shown on model mockups
     - Multiple angles (front, back, detail)
     - Uses provider's mockup generator API OR
       generates with AI (Flux 2 Max + product template)
  
  3. Creates 3 variations per design for your review

  YOU review designs in the Review Tab:
  - Swipeable gallery of all designs
  - Each design shown on mockup
  - Approve/reject/request revisions
  - "I love this but make the text bigger"
  - Selected designs move forward

PHASE 3: PRODUCT CREATION VIA API (Commerce Agent)

  For each approved design on each product type:
  
  // Printful API example:
  
  // Step 1: Upload the print file
  POST https://api.printful.com/files
  {
    "url": "https://cdn.faithforge.com/designs/walk-by-faith-front.png",
    "type": "default"  // or "back", "label"
  }
  // Returns: file_id
  
  // Step 2: Create the product
  POST https://api.printful.com/store/products
  {
    "sync_product": {
      "name": "Walk By Faith Tee",
      "thumbnail": "https://cdn.faithforge.com/mockups/walk-by-faith-mockup.png"
    },
    "sync_variants": [
      {
        "variant_id": 4011,  // Bella+Canvas 3001 - Black - S
        "retail_price": 34.99,
        "files": [
          { "id": file_id, "type": "default" }  // Front print
        ]
      },
      {
        "variant_id": 4012,  // Bella+Canvas 3001 - Black - M
        "retail_price": 34.99,
        "files": [
          { "id": file_id, "type": "default" }
        ]
      },
      // ... all size/color variants
    ]
  }
  
  // Step 3: Generate mockups
  POST https://api.printful.com/mockup-generator/create-task/{product_id}
  {
    "variant_ids": [4011, 4012, ...],
    "files": [{ "placement": "front", "image_url": "..." }]
  }
  // Returns: mockup images for each variant
  
  // Step 4: Sync to website
  Commerce Agent updates the Supabase product database
  Web Agent displays products on the website using mockup images

PHASE 4: ORDER FULFILLMENT FLOW (Automated Post-Launch)

  When a customer purchases on the website:
  
  1. STRIPE webhook fires → /api/stripe/webhook/route.ts
  
  2. Next.js API route processes the order:
     a. Create order record in Supabase
     b. Send order to POD provider via API:
  
        // Printful order creation
        POST https://api.printful.com/orders
        {
          "recipient": {
            "name": "Customer Name",
            "address1": "123 Main St",
            "city": "Houston",
            "state_code": "TX",
            "country_code": "US",
            "zip": "77001"
          },
          "items": [
            {
              "sync_variant_id": 123456,
              "quantity": 1,
              "retail_price": "34.99"
            }
          ],
          "retail_costs": {
            "subtotal": "34.99",
            "shipping": "4.99",
            "total": "39.98"
          }
        }
     
     c. Send order confirmation email to customer (via Resend)
     d. Fire analytics conversion event
  
  3. POD provider:
     a. Receives order
     b. Prints the product
     c. Ships to customer
     d. Sends tracking webhook back to EVE
  
  4. EVE receives tracking webhook:
     a. Update order status in Supabase
     b. Send shipping confirmation email to customer with tracking link
  
  5. Delivery confirmed (carrier tracking):
     a. Update order status
     b. Schedule post-delivery email sequence (review request, cross-sell)

  ENTIRE FLOW IS AUTOMATED. No human touches the order.
```

## POD Quality Control

```
BEFORE LAUNCH (Commerce Agent):
  □ Order samples of every product type (YOU pay, ~$15-30 total)
  □ Check print quality (colors match design, no bleeding, crisp details)
  □ Check garment quality (fabric weight, stitching, fit)
  □ Check packaging (if custom — labels, inserts present)
  □ Check shipping time (track from order to delivery)
  □ Flag any issues to Floor Manager
  
  THIS REQUIRES YOUR ACTION:
  - You order the samples through the provider's dashboard
  - You physically inspect them
  - You report back to Floor Manager: approved or issues found

POST-LAUNCH (Commerce Agent monitors):
  - Track return/complaint rates per product
  - If returns exceed 5% on any product → investigate
  - Monitor print provider's status page for outages
  - If provider has quality issues → flag to Floor Manager → consider switching
```

---

# DROPSHIPPING MODEL

For floors selling products not suitable for POD (accessories, gadgets, specialized items).

```
PROVIDER OPTIONS:
  - CJdropshipping (broad catalog, global shipping)
  - AliExpress/1688 via sourcing agents
  - Spocket (US/EU suppliers, faster shipping)
  - Zendrop (curated products, branded packaging)

COMMERCE AGENT'S ROLE:
  1. Research suppliers based on product requirements:
     - Quality standards
     - Shipping times to target market
     - Minimum order quantities
     - Pricing and margin analysis
     - Reviews and reliability scores
  
  2. Present top 3-5 supplier options with:
     - Product photos and specs
     - Unit cost + shipping cost
     - Estimated delivery time
     - Margin at proposed selling price
     - Reliability rating
  
  3. Flag where your action is needed:
     "I've identified 3 suppliers for the phone case line.
      Top recommendation: Supplier X ($3.20/unit, 7-day shipping to US, 4.8/5 rating).
      YOU NEED TO:
      1. Create an account on CJdropshipping
      2. Order 3 samples ($9.60 + shipping)
      3. Inspect quality and approve
      Once approved, I'll configure the API integration."

WHAT EVE HANDLES AUTOMATICALLY:
  ✅ Supplier research and comparison
  ✅ Margin calculation
  ✅ API integration (once you provide credentials)
  ✅ Order forwarding to supplier
  ✅ Tracking updates to customers
  ✅ Email notifications (confirmation, shipping, delivery)
  ✅ Performance monitoring (shipping times, complaint rates)

WHAT REQUIRES YOUR ACTION:
  ❌ Creating accounts on supplier platforms
  ❌ Ordering and inspecting samples
  ❌ Approving suppliers (quality decision)
  ❌ Paying for inventory (if pre-purchasing)
  ❌ Negotiating with suppliers
  ❌ Handling customs/import issues
```

---

# PRODUCT DESIGN WORKFLOW (FOR POD)

This is specific to the faith-based clothing use case but applies to any POD floor.

```
DESIGN PIPELINE:

1. CONCEPT (Brand Agent + Strategy Agent)
   │ Based on Foundation Package:
   │ - Brand themes (faith, scripture, urban, streetwear)
   │ - Target customer aesthetic preferences
   │ - Competitor design analysis (what's selling in the niche)
   │ - Seasonal relevance
   │
   ├── Define design categories:
   │   - Scripture-inspired (direct Bible verse + artistic treatment)
   │   - Symbolic (cross, dove, crown — urban/street style)
   │   - Statement pieces ("Walk by Faith" "Kingdom Minded" etc.)
   │   - Minimalist (subtle faith elements, premium feel)
   │
   └── Create design briefs (10-15 for initial collection):
       Each brief includes:
       - Concept description
       - Text/scripture (if applicable)
       - Visual style (graffiti, clean typography, illustration, abstract)
       - Color palette (must work on the garment colors offered)
       - Print placement (front, back, pocket area)
       - Print area dimensions (per provider specs)
       - Reference images for mood/style

2. GENERATION (Design Agent)
   │
   ├── For each design brief:
   │   Generate using the appropriate model:
   │   - Typography-heavy → GPT Image 1.5 or Ideogram 3.0 (best text rendering)
   │   - Illustration/artistic → Midjourney (best aesthetic quality)
   │   - Photorealistic elements → Flux 2 Max
   │   - Abstract/pattern → Nano Banana 2 (fast iteration)
   │
   ├── Generate 3 variations per brief
   │
   ├── Post-process for print-readiness:
   │   - Upscale to 300 DPI minimum (4500x5400px for standard print area)
   │   - Remove background (transparent PNG)
   │   - Verify color accuracy (will it look right printed on fabric?)
   │   - Check text legibility at print size
   │   - Verify print area fits within provider's template
   │
   └── Deliver to workspace: /design/products/{design-name}/
       - design-front.png (print-ready file)
       - design-back.png (if applicable)
       - mockup-front.png (on garment mockup)
       - mockup-lifestyle.png (lifestyle context shot)
       - design-brief.json (metadata)

3. REVIEW (You via Review Tab)
   │
   ├── Image gallery shows all designs on mockups
   ├── Swipe right to approve, left to reject
   ├── Tap to enlarge, pinch to zoom
   ├── Type feedback: "Love it but make the cross bigger"
   ├── Design Agent revises based on feedback
   │
   └── Final approved set becomes the launch collection
       (aim for 10-15 designs for initial launch)

4. MOCKUP GENERATION (Commerce Agent + Design Agent)
   │
   ├── For each approved design × each product type × each color:
   │   Generate mockup images:
   │   - Option A: Use provider's mockup generator API (fastest, most accurate)
   │   - Option B: AI-generate lifestyle mockups (Flux 2 Max — more creative)
   │   - Best practice: use provider mockups for product pages,
   │     AI mockups for marketing/social content
   │
   └── Each product gets:
       - 3-5 mockup images for the product page
       - 1 lifestyle image for marketing
       - 1 flat lay image for the catalog

5. LISTING (Commerce Agent + Copy Agent + Web Agent)
   │
   ├── Commerce Agent: creates product records with all variants
   ├── Copy Agent: writes product descriptions, size guides, care instructions
   ├── Web Agent: displays products on website with images, pricing, variants
   └── All synced: website ↔ Supabase ↔ POD provider
```

---

# PRICING STRATEGY

```
COMMERCE AGENT PRICING WORKFLOW:

1. CALCULATE BASE COST per product:
   Garment base price (from provider)
   + Printing cost (DTG, sublimation, embroidery — varies)
   + Custom branding cost (neck labels, packaging inserts)
   = Production cost

2. ADD FULFILLMENT COST:
   Shipping to customer (average for target market)
   + Payment processing (Stripe: 2.9% + $0.30)
   + Platform fees (if selling on marketplace)
   = Total cost per unit

3. APPLY PRICING STRATEGY (from Foundation Package):
   
   OPTION A: Keystone markup (2x cost)
   Cost: $18.44 → Price: $36.99 → Margin: 50%
   
   OPTION B: Value-based pricing (what the market will bear)
   Competitor range: $28-55 for similar quality faith streetwear
   Position: mid-premium at $34.99-44.99
   
   OPTION C: Tiered pricing
   Basic tee: $29.99 (entry point, lower margin, drives volume)
   Premium tee: $39.99 (core product, target margin)
   Hoodie: $59.99 (highest margin, premium feel)
   Hat: $24.99 (impulse buy, entry to brand)

4. OPTIMIZE FOR AOV (Average Order Value):
   - Free shipping threshold: set above single-item price
     Example: Free shipping over $60 (encourages 2+ items)
   - Bundle discount: "Any 2 tees for $59.99" (saves $10, increases AOV)
   - Upsell: "Complete the look" — hat + tee bundle

5. PRESENT TO YOU:
   Commerce Agent shows pricing table with:
   - Cost per unit
   - Proposed price
   - Margin ($ and %)
   - Competitor price comparison
   - Recommended AOV optimization tactics
   
   You approve or adjust.

6. MONITOR POST-LAUNCH:
   - Track actual margins (costs can fluctuate)
   - Monitor competitor price changes
   - A/B test prices on less popular items
   - Adjust for seasonal promotions
   - Finance Agent verifies: are actual margins matching projections?
```

---

# SALES TAX

US-based floors selling physical products must collect sales tax in states where they have nexus. Stripe Tax handles this automatically.

```
COMMERCE AGENT SETUP:
  During checkout integration, Commerce Agent flags:
  "This floor sells physical products in the US. You need to collect 
   sales tax. Recommend enabling Stripe Tax ($0.50/transaction).
   
   YOU NEED TO:
   1. Enable Stripe Tax in your Stripe Dashboard → Settings → Tax
   2. Set your business address (determines home-state nexus)
   3. Stripe automatically calculates and collects tax by state
   
   Cost: $0.50 per transaction (added to your Stripe fees)
   Alternative: Manual tax setup per state (complex, not recommended)"

NOTE: Printful also collects sales tax on their end for some states.
Commerce Agent verifies there's no double-taxation by checking both
Stripe Tax and Printful's tax settings during integration.
```

---

# FULFILLMENT MONITORING (Post-Launch)

```
COMMERCE AGENT MONITORS DAILY:

  Production status:
  - Orders submitted to provider
  - Orders in production
  - Orders shipped
  - Average production time (target: under 5 business days)
  
  Shipping status:
  - Orders in transit
  - Orders delivered
  - Average shipping time
  - Any delayed shipments (flag if 2+ days late)
  
  Quality issues:
  - Returns received (track reason: wrong size, quality, damage)
  - Return rate per product (flag if > 5%)
  - Customer complaints about specific products
  - Provider outages or delays
  
  Inventory (for non-POD):
  - Stock levels per SKU
  - Reorder alerts (when stock drops below threshold)
  - Bestseller identification (restock priority)

WEEKLY FULFILLMENT REPORT (to Floor Manager):
  - Orders fulfilled this week
  - Average production time
  - Average delivery time
  - Return/complaint count
  - Any issues or flags
  - Cost analysis: actual fulfillment costs vs. projected

ESCALATION TRIGGERS:
  - Production time exceeds 7 business days → alert Floor Manager
  - Shipping delayed 3+ days beyond estimate → alert + email customer
  - Return rate exceeds 5% on any product → investigate, consider removing
  - Provider outage → pause affected products, notify you
  - Multiple quality complaints about same product → pull from store pending review
```

---

# WHAT EVE CANNOT DO (HUMAN REQUIRED)

These actions require your direct involvement. EVE will flag them clearly and provide instructions, but cannot execute them.

```
ACCOUNT CREATION:
  "You need to create a Printful account at printful.com.
   Steps: 1. Go to printful.com/signup
          2. Create account with your email
          3. Complete business verification
          4. Generate an API key in Settings → API
          5. Enter the API key in EVE Settings for this floor"

SAMPLE ORDERING:
  "I recommend ordering samples before launch.
   Products to sample: [list with links]
   Estimated cost: $XX
   Steps: 1. Log into your Printful dashboard
          2. Place a sample order (samples are discounted)
          3. When they arrive, inspect print quality and fit
          4. Report back: approved or issues"

CUSTOM BRANDING SETUP:
  "To add custom neck labels and packaging inserts:
   Steps: 1. Log into Printful dashboard
          2. Go to Dashboard → Custom branding
          3. Upload the neck label design (I've created it: /design/branding/neck-label.png)
          4. Upload the packaging insert design (/design/branding/insert.pdf)
          5. Confirm branding selections
   Note: Custom branding adds ~$2.50/item to cost. Already factored into pricing."

SUPPLIER NEGOTIATIONS (for dropshipping):
  "For custom pricing or exclusive supplier agreements, you'll need to
   negotiate directly. I've prepared a comparison of your options
   and a recommended approach: /product/supplier-comparison.md"

RETURNS PROCESSING:
  "Customer [name] requested a return for [reason].
   Options: 1. Refund and let them keep the item ($34.99 cost to you)
            2. Send return label via Printful dashboard ($5.99 shipping)
            3. Exchange for different size (forward to provider)
   Recommend option 1 for items under $40 — return shipping costs
   often exceed the item value for POD."
```

---

# SCALING FULFILLMENT

```
AS ORDER VOLUME GROWS:

PHASE 1 (0-100 orders/month):
  - Single POD provider handles everything
  - Commerce Agent monitors quality and speed
  - Simple return process (refund and keep)

PHASE 2 (100-500 orders/month):
  - Consider Printful Growth plan (volume discounts)
  - Set up proper return/exchange process
  - Monitor provider capacity (ensure no delays at volume)
  - Consider adding a second provider as backup

PHASE 3 (500+ orders/month):
  - Evaluate switching to bulk ordering + warehouse
    (buy blanks in bulk, print in bulk, ship from your warehouse)
  - Much higher margins but requires capital and logistics
  - CEO Mode flags this transition point:
    "FaithForge is averaging 600 orders/month. At current margins,
     switching to bulk ordering would save ~$4/unit = $2,400/month.
     This requires ~$5,000 upfront inventory investment.
     Want to explore this option?"
  
  - Alternatively: stay with POD but negotiate volume pricing
  - This is a strategic decision — CEO Mode presents options, you decide
```
