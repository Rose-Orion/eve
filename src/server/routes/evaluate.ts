/**
 * Evaluate routes — AI-powered business idea evaluation.
 * Step 1: Generate dynamic questions tailored to the idea.
 * Step 2: Full evaluation with score, breakdown, strategy.
 */

import type { FastifyInstance } from 'fastify';
import { callAnthropic } from '../../clients/anthropic.js';

export function registerEvaluateRoutes(app: FastifyInstance): void {
  // ── Generate dynamic questions for the idea ─────────────────────────────
  app.post<{
    Body: { idea: string };
  }>('/api/evaluate/questions', async (request, reply) => {
    const { idea } = request.body;
    if (!idea?.trim()) return reply.code(400).send({ error: 'Idea is required' });

    const systemPrompt = `You are a sharp business analyst. Generate targeted follow-up questions for a specific business idea.
Return ONLY valid JSON — no markdown, no explanation, no code blocks.`;

    const userMessage = `Business idea: "${idea}"

Generate 3-4 targeted follow-up questions SPECIFIC to this type of business.

Rules:
- Always include a budget question and a differentiator text question
- 2-3 "cards" questions with exactly 3 options each (tailored to THIS idea)
- 1 "text" question for what makes them different
- Options need emoji icons relevant to the business
- Question labels in ALL CAPS

Return exactly this JSON structure:
{
  "questions": [
    {
      "id": "string_key",
      "label": "QUESTION LABEL IN ALL CAPS",
      "type": "cards",
      "options": [
        {"v": "value", "icon": "emoji", "label": "Short label", "sub": "Brief description"}
      ]
    },
    {
      "id": "differentiator",
      "label": "WHAT MAKES YOU DIFFERENT?",
      "type": "text",
      "placeholder": "e.g. specific unique angle for this business type"
    }
  ]
}`;

    try {
      const result = await callAnthropic(systemPrompt, [{ role: 'user', content: userMessage }], 'haiku', 1024);
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.questions)) throw new Error('Invalid structure');
      return parsed;
    } catch (e) {
      console.error('[Evaluate] Questions generation failed:', e);
      // Generic fallback
      return {
        questions: [
          {
            id: 'customer',
            label: 'WHO IS YOUR TARGET CUSTOMER?',
            type: 'cards',
            options: [
              { v: 'gen-z',      icon: '📱', label: 'Gen Z',      sub: '18–26' },
              { v: 'millennial', icon: '💼', label: 'Millennials', sub: '27–42' },
              { v: 'broad',      icon: '👥', label: 'Broad',       sub: '25–55' },
            ],
          },
          {
            id: 'budget',
            label: "WHAT'S YOUR MONTHLY BUDGET?",
            type: 'cards',
            options: [
              { v: 'lean', icon: '💰',   label: 'Lean',    sub: '~$200/mo' },
              { v: 'mid',  icon: '💰💰',  label: 'Mid',     sub: '~$500/mo' },
              { v: 'full', icon: '💰💰💰', label: 'Full Go', sub: '$1,000+/mo' },
            ],
          },
          {
            id: 'differentiator',
            label: 'WHAT MAKES YOU DIFFERENT?',
            type: 'text',
            placeholder: 'What unique angle does your business have?',
          },
        ],
      };
    }
  });

  // ── Full business evaluation ─────────────────────────────────────────────
  app.post<{
    Body: { idea: string; answers: Record<string, string> };
  }>('/api/evaluate', async (request, reply) => {
    const { idea, answers } = request.body;
    if (!idea?.trim()) return reply.code(400).send({ error: 'Idea is required' });

    const answersText = Object.entries(answers || {})
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');

    const systemPrompt = `You are an expert business analyst and startup evaluator. You give honest, specific assessments.
Return ONLY valid JSON — no markdown, no explanation, no code blocks.`;

    const userMessage = `Evaluate this business idea for viability and build-readiness.

Business idea: "${idea}"
${answersText ? `\nOwner's context:\n${answersText}` : ''}

Return this exact JSON:
{
  "name": "Creative memorable business name (2-3 words, specific to this idea)",
  "tagline": "Compelling one-line tagline",
  "score": 28,
  "maxScore": 35,
  "grade": "Strong",
  "breakdown": [
    {"label": "Customer clarity",  "stars": 4, "score": "4/5", "reason": "One specific sentence"},
    {"label": "Problem / desire",  "stars": 4, "score": "4/5", "reason": "One specific sentence"},
    {"label": "Revenue model",     "stars": 4, "score": "4/5", "reason": "One specific sentence"},
    {"label": "Differentiation",   "stars": 3, "score": "3/5", "reason": "One specific sentence"},
    {"label": "Reach strategy",    "stars": 4, "score": "4/5", "reason": "One specific sentence"},
    {"label": "Unit economics",    "stars": 4, "score": "4/5", "reason": "One specific sentence"},
    {"label": "Scalability",       "stars": 4, "score": "4/5", "reason": "One specific sentence"}
  ],
  "plan": {
    "agents": 13,
    "timeline": "~3 weeks",
    "buildCost": "~$150",
    "monthly": "~$350",
    "adBudget": "$300/mo"
  },
  "strategy": {
    "targetAudience": "Specific description of who will buy this",
    "channels": "Best 2-3 channels to reach them",
    "pricing": "Recommended pricing approach",
    "keyProducts": "What to build or sell first"
  },
  "businessType": "ecommerce",
  "verdict": "Frank 1-2 sentence assessment. Name the #1 strength and #1 risk."
}

Scoring: 5=outstanding, 4=strong, 3=adequate, 2=weak, 1=problematic
Grade: 30-35=Excellent, 25-29=Strong, 20-24=Good, 15-19=Fair, below 15=Weak
businessType: "ecommerce" | "service" | "content" | "personal-brand"

Be honest and specific. Don't inflate scores.`;

    try {
      const result = await callAnthropic(systemPrompt, [{ role: 'user', content: userMessage }], 'sonnet', 2048);
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed;
    } catch (e) {
      console.error('[Evaluate] Evaluation failed:', e);
      return reply.code(500).send({ error: 'Evaluation failed. Please try again.' });
    }
  });
}
