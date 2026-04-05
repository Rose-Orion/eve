/**
 * Boot Patches — declarative configuration for one-time floor corrections.
 * Replaces hardcoded floor-specific fixes in loadPersistedState().
 *
 * This module contains patches that are applied during orchestrator boot to correct
 * known floor-specific issues (budget corrections, investigation logging, etc.).
 * Add new corrections here instead of hardcoding floor names in loadPersistedState().
 */

export interface BootPatch {
  /** Floor name (case-insensitive match) */
  floorName: string;
  /** Type of correction */
  type: 'budget-correction';
  /** Target value in cents */
  targetCents: number;
  /** Human-readable reason for the correction */
  reason: string;
  /** Whether this patch has been applied (tracks in-memory to avoid re-application) */
  applied?: boolean;
}

/**
 * Boot patches loaded from config. Add new corrections here instead of
 * hardcoding floor names in loadPersistedState().
 *
 * Example:
 *   {
 *     floorName: 'MyFloor',
 *     type: 'budget-correction',
 *     targetCents: 50000,
 *     reason: 'Owner-confirmed allocation: $250 → $500',
 *   }
 */
export const BOOT_PATCHES: BootPatch[] = [
  {
    floorName: 'SideQuest',
    type: 'budget-correction',
    targetCents: 50000,
    reason: 'Owner-confirmed allocation: $250 → $500',
  },
  {
    floorName: 'Quest Kids',
    type: 'budget-correction',
    targetCents: 50000,
    reason: 'Owner-confirmed allocation: $200 → $500',
  },
];

/**
 * Find applicable patches for a floor.
 */
export function getFloorPatches(floorName: string): BootPatch[] {
  return BOOT_PATCHES.filter(
    p => p.floorName.toLowerCase() === floorName.toLowerCase() && !p.applied
  );
}
