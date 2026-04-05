import { describe, it, expect } from 'vitest';
import { parseAgentOutput } from '../src/orchestrator/output-parser.js';

describe('Output Parser', () => {
  it('should extract JSON from markdown code block', () => {
    const rawOutput = `
Here is the campaign plan:

\`\`\`json
{
  "campaigns": [
    {
      "name": "Summer Sale",
      "objective": "conversions",
      "dailyBudgetCents": 50000,
      "audiences": [],
      "creatives": []
    }
  ]
}
\`\`\`
`;

    const result = parseAgentOutput('ads-agent', 'campaign-planning', rawOutput);

    expect(result.type).toBe('campaign-plan');
    if (result.type === 'campaign-plan') {
      expect(result.data.campaigns).toHaveLength(1);
      expect(result.data.campaigns[0].name).toBe('Summer Sale');
    }
  });

  it('should extract JSON from curly braces without markdown', () => {
    const rawOutput = `
Campaign plan:
{
  "campaigns": [
    {
      "name": "Black Friday",
      "objective": "awareness",
      "dailyBudgetCents": 100000,
      "audiences": [],
      "creatives": []
    }
  ]
}
More text here.
`;

    const result = parseAgentOutput('ads-agent', 'campaign-planning', rawOutput);

    expect(result.type).toBe('campaign-plan');
    // The campaign-plan should be populated from the JSON or fallback extraction
    if (result.type === 'campaign-plan') {
      expect(result.data.campaigns).toBeDefined();
    }
  });

  it('should handle website spec parsing', () => {
    const rawOutput = `
Website structure:
\`\`\`json
{
  "pages": [
    {
      "route": "/",
      "title": "Home",
      "sections": ["hero", "products", "testimonials"]
    }
  ],
  "theme": {
    "primaryColor": "#FF6B35",
    "fontFamily": "Montserrat"
  },
  "integrations": ["stripe", "mailchimp"]
}
\`\`\`
`;

    const result = parseAgentOutput('web-agent', 'website-design', rawOutput);

    expect(result.type).toBe('website-spec');
    if (result.type === 'website-spec') {
      expect(result.data.pages).toHaveLength(1);
      expect(result.data.pages[0].route).toBe('/');
      expect(result.data.theme.primaryColor).toBe('#FF6B35');
    }
  });

  it('should handle product catalog parsing', () => {
    const rawOutput = `
Product catalog:
\`\`\`json
{
  "products": [
    {
      "name": "Leather Jacket",
      "description": "Premium leather jacket",
      "variants": [
        {
          "name": "Size S",
          "price": 19999,
          "sku": "LJ-S"
        }
      ],
      "images": ["jacket1.jpg"]
    }
  ]
}
\`\`\`
`;

    const result = parseAgentOutput('commerce-agent', 'product-catalog', rawOutput);

    expect(result.type).toBe('product-catalog');
    if (result.type === 'product-catalog') {
      expect(result.data.products).toHaveLength(1);
      expect(result.data.products[0].name).toBe('Leather Jacket');
    }
  });

  it('should handle email sequence parsing', () => {
    const rawOutput = `
Email automation sequence:
\`\`\`json
{
  "name": "Welcome Series",
  "trigger": "signup",
  "emails": [
    {
      "subject": "Welcome to our store!",
      "delay": "0 hours",
      "body": "Thank you for signing up"
    }
  ]
}
\`\`\`
`;

    const result = parseAgentOutput('copy-agent', 'email-sequence', rawOutput);

    expect(result.type).toBe('email-sequence');
    if (result.type === 'email-sequence') {
      expect(result.data.name).toBe('Welcome Series');
      expect(result.data.emails).toHaveLength(1);
    }
  });

  it('should return raw type for unparseable content', () => {
    const rawOutput = 'This is just plain text with no structured data';

    const result = parseAgentOutput('unknown-agent', 'generic-task', rawOutput);

    expect(result.type).toBe('raw');
    if (result.type === 'raw') {
      expect(result.data).toBe(rawOutput);
    }
  });

  it('should handle malformed JSON gracefully', () => {
    const rawOutput = `
Campaign plan:
\`\`\`json
{
  "campaigns": [
    {
      "name": "Invalid JSON with trailing comma",
    }
  ]
}
\`\`\`
`;

    const result = parseAgentOutput('ads-agent', 'campaign-planning', rawOutput);

    // Should fall back to extraction or return as-is
    expect(result).toBeDefined();
  });

  it('should route to campaign-plan parser for ads-agent', () => {
    const rawOutput = `
{
  "campaigns": [
    {
      "name": "Test Campaign",
      "objective": "sales",
      "dailyBudgetCents": 75000,
      "audiences": [],
      "creatives": []
    }
  ]
}
`;

    const result = parseAgentOutput('ads-agent', 'campaign-planning', rawOutput);

    expect(result.type).toBe('campaign-plan');
  });

  it('should not parse as campaign-plan for non-campaign tasks', () => {
    const rawOutput = 'Just some creative brief text';

    const result = parseAgentOutput('ads-agent', 'brief-writing', rawOutput);

    expect(result.type).toBe('raw');
  });

  it('should handle multiple campaigns in single output', () => {
    const rawOutput = `
\`\`\`json
{
  "campaigns": [
    {
      "name": "Campaign 1",
      "objective": "awareness",
      "dailyBudgetCents": 50000,
      "audiences": [],
      "creatives": []
    },
    {
      "name": "Campaign 2",
      "objective": "conversions",
      "dailyBudgetCents": 75000,
      "audiences": [],
      "creatives": []
    }
  ]
}
\`\`\`
`;

    const result = parseAgentOutput('ads-agent', 'campaign-planning', rawOutput);

    expect(result.type).toBe('campaign-plan');
    if (result.type === 'campaign-plan') {
      expect(result.data.campaigns).toHaveLength(2);
    }
  });
});
