/**
 * Brand Loader — extracts agent-specific brand context from the Foundation Package.
 * Also loads the Voice Sample for content agents.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, BrandContext, BrandState } from '../config/types.js';
import { getConfig } from '../config/index.js';
import { loadTemplate } from './template-loader.js';

function getProjectsDir(): string {
  try {
    return getConfig().PROJECTS_DIR;
  } catch {
    return join(process.env['HOME'] ?? '/Users/automation', 'orion-projects');
  }
}

/** Which Foundation Package sections each agent type needs. */
const BRAND_CONTEXT_FIELDS: Record<string, string[]> = {
  'copy-agent': ['voice_guidelines', 'target_customer', 'product_strategy', 'key_differentiators'],
  'design-agent': ['visual_style', 'color_palette', 'typography', 'mood', 'photography_style'],
  'web-agent': ['typography', 'color_palette', 'visual_style', 'technical_requirements'],
  'ads-agent': ['target_customer', 'competitive_landscape', 'pricing', 'platform_priorities', 'kpis'],
  'social-media-agent': ['voice_guidelines', 'target_customer', 'platform_priorities', 'content_pillars'],
  'brand-agent': ['brand_identity', 'voice_guidelines', 'visual_style', 'positioning'],
  'strategy-agent': ['business_model', 'target_customer', 'competitive_landscape', 'pricing'],
  'finance-agent': ['financial_projections', 'pricing_strategy', 'budget'],
  'video-agent': ['visual_style', 'mood', 'target_customer', 'brand_identity'],
  'commerce-agent': ['product_strategy', 'pricing', 'target_customer', 'fulfillment'],
  'analytics-agent': ['kpis', 'target_customer', 'business_model'],
  // Real agents — receive full Foundation Package for orchestration context
  'floor-manager': ['brand_identity', 'voice_guidelines', 'target_customer', 'business_model', 'positioning', 'kpis'],
  'launch-agent': ['technical_requirements', 'target_customer', 'business_model', 'pricing', 'kpis'],
};

/**
 * Agents that receive the voice sample in their brand context.
 * Hardcoded fallback — the authoritative check is the template's `usesVoiceSample` flag.
 */
const VOICE_SAMPLE_AGENTS_FALLBACK: Set<string> = new Set([
  'copy-agent', 'social-media-agent', 'ads-agent',
]);

/**
 * Load brand context for a specific agent on a specific floor.
 * Returns null if brand state is pre-foundation.
 */
export async function loadBrandContext(
  floorSlug: string,
  agentId: AgentId,
  brandState: BrandState,
): Promise<BrandContext | null> {
  // No brand context before foundation is approved
  if (brandState === 'pre-foundation') {
    return null;
  }

  const projectsDir = getProjectsDir();
  const floorDir = join(projectsDir, floorSlug);
  const foundationPath = join(floorDir, 'brand', 'foundation-package.md');
  const selectedBrandPath = join(floorDir, 'brand', 'selected-brand.md');
  const voicePath = join(floorDir, 'brand', 'voice-sample.md');

  let foundationPackage: string;
  try {
    foundationPackage = await readFile(foundationPath, 'utf-8');
  } catch (err1) {
    // Fallback: try selected-brand.md (written when owner picks a brand direction)
    try {
      foundationPackage = await readFile(selectedBrandPath, 'utf-8');
    } catch (err2) {
      console.warn(
        `[BrandLoader] Could not load brand files for floor "${floorSlug}" (agent: ${agentId}, state: ${brandState}). ` +
        `Tried: ${foundationPath} (${(err1 as Error).message}), ${selectedBrandPath} (${(err2 as Error).message}). ` +
        `PROJECTS_DIR=${projectsDir}`,
      );
      return null;
    }
  }

  // Extract only the sections relevant to this agent
  const fields = BRAND_CONTEXT_FIELDS[agentId] ?? [];
  let extracted = extractSections(foundationPackage, fields);

  // If section extraction found nothing (e.g. the file is a simple brand summary
  // without matching markdown headers), use the full content instead of empty string
  if (!extracted && foundationPackage.trim().length > 0) {
    extracted = foundationPackage.trim();
  }

  // Load voice sample — gated by the template's usesVoiceSample flag.
  // Falls back to the hardcoded set if template loading fails.
  let shouldLoadVoice = VOICE_SAMPLE_AGENTS_FALLBACK.has(agentId);
  try {
    const tmpl = await loadTemplate(agentId);
    shouldLoadVoice = tmpl.usesVoiceSample;
  } catch {
    // Template load failed — use fallback set
  }

  let voiceSample: string | null = null;
  if (shouldLoadVoice) {
    try {
      voiceSample = await readFile(voicePath, 'utf-8');
    } catch {
      // Voice sample not yet created — not an error
    }
  }

  return {
    foundationPackage: extracted,
    voiceSample,
    version: parseVersion(foundationPackage),
  };
}

/**
 * Extract sections from the Foundation Package that match the requested fields.
 * Foundation Packages use markdown headers (## Section Name) to delimit sections.
 */
function extractSections(content: string, fields: string[]): string {
  if (fields.length === 0) return content;

  const lines = content.split('\n');
  const sections: string[] = [];
  let currentSection = '';
  let currentContent: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      // Save previous section if it was one we wanted
      if (capturing && currentContent.length > 0) {
        sections.push(`## ${currentSection}\n${currentContent.join('\n')}`);
      }
      currentSection = headerMatch[1]!.trim();
      currentContent = [];
      const normalized = currentSection.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      capturing = fields.some(f => normalized.includes(f) || f.includes(normalized));
    } else if (capturing) {
      currentContent.push(line);
    }
  }

  // Don't forget the last section
  if (capturing && currentContent.length > 0) {
    sections.push(`## ${currentSection}\n${currentContent.join('\n')}`);
  }

  return sections.join('\n\n').trim();
}

function parseVersion(content: string): number {
  const match = content.match(/version:\s*(\d+)/i);
  return match ? parseInt(match[1]!, 10) : 1;
}

/**
 * Format brand context as XML for the system prompt.
 */
export function formatBrandContextXml(brand: BrandContext): string {
  let xml = `<brand_context>\n${brand.foundationPackage}`;
  if (brand.voiceSample) {
    xml += `\n\n<voice_sample>\n${brand.voiceSample}\n</voice_sample>`;
  }
  xml += '\n</brand_context>';
  return xml;
}

/**
 * Get pre-foundation context for agents that run before brand exists.
 */
export function getPreFoundationContext(agentId: AgentId): string | null {
  const preFoundationAgents = new Set(['brand-agent', 'strategy-agent', 'finance-agent']);
  if (!preFoundationAgents.has(agentId)) return null;

  if (agentId === 'brand-agent') {
    return `<brand_context>
NO BRAND EXISTS YET. Your job is to CREATE IT.
Deliverable: 3 distinct brand direction options with name, voice, visual style, and positioning.
The owner will select one direction.
</brand_context>`;
  }

  return `<brand_context>
NO BRAND EXISTS YET. Brand Agent is creating options now.
Work with available business goal and market context only.
</brand_context>`;
}
