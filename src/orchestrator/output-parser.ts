/**
 * Output Parser — transforms raw agent text output into structured objects
 * for pipeline consumption (AdsPipeline, WebsiteDeployer, FulfillmentPipeline, EmailAutomation).
 */

export interface CampaignPlan {
  campaigns: Array<{
    name: string;
    objective: string;
    dailyBudgetCents: number;
    audiences: Array<{ name: string; targeting: Record<string, unknown> }>;
    creatives: Array<{ angle: string; format: string; headline?: string; body?: string }>;
  }>;
}

export interface WebsiteSpec {
  pages: Array<{ route: string; title: string; sections: string[] }>;
  theme: { primaryColor?: string; fontFamily?: string };
  integrations: string[];
}

export interface ProductCatalog {
  products: Array<{
    name: string;
    description: string;
    variants: Array<{ name: string; price: number; sku?: string }>;
    images: string[];
  }>;
}

export interface EmailSequence {
  name: string;
  trigger: string;
  emails: Array<{
    subject: string;
    delay: string;
    body?: string;
  }>;
}

export type ParsedOutput =
  | { type: 'campaign-plan'; data: CampaignPlan }
  | { type: 'website-spec'; data: WebsiteSpec }
  | { type: 'product-catalog'; data: ProductCatalog }
  | { type: 'email-sequence'; data: EmailSequence }
  | { type: 'raw'; data: string };

/**
 * Parse agent output into structured pipeline objects.
 * Uses generous parsing — extracts JSON blocks or structured sections from freeform text.
 */
export function parseAgentOutput(agentId: string, taskType: string, rawOutput: string): ParsedOutput {
  // Try to extract JSON from the output first
  const jsonMatch = rawOutput.match(/```json\s*([\s\S]*?)```/) ?? rawOutput.match(/\{[\s\S]*\}/);

  // Route to type-specific parser based on agent + task
  if (agentId === 'ads-agent' && taskType.includes('campaign')) {
    return { type: 'campaign-plan', data: parseCampaignPlan(rawOutput, jsonMatch?.[1]) };
  }
  if (agentId === 'web-agent' && (taskType.includes('website') || taskType.includes('page'))) {
    return { type: 'website-spec', data: parseWebsiteSpec(rawOutput, jsonMatch?.[1]) };
  }
  if (agentId === 'commerce-agent' && taskType.includes('product')) {
    return { type: 'product-catalog', data: parseProductCatalog(rawOutput, jsonMatch?.[1]) };
  }
  if (agentId === 'copy-agent' && taskType.includes('email')) {
    return { type: 'email-sequence', data: parseEmailSequence(rawOutput, jsonMatch?.[1]) };
  }

  return { type: 'raw', data: rawOutput };
}

/**
 * Parse campaign plan from agent output.
 * Tries JSON first, falls back to structured text extraction.
 */
