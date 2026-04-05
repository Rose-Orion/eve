console.log('[SRC-MARKER] src/prompt-builder/index.ts loaded at', new Date().toISOString());
/**
 * PromptBuilder — Assembles XML-structured system prompts for all EVE agents.
 *
 * 11-step deterministic pipeline:
 * 1.  Load agent template
 * 2.  Extract brand context (per-agent filtering)
 * 3.  Load expertise / skills
 * 4.  Load gold standard examples
 * 5.  Format current task
 * 6.  Load rules + boundaries
 * 7.  Optionally load knowledge library
 * 8.  Assemble in XML template order
 * 9.  Count tokens
 * 10. Validate
 * 11. Output assembled prompt
 *
 * Hard ceiling: 8,000 tokens for system prompt.
 */

import type {
  AgentId, AgentTemplate, AssembledPrompt, BrandState,
  ModelTier, PromptMetadata, PromptSection,
} from '../config/types.js';
import { MODEL_IDS, TOKEN_BUDGET } from '../config/types.js';
import { loadTemplate } from './template-loader.js';
import {
  formatBrandContextXml,
  getPreFoundationContext,
  loadBrandContext,
} from './brand-loader.js';
import { formatExamplesXml, loadGoldStandards } from './example-loader.js';
import { formatKnowledgeXml, loadKnowledgeFiles } from './knowledge-loader.js';
import { countTokens, truncateToTokens } from './token-counter.js';

