/**
 * Design Styles Knowledge Base — sourced from Awwwards, UX Planet, and industry research.
 * Used by the Design Agent and website-homepage prompt to select appropriate styles.
 */

export interface DesignStyleGuide {
  style: string;
  typography: { heading: string; body: string; scale: string; weight: string; letterSpacing: string };
  colors: { base: string; accent: string; approach: string };
  layout: string;
  cssHints: string;
  bestFor: string[];
}

/** Map brand personality keywords → recommended design style */
export function selectDesignStyle(brandType: string, personality: string, audience: string): string {
  const input = `${brandType} ${personality} ${audience}`.toLowerCase();

  if (input.match(/luxur|premium|high.end|elegant|refin|sophisticat/)) return 'luxury-minimalist';
  if (input.match(/organic|natural|eco|sustain|clean.beauty|wellness/)) return 'organic-minimal';
  if (input.match(/street|urban|bold|edgy|rebel|youth|gen.?z/)) return 'bold-maximalist';
  if (input.match(/tech|startup|saas|app|digital|ai/)) return 'modern-tech';
  if (input.match(/artisan|craft|handmade|heritage|vintage/)) return 'artisanal-warm';
  if (input.match(/playful|fun|kid|bright|cheerful/)) return 'playful-whimsical';
  if (input.match(/clinical|science|medical|pharma|evidence/)) return 'clinical-clean';
  if (input.match(/editorial|magazine|content|story/)) return 'editorial-modern';
  return 'luxury-minimalist'; // safe default for DTC
}

/** Get specific CSS guidance for a design style */
export function getStyleCSS(style: string): string {
  const styles: Record<string, string> = {

    'luxury-minimalist': `/* Luxury Minimalist — Serif + sans-serif pairing, generous whitespace, restrained color */
:root {
  --font-heading: 'Playfair Display', Georgia, serif;
  --font-body: 'Inter', 'Helvetica Neue', sans-serif;
  --font-scale: 1.333; /* Perfect Fourth */
  --letter-spacing-heading: 0.08em;
  --letter-spacing-body: 0.01em;
  --line-height-body: 1.6;
  --section-padding: clamp(64px, 8vw, 120px);
  --max-width: 1200px;
}
/* 8px grid, generous margins, single accent color, high whitespace ratio */
/* Typography carries the design. Headings: light weight (300), uppercase small caps for labels */
/* Hero: full-viewport, centered headline, subtle fade-in, one CTA button */
/* Images: high-quality with subtle overlay or crop-in, no stock photo feel */`,

    'organic-minimal': `/* Organic Minimal — Warm neutrals, nature curves, approachable sans-serif */
:root {
  --font-heading: 'DM Serif Display', Georgia, serif;
  --font-body: 'Nunito Sans', 'Segoe UI', sans-serif;
  --color-base: #FAF8F3; /* warm cream */
  --color-text: #2C2C2C;
  --color-accent: #6B8E6F; /* sage green */
  --section-padding: clamp(48px, 6vw, 96px);
}
/* Soft border-radius (12-20px), earthy palette, nature imagery */
/* Curved section dividers (SVG waves), organic shapes */
/* Labels in muted uppercase, body in warm readable sans-serif */`,

    'bold-maximalist': `/* Bold Maximalist — High energy, saturated colors, strong typography */
:root {
  --font-heading: 'Space Grotesk', 'Impact', sans-serif;
  --font-body: 'Inter', sans-serif;
  --letter-spacing-heading: -0.02em; /* tight for impact */
}
/* Color blocking, asymmetric layouts, overlapping elements */
/* Large type (60-100px headlines), high contrast, dynamic energy */
/* Mobile: stack aggressively, maintain bold proportions */`,

    'modern-tech': `/* Modern Tech — Clean geometric sans-serif, functional, performance-first */
:root {
  --font-heading: 'Inter', 'SF Pro Display', sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-scale: 1.2; /* Minor Third */
  --color-base: #FFFFFF;
  --color-accent: #0066FF; /* electric blue */
}
/* Strict 8px grid, functional spacing, glass effects optional */
/* Feature cards with subtle shadows, clean iconography */`,

    'clinical-clean': `/* Clinical Clean — Science-meets-luxury, precision typography, white space */
:root {
  --font-heading: 'Cormorant Garamond', Georgia, serif;
  --font-body: 'Inter', 'Helvetica Neue', sans-serif;
  --color-base: #F5F0E8; /* parchment */
  --color-text: #1A1A1A; /* warm obsidian */
}
/* Evidence-first layout: ingredient lists, clinical data presented elegantly */
/* Thin dividers, precise spacing, restrained color palette (2-3 max) */
/* Trust signals: clean typography, transparent information hierarchy */`,

    'artisanal-warm': `/* Artisanal Warm — Handmade feel, warm tones, craft textures */
:root {
  --font-heading: 'Libre Baskerville', Georgia, serif;
  --font-body: 'Source Sans Pro', sans-serif;
  --color-base: #F9F5F0; /* warm linen */
  --color-accent: #8B6F47; /* warm brown */
}
/* Textured backgrounds (subtle grain), warm earth tones */
/* Asymmetric editorial layouts, story-driven sections */`,

    'editorial-modern': `/* Editorial Modern — Magazine-style, typography-driven, staggered grid */
:root {
  --font-heading: 'Playfair Display', serif;
  --font-body: 'Source Serif Pro', Georgia, serif;
  --font-scale: 1.618; /* Golden Ratio for editorial drama */
}
/* Staggered grid, pull quotes, large feature images */
/* Mix serif heading + serif body for editorial authority */`,

    'playful-whimsical': `/* Playful Whimsical — Rounded, colorful, friendly, approachable */
:root {
  --font-heading: 'Quicksand', 'Comfortaa', sans-serif;
  --font-body: 'Nunito', sans-serif;
  --border-radius: 16px;
}
/* Bright cheerful colors, rounded corners everywhere */
/* Playful illustrations, bouncy hover animations, friendly micro-copy */`,
  };

  return styles[style] || styles['luxury-minimalist'];
}

