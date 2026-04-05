/**
 * FloorCreator — executes the 9-step floor creation sequence.
 *
 * 1. Database records (floor + 10 phases)
 * 2. File system workspace
 * 3. Agent registration (real + virtual)
 * 4. Floor Manager heartbeat config
 * 5. Activate Phase 1
 * 6. Dispatch Foundation Sprint tasks
 * 7. Initial Git commit
 * 8. Send notification
 * 9. Broadcast state
 */

import { randomUUID } from 'node:crypto';
import type { AgentId, Floor, FloorConfig } from '../config/types.js';
import { REAL_AGENTS } from '../config/types.js';
import type { EventBus } from '../orchestrator/event-bus.js';
import type { PhaseManager } from '../orchestrator/phase-manager.js';
import type { TaskManager } from '../orchestrator/task-manager.js';
import { AgentRegistry } from '../agents/registry.js';
import { ModelRouter } from '../agents/model-router.js';
import { Workspace } from './workspace.js';
import { FloorLifecycle } from './lifecycle.js';
import { registerAgent } from '../clients/openclaw.js';
import { buildSoulMd, buildAgentsMd } from '../prompt-builder/soul-builder.js';
import type { RealAgentId } from '../config/types.js';
import { send as sendNotification } from '../integrations/notifications.js';
import { saveFloor } from '../integrations/supabase.js';

export interface CreateFloorInput {
  name: string;
  goal: string;
  businessType: FloorConfig['businessType'];
  budgetCeilingCents: number;
}

/** Determine which agents are active based on business type. */
function getActiveAgents(businessType: FloorConfig['businessType']): AgentId[] {
  const core: AgentId[] = [
    'floor-manager', 'brand-agent', 'strategy-agent', 'finance-agent',
    'copy-agent', 'web-agent', 'analytics-agent', 'launch-agent',
  ];

  switch (businessType) {
    case 'ecommerce':
      return [...core, 'commerce-agent', 'design-agent', 'video-agent', 'social-media-agent', 'ads-agent'];
    case 'service':
      return [...core, 'design-agent', 'social-media-agent', 'ads-agent'];
    case 'content':
      return [...core, 'design-agent', 'video-agent', 'social-media-agent'];
    case 'personal-brand':
      return [...core, 'design-agent', 'social-media-agent'];
  }
}

export class FloorCreator {
  private workspace = new Workspace();

  constructor(
    private eventBus: EventBus,
    private phaseManager: PhaseManager,
    private taskManager: TaskManager,
    private agentRegistry: AgentRegistry,
    private lifecycle: FloorLifecycle,
  ) {}