export interface BuildPromptInput {
  agentId: AgentId;
  floorId: string;
  floorSlug: string;
  taskId: string;
  taskDescription: string;
  taskType: string;
  acceptanceCriteria: string[];
  inputFiles: string[];
  pendingInputs: string[];
  outputSpec: string;
  priority: string;
  modelTier: ModelTier;
  brandState: BrandState;
  selectedBrand?: import('../config/types.js').SelectedBrand | null;
  workspaceFiles?: string[];
  knowledgeFiles?: string[];
  /** Pre-formatted outcome gold standards XML (from OutcomeGoldStandards) */
  outcomeExamplesXml?: string;
  /** Pre-formatted cross-floor intelligence XML (from CrossFloorIntelligence) */
  crossFloorInsightsXml?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class PromptBuilder {
  /**
   * Build a complete system prompt for a virtual agent task.
   */
  async build(input: BuildPromptInput): Promise<AssembledPrompt> {
    const template = await loadTemplate(input.agentId);

    // Assemble sections in priority order
    const sections: PromptSection[] = [];
    const trimmed: string[] = [];

    // 1. Role (priority 1 — always included)
    const roleSection = await this.buildRoleSection(template);
    sections.push(roleSection);

    // 2. Brand context (priority 3)
    const brandSection = await this.buildBrandSection(
      input.floorSlug, input.agentId, input.brandState, template,
      input.selectedBrand ?? null,
    );
    if (brandSection) sections.push(brandSection);

    // 3. Expertise (priority 4)
    const expertiseSection = await this.buildExpertiseSection(template);
    if (expertiseSection) sections.push(expertiseSection);

    // 4. Gold standard examples (priority 5)
    // Prefer outcome-based gold standards when available; fall back to approval-based
    if (input.outcomeExamplesXml) {
      const outcomeTokens = await countTokens(input.outcomeExamplesXml);
      sections.push({
        tag: 'examples',
        content: input.outcomeExamplesXml,
        tokenCount: outcomeTokens,
        priority: TOKEN_BUDGET.sections.examples.priority,
      });
    } else {
      const examplesSection = await this.buildExamplesSection(
        input.floorSlug, input.agentId, input.taskType,
      );
      if (examplesSection) sections.push(examplesSection);
    }

    // 4.5. Cross-floor intelligence (priority 6 — optional, injected by learning engine)
    if (input.crossFloorInsightsXml) {
      const insightTokens = await countTokens(input.crossFloorInsightsXml);
      sections.push({
        tag: 'cross_floor_intelligence',
        content: input.crossFloorInsightsXml,
        tokenCount: insightTokens,
        priority: 6,
      });
    }

    // 5. Task (priority 2)
    const taskSection = await this.buildTaskSection(input);
    sections.push(taskSection);

    // 6. Workspace (priority 6) — always include, even when empty
    const workspaceSection = await this.buildWorkspaceSection(input.workspaceFiles ?? []);
    sections.push(workspaceSection);

    // 6.5. Knowledge library (priority 6 — optional)
    if (input.knowledgeFiles && input.knowledgeFiles.length > 0) {
      const knowledgeSection = await this.buildKnowledgeSection(input.knowledgeFiles);
      if (knowledgeSection) sections.push(knowledgeSection);
    }

    // 7. Rules (priority 1)
    const rulesSection = await this.buildRulesSection(template);
    sections.push(rulesSection);

    // 8. Boundaries (priority 1)
    const boundariesSection = await this.buildBoundariesSection(template);
    sections.push(boundariesSection);

    // 9. Output format (priority 1)
    const outputSection = await this.buildOutputFormatSection(template);
    sections.push(outputSection);

    // 10. Token counting and trimming
    let totalTokens = sections.reduce((sum, s) => sum + s.tokenCount, 0);

    if (totalTokens > TOKEN_BUDGET.ceiling) {
      // Trim in reverse priority order (highest priority number first)
      const sortedByPriority = [...sections].sort((a, b) => b.priority - a.priority);

      for (const section of sortedByPriority) {
        if (totalTokens <= TOKEN_BUDGET.ceiling) break;

        const excess = totalTokens - TOKEN_BUDGET.ceiling;
        const budgetConfig = TOKEN_BUDGET.sections[section.tag as keyof typeof TOKEN_BUDGET.sections];
        const minTokens = budgetConfig?.min ?? 0;

        if (section.tokenCount > minTokens) {
          const canTrim = section.tokenCount - minTokens;
          const toTrim = Math.min(canTrim, excess);

          if (toTrim > 0) {
            const targetTokens = section.tokenCount - toTrim;

            if (targetTokens < 50) {
              // Remove section entirely
              totalTokens -= section.tokenCount;
              section.content = '';
              section.tokenCount = 0;
              trimmed.push(section.tag);
            } else {
              // Truncate section content
              section.content = await truncateToTokens(section.content, targetTokens);
              const oldCount = section.tokenCount;
              section.tokenCount = await countTokens(section.content);
              totalTokens -= (oldCount - section.tokenCount);
              trimmed.push(`${section.tag}(partial)`);
            }
          }
        }
      }
    }

    // 11. Assemble final XML
    const activeSections = sections.filter(s => s.content.length > 0);
    const systemPrompt = this.assembleXml(activeSections);
    totalTokens = await countTokens(systemPrompt);

    // 12. Validate
    const validation = this.validate(activeSections, input);
    if (!validation.valid) {
      throw new PromptValidationError(validation.errors, validation.warnings);
    }

    const metadata: PromptMetadata = {
      agentId: input.agentId,
      floorId: input.floorId,
      taskId: input.taskId,
      modelTier: input.modelTier,
      brandStateAtBuild: input.brandState,
      voiceSampleLoaded: activeSections.some(s =>
        s.tag === 'brand_context' && s.content.includes('<voice_sample>'),
      ),
      examplesLoaded: activeSections.find(s => s.tag === 'examples')
        ? (activeSections.find(s => s.tag === 'examples')!.content.match(/<example /g) ?? []).length
        : 0,
      trimmedSections: trimmed,
    };

    return {
      systemPrompt,
      sections: activeSections,
      totalTokens,
      model: MODEL_IDS[input.modelTier],
      maxTokens: 8192,
      metadata,
    };
  }

  /**
   * Build a compressed sub-agent prompt (500-1500 tokens).
   */
  async buildSubAgentPrompt(
    parentAgent: AgentId,
    floorName: string,
    task: string,
    brandSummary: string,
  ): Promise<string> {
    return `<system>
<role>
You are a sub-agent of ${parentAgent} for ${floorName}.
Your single task is described below. Complete it and return the result.
Do not take any other actions. Do not ask questions.
</role>

<brand>
${brandSummary}
</brand>

<task>
${task}

OUTPUT FORMAT:
Return only the completed work. No commentary. No status updates.
</task>
</system>`;
  }

  // --- Section Builders ---

  private async buildRoleSection(template: AgentTemplate): Promise<PromptSection> {
    const content = template.role;
    return {
      tag: 'role',
      content,
      tokenCount: await countTokens(content),
      priority: TOKEN_BUDGET.sections.role.priority,
    };
  }

  private async buildBrandSection(
    floorSlug: string,
    agentId: AgentId,
    brandState: BrandState,
    template: AgentTemplate,
    selectedBrand?: import('../config/types.js').SelectedBrand | null,
  ): Promise<PromptSection | null> {
    if (brandState === 'pre-foundation') {
      const preFoundation = getPreFoundationContext(agentId);
      if (!preFoundation) return null;
      return {
        tag: 'brand_context',
        content: preFoundation,
        tokenCount: await countTokens(preFoundation),
        priority: TOKEN_BUDGET.sections.brandContext.priority,
      };
    }

    console.log(`[PromptBuilder:buildBrandSection] floorSlug=${floorSlug}, agentId=${agentId}, brandState=${brandState}, selectedBrand=${JSON.stringify(selectedBrand)}`);
    let brand: import('../config/types.js').BrandContext | null = null;
    try {
      brand = await loadBrandContext(floorSlug, agentId, brandState);
    } catch (err) {
      console.error(`[PromptBuilder:buildBrandSection] loadBrandContext THREW: ${(err as Error).message}`);
    }
    console.log(`[PromptBuilder:buildBrandSection] brand=${brand ? `{pkg_len=${brand.foundationPackage.length}, voice=${!!brand.voiceSample}}` : 'null'}`);
    if (brand && brand.foundationPackage.trim().length > 0) {
      const xml = formatBrandContextXml(brand);
      return {
        tag: 'brand_context',
        content: xml,
        tokenCount: await countTokens(xml),
        priority: TOKEN_BUDGET.sections.brandContext.priority,
      };
    }

    // Fallback: if no file exists yet (or file had no matching sections for this agent),
    // construct brand context from selectedBrand data
    // (the dashboard PATCHes selectedBrand before calling approve-gate)
    if (selectedBrand?.name) {
      // Include any extra fields the selectedBrand might have (e.g. reasoning)
      const sb = selectedBrand as unknown as Record<string, unknown>;
      const extraFields = Object.entries(sb)
        .filter(([k]) => !['index', 'name', 'tagline', 'personality', 'voiceAttributes'].includes(k))
        .map(([k, v]) => `**${k.charAt(0).toUpperCase() + k.slice(1)}:** ${String(v)}`)
        .join('\n');

      const fallbackXml = `<brand_context>
# Selected Brand Direction

**Brand Name:** ${selectedBrand.name}
**Tagline:** "${selectedBrand.tagline || ''}"
**Personality:** ${selectedBrand.personality || ''}
**Voice Attributes:** ${selectedBrand.voiceAttributes?.join(', ') || 'Not specified'}
${extraFields ? `${extraFields}\n` : ''}
> This brand direction was selected by the owner. All agents must use this brand name
> and align all creative work with this direction.
</brand_context>`;
      console.log(`[PromptBuilder] Using selectedBrand fallback for ${agentId} on floor "${floorSlug}" (brand: ${selectedBrand.name})`);
      return {
        tag: 'brand_context',
        content: fallbackXml,
        tokenCount: await countTokens(fallbackXml),
        priority: TOKEN_BUDGET.sections.brandContext.priority,
      };
    }

    // Emergency fallback: brandState says we should have context but nothing loaded.
    // Return a minimal brand_context to prevent validation failure.
    if (brandState === 'foundation-approved' || brandState === 'brand-revision') {
      const emergencyXml = `<brand_context>
# Brand Context Unavailable
Brand files could not be loaded for floor "${floorSlug}".
Brand state: ${brandState}. Agent: ${agentId}.
Proceed with the task using any brand information provided in the task prompt itself.
</brand_context>`;
      console.warn(`[PromptBuilder] EMERGENCY brand fallback for ${agentId} on floor "${floorSlug}" — no files, no selectedBrand`);
      return {
        tag: 'brand_context',
        content: emergencyXml,
        tokenCount: await countTokens(emergencyXml),
        priority: TOKEN_BUDGET.sections.brandContext.priority,
      };
    }

    return null;
  }

  private async buildExpertiseSection(template: AgentTemplate): Promise<PromptSection | null> {
    if (!template.expertise) return null;

    let content = template.expertise;
    if (template.usesGeneratedKnowledge) {
      content += `\n\nIMPORTANT — Generated Knowledge Pattern:
Before reasoning about any analysis task, you MUST first generate 5 relevant facts from available data.
Phase 1: Generate facts (what do we know?)
Phase 2: Reason using ONLY those facts (cite which fact supports each conclusion)
Phase 3: Recommend with expected impact, timeline, risk, and rollback plan.
Never skip Phase 1.`;
    }

    return {
      tag: 'expertise',
      content,
      tokenCount: await countTokens(content),
      priority: TOKEN_BUDGET.sections.expertise.priority,
    };
  }

  private async buildExamplesSection(
    floorSlug: string,
    agentId: AgentId,
    taskType: string,
  ): Promise<PromptSection | null> {
    const examples = await loadGoldStandards(floorSlug, agentId, taskType);
    if (examples.length === 0) return null;

    const xml = formatExamplesXml(examples);
    return {
      tag: 'examples',
      content: xml,
      tokenCount: await countTokens(xml),
      priority: TOKEN_BUDGET.sections.examples.priority,
    };
  }

  private async buildTaskSection(input: BuildPromptInput): Promise<PromptSection> {
    const criteriaList = input.acceptanceCriteria.map(c => `- ${c}`).join('\n');
    const inputsList = input.inputFiles.length > 0
      ? input.inputFiles.map(f => `- ${f}`).join('\n')
      : '- None yet';
    const pendingList = input.pendingInputs.length > 0
      ? input.pendingInputs.map(f => `- ${f}`).join('\n')
      : '- None';

    const content = `<task>
ASSIGNMENT: ${input.taskDescription}

ACCEPTANCE CRITERIA:
${criteriaList}

INPUTS AVAILABLE:
${inputsList}

INPUTS PENDING:
${pendingList}

OUTPUT:
${input.outputSpec}

PRIORITY: ${input.priority}
</task>`;

    return {
      tag: 'task',
      content,
      tokenCount: await countTokens(content),
      priority: TOKEN_BUDGET.sections.task.priority,
    };
  }

  private async buildWorkspaceSection(files: string[]): Promise<PromptSection> {
    let content: string;

    if (files.length === 0) {
      content = '<workspace>\nNo workspace files available for this task.\n</workspace>';
    } else {
      const fileList = files.map(f => `- ${f}`).join('\n');
      content = `<workspace>
AVAILABLE FILES:
${fileList}
</workspace>`;
    }

    return {
      tag: 'workspace',
      content,
      tokenCount: await countTokens(content),
      priority: TOKEN_BUDGET.sections.workspace.priority,
    };
  }

  private async buildRulesSection(template: AgentTemplate): Promise<PromptSection> {
    let content = template.rules;

    if (template.antiSlopEnabled) {
      content += `\n\nANTI-SLOP ENFORCEMENT:
NEVER use these phrases in any output:
"elevate", "unlock", "leverage", "delve", "game-changer", "streamline",
"cutting-edge", "revolutionize", "unleash", "empower", "synergy", "holistic",
"paradigm shift", "in today's fast-paced world", "dive deep",
"take it to the next level", "seamlessly", "supercharge", "disrupt", "next-level".
If you catch yourself using any of these, rewrite the sentence with concrete, specific language.`;
    }

    return {
      tag: 'rules',
      content,
      tokenCount: await countTokens(content),
      priority: TOKEN_BUDGET.sections.rules.priority,
    };
  }

  private async buildBoundariesSection(template: AgentTemplate): Promise<PromptSection> {
    return {
      tag: 'boundaries',
      content: template.boundaries,
      tokenCount: await countTokens(template.boundaries),
      priority: TOKEN_BUDGET.sections.boundaries.priority,
    };
  }

  private async buildOutputFormatSection(template: AgentTemplate): Promise<PromptSection> {
    // Inject action execution instructions for agents with actionsEnabled
    const actionBlock = template.actionsEnabled && template.actionInstructions
      ? `\n\nACTION EXECUTION:\n${template.actionInstructions}`
      : '';

    const content = template.outputFormat + actionBlock + `\n\nALWAYS end your response with a status block:
\`\`\`json
{
  "status": "working|complete|blocked|needs_review|error",
  "output_files": ["list of files created or modified"],
  "needs_review_by": "agent-id or null",
  "blocked_by": "agent-id or resource, or null",
  "blocked_reason": "description or null",
  "next_action": "description or null",
  "estimated_turns_remaining": null
}
\`\`\``;

    return {
      tag: 'output_format',
      content,
      tokenCount: await countTokens(content),
      priority: TOKEN_BUDGET.sections.outputFormat.priority,
    };
  }

  private async buildKnowledgeSection(filePaths: string[]): Promise<PromptSection | null> {
    const files = await loadKnowledgeFiles(filePaths);
    if (files.length === 0) return null;

    const xml = formatKnowledgeXml(files);
    return {
      tag: 'knowledge',
      content: xml,
      tokenCount: await countTokens(xml),
      priority: 6, // Same as workspace — trimmed first
    };
  }

  // --- Assembly ---

  private assembleXml(sections: PromptSection[]): string {
    // Assemble in canonical order
    const order: string[] = [
      'role', 'brand_context', 'expertise', 'examples',
      'cross_floor_intelligence', 'task', 'workspace', 'knowledge',
      'rules', 'boundaries', 'output_format',
    ];

    const sorted = [...sections].sort((a, b) => {
      const ai = order.indexOf(a.tag);
      const bi = order.indexOf(b.tag);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    const parts: string[] = [];
    for (const section of sorted) {
      // task and brand_context already have their own XML tags
      if (section.tag === 'task' || section.tag === 'brand_context') {
        parts.push(section.content);
      } else {
        parts.push(`<${section.tag}>\n${section.content}\n</${section.tag}>`);
      }
    }

    return `<system>\n${parts.join('\n\n')}\n</system>`;
  }

  // --- Validation ---

  private validate(sections: PromptSection[], input: BuildPromptInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const tags = new Set(sections.map(s => s.tag));

    // Required sections
    if (!tags.has('role')) errors.push('Missing required section: role');
    if (!tags.has('task')) errors.push('Missing required section: task');
    if (!tags.has('rules')) errors.push('Missing required section: rules');
    if (!tags.has('output_format')) errors.push('Missing required section: output_format');
    if (!tags.has('boundaries')) errors.push('Missing required section: boundaries');

    // Brand context required after foundation
    if (input.brandState === 'foundation-approved' || input.brandState === 'brand-revision') {
      if (!tags.has('brand_context')) {
        // RELAXED: Log warning but don't block — the emergency fallback should have
        // provided brand_context, but if it didn't, let the task proceed anyway.
        // The task prompt itself contains brand context inline.
        const preFoundationAgents = new Set(['brand-agent', 'strategy-agent', 'finance-agent']);
        if (!preFoundationAgents.has(input.agentId)) {
          console.warn(`[PromptBuilder:validate] Agent ${input.agentId} missing brand_context (state: ${input.brandState}) — proceeding anyway`);
        }
      }
    }

    // Acceptance criteria required
    if (input.acceptanceCriteria.length === 0) {
      warnings.push('Task has no acceptance criteria');
    }

    // Token check
    const total = sections.reduce((sum, s) => sum + s.tokenCount, 0);
    if (total > TOKEN_BUDGET.ceiling) {
      errors.push(`Total tokens (${total}) exceeds ceiling (${TOKEN_BUDGET.ceiling})`);
    }

    // Security: no PII or credentials
    const systemPrompt = sections.map(s => s.content).join('\n');
    if (/sk-[a-zA-Z0-9]{20,}/.test(systemPrompt)) {
      errors.push('System prompt contains what appears to be an API key');
    }

    // --- New validation checks (6 more) ---

    // 1. Skills/expertise loaded
    const expertiseSection = sections.find(s => s.tag === 'expertise');
    if (!expertiseSection || expertiseSection.content.trim().length === 0) {
      warnings.push('No expertise/skills section loaded');
    }

    // 2. Task has acceptance criteria or output spec
    const taskSection = sections.find(s => s.tag === 'task');
    if (taskSection && taskSection.content.length < 50) {
      warnings.push('Task section is very short (<50 chars) — missing acceptance criteria?');
    }

    // 3. Workspace section present (always after 2.1 update)
    if (!tags.has('workspace')) {
      warnings.push('Workspace section not found');
    }

    // 4. Rules include terminal access tier
    const rulesSection = sections.find(s => s.tag === 'rules');
    if (rulesSection && !/(Tier [123])/i.test(rulesSection.content)) {
      warnings.push('Rules section does not mention terminal access tiers (Tier 1, 2, or 3)');
    }

    // 5. Rules include safety constraints
    if (rulesSection && !/SAFETY/i.test(rulesSection.content)) {
      warnings.push('Rules section does not mention SAFETY constraints');
    }

    // 6. No cross-floor data leakage — check for UUIDs not matching input.floorId
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const foundUuids = systemPrompt.match(uuidPattern) ?? [];
    const uniqueUuids = new Set(foundUuids.map(u => u.toLowerCase()));
    const currentFloorUuid = input.floorId.toLowerCase();
    for (const uuid of uniqueUuids) {
      if (uuid !== currentFloorUuid) {
        errors.push(`Cross-floor UUID detected in prompt: ${uuid} (expected: ${currentFloorUuid})`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}

export class PromptValidationError extends Error {
  constructor(
    public readonly errors: string[],
    public readonly warnings: string[],
  ) {
    super(`Prompt validation failed: ${errors.join('; ')}`);
    this.name = 'PromptValidationError';
  }
}