/** Logo prompt templates by business type */
export const LOGO_PROMPT_TEMPLATES = {
  /** Skincare/wellness: clean, minimal, scientific precision */
  skincare: {
    primary: (name: string, color: string) =>
      `Minimalist wordmark logo. The text "${name}" in clean modern sans-serif typography, lowercase letters, generous letter-spacing. Color: ${color} on pure white background. No symbol, no icon — text only. Flat vector style, no gradients, no shadows, no 3D effects. Professional brand identity suitable for luxury skincare. Centered composition, scalable to favicon size.`,
    icon: (name: string, color: string) =>
      `Minimalist abstract geometric mark for a skincare brand. Single continuous shape — could be a circle, leaf silhouette, or water drop — in ${color}. Simple flat vector, no gradients, no shadows. Clean edges, works at 32x32 pixels. No text. Centered on white background.`,
    model: { primary: 'ideogram', icon: 'recraft' },
  },

  /** Fashion/streetwear: bold, graphic, high energy */
  streetwear: {
    primary: (name: string, color: string) =>
      `Bold wordmark logo. The text "${name}" in strong uppercase sans-serif typography, tight letter-spacing, heavy weight. Color: ${color} on white background. No symbol — text only, flat design. High contrast, graphic impact. Street culture energy without being cliché. Vector style, no gradients.`,
    icon: (name: string, color: string) =>
      `Bold abstract geometric icon mark. Strong angular shape or letterform, ${color}, flat high-contrast design. No text, no gradients, no 3D. Works at 32x32 pixels. Centered on white.`,
    model: { primary: 'ideogram', icon: 'recraft' },
  },

  /** Tech/startup: geometric, futuristic, clean */
  tech: {
    primary: (name: string, color: string) =>
      `Modern tech wordmark logo. The text "${name}" in geometric sans-serif font, clean and precise. Color: ${color} on white background. No icon — text only. Flat minimalist design, no gradients. Tech-forward but approachable. Vector style, scalable.`,
    icon: (name: string, color: string) =>
      `Geometric abstract mark for a tech company. Interconnected shapes or clean geometric form, ${color}. Minimalist flat design, no gradients, no text. Works at 32x32 pixels. Centered on white.`,
    model: { primary: 'ideogram', icon: 'recraft' },
  },

  /** Generic/default: clean professional */
  default: {
    primary: (name: string, color: string) =>
      `Professional minimalist wordmark logo. The text "${name}" in modern clean sans-serif typography. Color: ${color} on white background. No symbol, text only. Flat vector design, no gradients, no shadows, no 3D effects. Centered composition, high legibility at all sizes.`,
    icon: (name: string, color: string) =>
      `Simple abstract geometric icon mark. Single clean shape, ${color}, flat vector style. No text, no gradients. Minimal and bold, works at 32x32 pixels. Centered on white background.`,
    model: { primary: 'ideogram', icon: 'recraft' },
  },
} as const;