function parseCampaignPlan(rawOutput: string, jsonStr?: string): CampaignPlan {
  try {
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object' && 'campaigns' in parsed) {
        return parsed as CampaignPlan;
      }
    }
  } catch {
    // Fall through to regex extraction
  }

  // Fallback: extract from structured text
  const campaigns: CampaignPlan['campaigns'] = [];

  // Look for campaign blocks (e.g., "Campaign: Name" or "## Campaign Name")
  const campaignMatches = rawOutput.match(/(?:Campaign|##|###)\s*:?\s*([^\n]+)/gi) ?? [];

  for (const match of campaignMatches) {
    const name = match.replace(/(?:Campaign|##|###)\s*:?\s*/i, '').trim();
    if (name) {
      // Try to extract budget from surrounding text
      const budgetMatch = rawOutput.match(new RegExp(`${name}[\\s\\S]*?(?:budget|Budget)[\\s:]*\\$?([\\d,]+)`, 'i'));
      const dailyBudgetCents = budgetMatch && budgetMatch[1] ? parseInt(budgetMatch[1].replace(/,/g, ''), 10) * 100 : 50000;

      campaigns.push({
        name,
        objective: 'awareness',
        dailyBudgetCents,
        audiences: [],
        creatives: [],
      });
    }
  }

  return { campaigns: campaigns.length > 0 ? campaigns : [{ name: 'Default Campaign', objective: 'awareness', dailyBudgetCents: 50000, audiences: [], creatives: [] }] };
}

/**
 * Parse website spec from agent output.
 * Tries JSON first, falls back to regex extraction.
 */
function parseWebsiteSpec(rawOutput: string, jsonStr?: string): WebsiteSpec {
  try {
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object' && 'pages' in parsed) {
        return parsed as WebsiteSpec;
      }
    }
  } catch {
    // Fall through to regex extraction
  }

  // Fallback: extract pages from structured text
  const pages: WebsiteSpec['pages'] = [];

  // Look for page sections (e.g., "Page: /about" or "## About Page")
  const pageMatches = rawOutput.match(/(?:Page|Route|##|###)\s*:?\s*([^\n]+)/gi) ?? [];

  for (const match of pageMatches) {
    const route = match.replace(/(?:Page|Route|##|###)\s*:?\s*/i, '').trim();
    if (route) {
      pages.push({
        route: route.startsWith('/') ? route : `/${route.toLowerCase().replace(/\s+/g, '-')}`,
        title: route,
        sections: [],
      });
    }
  }

  // Extract theme info if present
  const primaryColorMatch = rawOutput.match(/(?:primary|main)\s+color[:\s]*([#\w]+)/i);
  const fontMatch = rawOutput.match(/font[:\s]*([^,\n]+)/i);

  return {
    pages: pages.length > 0 ? pages : [{ route: '/', title: 'Home', sections: [] }],
    theme: {
      primaryColor: primaryColorMatch?.[1],
      fontFamily: fontMatch?.[1]?.trim(),
    },
    integrations: [],
  };
}

/**
 * Parse product catalog from agent output.
 * Tries JSON first, falls back to structured text extraction.
 */
function parseProductCatalog(rawOutput: string, jsonStr?: string): ProductCatalog {
  try {
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object' && 'products' in parsed) {
        return parsed as ProductCatalog;
      }
    }
  } catch {
    // Fall through to regex extraction
  }

  // Fallback: extract products from structured text
  const products: ProductCatalog['products'] = [];

  // Look for product names (e.g., "Product: Name" or "## Product Name")
  const productMatches = rawOutput.match(/(?:Product|Item|##|###)\s*:?\s*([^\n]+)/gi) ?? [];

  for (const match of productMatches) {
    const name = match.replace(/(?:Product|Item|##|###)\s*:?\s*/i, '').trim();
    if (name) {
      // Try to extract price (escape regex special chars in product name to avoid invalid regex)
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const priceMatch = rawOutput.match(new RegExp(`${escapedName}[\\s\\S]*?(?:price|Price|cost|Cost)[\\s:]*\\$?([\\d.]+)`, 'i'));
      const price = priceMatch && priceMatch[1] ? Math.round(parseFloat(priceMatch[1]) * 100) : 0;

      products.push({
        name,
        description: '',
        variants: [{ name: 'Default', price, sku: '' }],
        images: [],
      });
    }
  }

  return { products: products.length > 0 ? products : [] };
}

/**
 * Parse email sequence from agent output.
 * Tries JSON first, falls back to structured text extraction.
 */
function parseEmailSequence(rawOutput: string, jsonStr?: string): EmailSequence {
  try {
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object' && 'name' in parsed && 'emails' in parsed) {
        return parsed as EmailSequence;
      }
    }
  } catch {
    // Fall through to regex extraction
  }

  // Fallback: extract email sequence from structured text
  const emails: EmailSequence['emails'] = [];

  // Look for email subjects (e.g., "Email 1: Subject..." or "Subject: ...")
  const emailMatches = rawOutput.match(/(?:Email|##)\s*\d*\s*:?\s*(?:Subject[:\s])?([^\n]+)/gi) ?? [];

  for (const match of emailMatches) {
    const subject = match.replace(/(?:Email|##)\s*\d*\s*:?\s*(?:Subject[:\s])?/i, '').trim();
    if (subject) {
      emails.push({
        subject,
        delay: '0d',
        body: '',
      });
    }
  }

  return {
    name: 'Email Sequence',
    trigger: 'signup',
    emails: emails.length > 0 ? emails : [],
  };
}
