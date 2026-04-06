/**
 * Knowledge Library loader — loads on-demand reference files for deep domain knowledge.
 * Located at ~/.openclaw/knowledge/ with categories:
 * business/, brand/, pricing/, marketing/, ecommerce/, playbooks/
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { countTokens, truncateToTokens } from './token-counter.js';

const KNOWLEDGE_DIR = join(process.env['HOME'] ?? '/Users/automation', '.openclaw', 'knowledge');
const MAX_FILES_PER_TASK = 2;
const MAX_TOKENS_PER_FILE = 2000;

export interface KnowledgeFile {
  category: string;
  name: string;
  content: string;
  tokenCount: number;
}

/**
 * Embedded fallback knowledge — used when markdown files don't yet exist on disk.
 * These provide minimal but useful domain knowledge so the knowledge injection
 * isn't a complete no-op before the knowledge library is populated.
 */
const FALLBACK_KNOWLEDGE: Record<string, string> = {
  'design/design-styles.md': 'Design Styles: Minimalist (clean, whitespace-heavy, limited palette), Bold/Maximalist (saturated colors, large type, layered), Organic (earth tones, natural textures, rounded shapes), Tech/Modern (geometric, gradients, dark mode), Luxury (serif fonts, muted tones, generous spacing), Playful (bright colors, illustrations, hand-drawn elements). Match style to brand personality and target demographic.',
  'design/ui-patterns.md': 'UI Patterns: Hero section (full-width image/video + headline + CTA), Social proof bar (logos or testimonials), Feature grid (3-4 cards with icons), Product showcase (lifestyle images + quick-add), Trust signals (guarantees, secure checkout badges, reviews), Sticky nav + mobile hamburger, Above-the-fold CTA visibility, F-pattern and Z-pattern layouts for scanning.',
  'marketing/hook-formulas.md': 'Hook Formulas: PAS (Problem-Agitation-Solution), AIDA (Attention-Interest-Desire-Action), BAB (Before-After-Bridge), 4Ps (Promise-Picture-Proof-Push), Question hooks ("Did you know...?"), Contrast hooks ("Most people X, but Y"), Number hooks ("7 ways to..."), Story hooks (mini-narrative in first line).',
  'marketing/copywriting-frameworks.md': 'Copywriting Frameworks: Features→Benefits→Outcomes (translate specs to impact), Voice of Customer (mirror their language), One Reader principle (write to one person), Specificity (numbers > vague claims), Social proof integration, Objection handling in copy, Power words by emotion (urgency, trust, curiosity, exclusivity), CTA clarity (one action per section).',
  'marketing/ad-frameworks.md': 'Ad Frameworks: UGC-style (authentic, phone-shot aesthetic), Problem-Solution (2-3s hook → pain → product → result), Testimonial (real customer quote + visual), Comparison (before/after or us-vs-them), Demo (product in action, close-up), Unboxing (anticipation → reveal). Platform specs: Meta 1:1 or 9:16, TikTok 9:16 vertical, max 30s for cold traffic.',
  'marketing/social-playbook.md': 'Social Playbook: Content pillars (educational 40%, entertaining 30%, promotional 20%, community 10%), Posting cadence (1-2x/day Instagram, 3-5x/day TikTok), Hashtag strategy (3-5 niche + 2-3 broad), Engagement triggers (questions, polls, hot takes), Caption structure (hook line → value → CTA), Carousel best practices (bold first slide, swipe motivation).',
  'marketing/platform-best-practices.md': 'Platform Best Practices: Meta Ads — broad targeting for prospecting, 3-5 creatives per ad set, CBO budgets, 7-day click attribution. TikTok — spark ads for UGC, interest-based targeting, creative refresh every 7-10 days. Email — subject line <50 chars, preview text matters, send Tue-Thu 10am, segment by engagement.',
  'business/market-analysis-frameworks.md': 'Market Analysis: TAM-SAM-SOM sizing, Porter\'s Five Forces, SWOT, Jobs-to-be-Done framework, competitor positioning map (price vs. quality), customer persona development (demographics + psychographics + pain points), market trends (Google Trends, social listening), pricing benchmarks (competitor price survey, willingness-to-pay estimation).',
  'business/pricing-models.md': 'Pricing Models: Cost-plus (COGS × markup), Value-based (willingness to pay), Competitive (match/undercut market), Charm pricing ($X.99), Anchoring (show higher price first), Bundle pricing (perceived savings), Tiered pricing (good-better-best), Free shipping threshold (AOV × 1.3). POD margins: target 40-60% gross margin after COGS + shipping.',
  'business/unit-economics.md': 'Unit Economics: CAC (customer acquisition cost) = ad spend / new customers, LTV (lifetime value) = AOV × purchase frequency × lifespan, LTV:CAC ratio target ≥3:1, Contribution margin = revenue - COGS - shipping - payment fees, Break-even ROAS = 1 / contribution margin %, Payback period = CAC / monthly contribution per customer.',
  'ecommerce/conversion-optimization.md': 'Conversion Optimization: Reduce checkout steps (3 max), guest checkout option, trust badges near CTA, real-time inventory ("only 3 left"), free shipping threshold, exit-intent popup (10% off), cart abandonment email (1h, 24h, 72h), product reviews visible, high-quality lifestyle imagery, mobile-first checkout, express payment (Apple Pay, Google Pay).',
  'ecommerce/product-page-best-practices.md': 'Product Page Best Practices: Hero image (lifestyle, not just product), 4-6 images (multiple angles + lifestyle + scale), benefit-driven headline, scannable bullet points (features→benefits), size/variant selector above fold, Add to Cart always visible, social proof (reviews, "X people viewing"), related products, FAQ accordion, mobile-optimized image gallery.',
  'design/video-production-guide.md': 'Video Production: Hook in first 1-2 seconds (pattern interrupt), 9:16 vertical for social, 16:9 for website hero, text overlays for sound-off viewing, brand colors in first frame, product reveal by second 3, CTA in final 2 seconds, music bed matches brand energy, 15-30s optimal for ads, 60s max for organic social.',
};