/** Classify a business goal into a logo template category */
export function classifyBusiness(goal: string): keyof typeof LOGO_PROMPT_TEMPLATES {
  const g = goal.toLowerCase();
  if (g.match(/skincare|beauty|wellness|cosmetic|serum|moisturiz|cleanser|organic.*skin/)) return 'skincare';
  if (g.match(/streetwear|fashion|apparel|clothing|sneaker|urban/)) return 'streetwear';
  if (g.match(/tech|software|saas|app|ai|platform|startup/)) return 'tech';
  return 'default';
}

/** Website design principles from Awwwards research */
export const WEBSITE_DESIGN_PRINCIPLES = `
AWARD-WINNING WEBSITE DESIGN PRINCIPLES (from Awwwards Sites of the Year research):

TYPOGRAPHY:
- Use a mathematical type scale (1.333 Perfect Fourth for most sites, 1.618 Golden Ratio for editorial)
- Heading: 40-60px desktop, Subheading: 24-36px, Body: 16-20px, Caption: 12-14px
- Line-height: 1.5-1.6 for body text, 1.1-1.2 for headings
- Letter-spacing: 0.08-0.15em for uppercase labels, -0.02em for large display type
- Typography IS the design — make type choices deliberate, not default

HERO SECTIONS:
- Full-viewport heroes with large headline + short description + single CTA
- Transparent navbar overlaying hero that solidifies on scroll = premium feel
- Big, bold imagery creates immediate visual impact
- Subtle scroll-triggered animations (fade-in headlines, parallax backgrounds)

COLOR:
- Rich mood-driven palettes, not trend-chasing — jewel tones, earthy neutrals, nature-inspired
- Minimalist base (black/white/neutral) with strategic bold accent color for maximum impact
- WCAG AA contrast ratios (4.5:1 for body text, 3:1 for large text)

SPACING & GRID:
- 8px base grid — all spacing in multiples (8, 16, 24, 32, 48, 64, 96, 128px)
- Whitespace is intentional — premium brands breathe; crowded design feels cheap
- 12-column grid, 1200-1440px max-width, 24-32px gutters

NAVIGATION:
- Top horizontal bar (5-12 items max), transparent overlaying hero → solid on scroll
- F-pattern or Z-pattern for CTA placement
- Touch-friendly targets: minimum 44x44px

CTA BUTTONS:
- High contrast color against background, minimum 44x44px
- 2-4 words of specific microcopy ("Explore the Formulas" not "Click Here")
- Subtle hover animation (slight rise, color shift)

IMAGES:
- High-quality photography/illustrations as content focus, not decoration
- Color overlays/gradients on images improve text legibility and create depth
- WebP format, lazy loading, srcset for responsive images

MOBILE-FIRST:
- Design for 375px first, progressively enhance
- 60%+ of web traffic is mobile — mobile isn't optional
- One-column layouts on mobile, progressive reveal as width increases
`;