  async create(input: CreateFloorInput): Promise<Floor> {
    const floorId = randomUUID();
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const activeAgents = getActiveAgents(input.businessType);

    const floor: Floor = {
      id: floorId,
      name: input.name,
      slug,
      goal: input.goal,
      status: 'building',
      brandState: 'pre-foundation',
      selectedBrand: null,
      themeConfig: null,
      budgetCeilingCents: input.budgetCeilingCents,
      spentCents: 0,
      currentPhase: 1,
      growthCycle: 0,
      config: {
        businessType: input.businessType,
        activeAgents,
        modelRouting: {},
      },
      createdAt: new Date(),
    };

    // Step 1: Persist to Supabase
    await saveFloor(floor);

    // Step 2: File system workspace
    await this.workspace.create(slug);

    // Step 3: Agent registration — generate full SOUL.md and AGENTS.md
    for (const agentId of activeAgents) {
      if ((REAL_AGENTS as readonly string[]).includes(agentId)) {
        const agentDir = await this.workspace.createAgentDir(slug, agentId);
        const soulPath = `${agentDir}/SOUL.md`;

        // Generate full SOUL.md via soul-builder
        const soulContent = buildSoulMd({
          agentId: agentId as RealAgentId,
          floorName: input.name,
          floorSlug: slug,
          goal: input.goal,
          businessType: input.businessType,
          activeAgents,
        });
        await this.workspace.writeFile(slug, `.orion/agents/${agentId}/SOUL.md`, soulContent);

        // Generate AGENTS.md
        const agentsMd = buildAgentsMd(agentId, activeAgents);
        await this.workspace.writeFile(slug, `.orion/agents/${agentId}/AGENTS.md`, agentsMd);

        await registerAgent(`${slug}-${agentId}`, agentId, soulPath, agentDir);
      }
    }
    this.agentRegistry.registerFloorAgents(floorId, activeAgents);

    // Step 4: Floor Manager workspace files (HEARTBEAT.md, USER.md, IDENTITY.md)
    const fmAgentPath = `.orion/agents/floor-manager`;
    await this.workspace.writeFile(slug, `${fmAgentPath}/HEARTBEAT.md`,
      `# Floor Manager Heartbeat\n\n## Every 60 seconds (build phase)\n- Check task queue: any blocked or failed tasks?\n- Check agent health: any agents offline?\n- Check budget: any alerts?\n- If nothing needs attention: HEARTBEAT_OK\n\n## Every 5 minutes (post-launch)\n- Check engagement: any urgent DMs or comments?\n- Check ad performance: any campaign below ROAS threshold for 3+ days?\n- Check orders: any issues?\n- If nothing needs attention: HEARTBEAT_OK\n\n## Daily at 7:00 AM\n- Compile daily status report and send to CEO Mode.\n`);
    await this.workspace.writeFile(slug, `${fmAgentPath}/USER.md`,
      `# Owner Profile\n\nFloor: ${input.name}\nBusiness Goal: ${input.goal}\nBusiness Type: ${input.businessType}\n\n## Communication Preferences\n- Direct and concise updates\n- Lead with numbers and decisions, not context\n- Escalate only when human input is genuinely required\n`);
    await this.workspace.writeFile(slug, `${fmAgentPath}/IDENTITY.md`,
      `# Identity\n\nYou are the Floor Manager for ${input.name}.\n\nYour role is to coordinate all agents working on this floor, surface blockers to the owner, and ensure the business is built to spec.\n\nYou are the only agent who speaks directly with the owner. All other agents route through you.\n`);

    // Step 5: Initialize lifecycle + advance directly to Phase 3 (Foundation Sprint).
    // Phases 1 (Idea Evaluation) and 2 (Floor Initialization) have no tasks —
    // they represent the steps we just completed (floor creation + workspace setup).
    // Mark them done so the phase manager doesn't block on empty phases.
    this.lifecycle.init(floorId, 'building');
    this.phaseManager.initFloor(floorId);
    this.phaseManager.forceCompleteUpTo(floorId, 2);
    this.phaseManager.activatePhase(floorId, 3);
    floor.currentPhase = 3;

    // Step 6: Dispatch Foundation Sprint tasks
    const router = new ModelRouter();

    this.taskManager.create({
      floorId,
      phaseNumber: 3,
      assignedAgent: 'brand-agent',
      modelTier: router.getModelTier('brand-agent', 'foundation'),
      taskType: 'brand-options',
      description: `Create 3 distinct brand direction options for "${input.name}": ${input.goal}`,
      prompt: `Create 3 distinct brand direction options for "${input.name}". Goal: ${input.goal}

CRITICAL LENGTH CONSTRAINT: You MUST produce ALL 3 directions. Each direction should be 400-600 words MAX. Do NOT write long essays per direction — be concise and impactful. If you run out of space before Direction C, the entire output is useless.

CRITICAL FORMAT — Use this EXACT heading pattern (the dashboard parser depends on it):

## DIRECTION A: [Brand Name]
## DIRECTION B: [Brand Name]
## DIRECTION C: [Brand Name]

Within each direction, use these exact bold labels IN THIS ORDER:
**Brand Name:** [the name]
**Tagline:** [the tagline in quotes or italics]
**Colors:** list 3 hex codes in backticks, e.g. \`#FF6B35\` \`#1A1A2E\` \`#00D9FF\`
**Typography:** [heading font + body font recommendation]
**Personality:** [2-3 sentence personality description]
**Voice Attributes:** [comma-separated list of 3-5 voice traits]
**Target Audience:** [1-2 sentences]
**Positioning:** [1-2 sentences on market position]
**Logo Direction:** [1-2 sentences describing the logo concept for image generation]

KEEP EACH DIRECTION TIGHT. No tables, no multi-page breakdowns. Save depth for after owner selects a direction.

DO NOT use numbered headings, bold-only headings, em-dashes, or any format other than "## DIRECTION [A/B/C]: Name".`,
    });

    this.taskManager.create({
      floorId,
      phaseNumber: 3,
      assignedAgent: 'strategy-agent',
      modelTier: router.getModelTier('strategy-agent', 'foundation'),
      taskType: 'business-strategy',
      description: `Develop go-to-market strategy for "${input.name}": ${input.goal}`,
      prompt: `Develop a go-to-market strategy for "${input.name}". Business goal: ${input.goal}

Include these sections with exact bold labels:
**Target Segments:** [2-3 primary customer segments with demographics and psychographics]
**Channel Strategy:** [prioritized list of marketing/sales channels with rationale]
**Competitive Positioning:** [market landscape and how this business differentiates]
**Growth Roadmap:** [90-day, 6-month, and 12-month milestones]
**Key Metrics:** [5-8 KPIs to track]

Be specific to this business — not generic advice. Calibrate recommendations to an early-stage operation with a $${input.budgetCeilingCents / 100} budget.`,
    });

    this.taskManager.create({
      floorId,
      phaseNumber: 3,
      assignedAgent: 'finance-agent',
      modelTier: router.getModelTier('finance-agent', 'foundation'),
      taskType: 'budget-plan',
      description: `Build financial plan for "${input.name}": ${input.goal}`,
      prompt:
        `Create a 12-month financial projection for "${input.name}" using a ` +
        `${input.budgetCeilingCents / 100} total budget baseline ` +
        `(${input.budgetCeilingCents} cents available). ` +
        `Include: revenue forecast, cost structure, unit economics, break-even analysis, ` +
        `and budget allocation. ALL figures must be calibrated to the ` +
        `${input.budgetCeilingCents / 100} baseline — do not assume any other budget amount.`,
      outputFiles: [`deliverables/budget-plan.md`],
    });

    // Step 7: Initial Git commit
    await this.workspace.commit(slug, 'Floor created: initial setup');

    // Step 8: Notify
    sendNotification({
      title: `Floor Created: ${input.name}`,
      body: `Business type: ${input.businessType}. ${activeAgents.length} agents activated. Foundation Sprint starting.`,
      floorId,
      type: 'info',
    });

    // Step 9: Broadcast state
    this.eventBus.emit('floor:created', { floorId, slug });

    return floor;
  }
}