/**
 * Load specific knowledge files by path (e.g. "marketing/hook-formulas.md").
 * Tries disk first (~/.openclaw/knowledge/), falls back to embedded knowledge.
 */
export async function loadKnowledgeFiles(filePaths: string[]): Promise<KnowledgeFile[]> {
  const files: KnowledgeFile[] = [];
  const selected = filePaths.slice(0, MAX_FILES_PER_TASK);

  for (const relPath of selected) {
    const fullPath = join(KNOWLEDGE_DIR, relPath);
    let content: string | null = null;
    let fromFallback = false;

    try {
      content = await readFile(fullPath, 'utf-8');
    } catch {
      // Disk file not found — try embedded fallback
      if (FALLBACK_KNOWLEDGE[relPath]) {
        content = FALLBACK_KNOWLEDGE[relPath];
        fromFallback = true;
      }
    }

    if (!content) continue;

    let tokens = await countTokens(content);
    if (tokens > MAX_TOKENS_PER_FILE) {
      content = await truncateToTokens(content, MAX_TOKENS_PER_FILE);
      tokens = MAX_TOKENS_PER_FILE;
    }

    const parts = relPath.split('/');
    files.push({
      category: parts[0] ?? 'unknown',
      name: (parts.slice(1).join('/') || relPath) + (fromFallback ? ' (built-in)' : ''),
      content,
      tokenCount: tokens,
    });
  }

  return files;
}

/**
 * List available knowledge files by category.
 */
export async function listKnowledgeFiles(category?: string): Promise<string[]> {
  const searchDir = category ? join(KNOWLEDGE_DIR, category) : KNOWLEDGE_DIR;
  const results: string[] = [];

  try {
    const entries = await readdir(searchDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(category ? `${category}/${entry.name}` : entry.name);
      } else if (entry.isDirectory() && !category) {
        // Recurse one level into category dirs
        try {
          const subEntries = await readdir(join(searchDir, entry.name));
          for (const sub of subEntries) {
            if (sub.endsWith('.md')) {
              results.push(`${entry.name}/${sub}`);
            }
          }
        } catch { /* skip */ }
      }
    }
  } catch {
    // Knowledge directory doesn't exist yet
  }

  return results;
}

/**
 * Format knowledge files as XML for the system prompt.
 */
export function formatKnowledgeXml(files: KnowledgeFile[]): string {
  if (files.length === 0) return '';

  const inner = files.map(f =>
    `<knowledge_file category="${f.category}" name="${f.name}">\n${f.content}\n</knowledge_file>`
  ).join('\n\n');

  return `<knowledge>\n${inner}\n</knowledge>`;
}
