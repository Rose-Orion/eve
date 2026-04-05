/**
 * Backup automation — daily database + workspace backups.
 * Triggered by PM2 cron or manual invocation.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

const BACKUP_DIR = path.resolve('data/backups');
const MAX_BACKUP_AGE_DAYS = 30;

/**
 * Run daily backup routine:
 * 1. Git commit workspace files (if changes exist)
 * 2. Export database summary (lightweight — just counts and checksums, not full dump)
 * 3. Prune old backups beyond retention period
 */
export async function runDailyBackup(): Promise<{ success: boolean; message: string }> {
  // Ensure backup directory exists
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const results: string[] = [];

  // 1. Git backup of workspace data
  try {
    const { stdout: status } = await execAsync('git status --porcelain data/ prompt-templates/', {
      cwd: path.resolve('.'),
    });
    if (status.trim()) {
      await execAsync('git add data/ prompt-templates/', { cwd: path.resolve('.') });
      const dateStr = new Date().toISOString().split('T')[0];
      await execAsync(`git commit -m "[auto-backup] Daily backup ${dateStr}"`, {
        cwd: path.resolve('.'),
      });
      results.push(`Git backup committed: ${dateStr}`);
    } else {
      results.push('Git backup: no changes to commit');
    }
  } catch (err) {
    results.push(`Git backup failed: ${(err as Error).message}`);
  }

  // 2. Export database summary (lightweight — just counts and checksums, not full dump)
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const summaryPath = path.join(BACKUP_DIR, `db-summary-${timestamp}.json`);

    // Use Supabase client to get table counts
    try {
      const { getSupabase } = await import('../integrations/supabase.js');
      const sb = getSupabase();
      if (sb) {
        const tables = [
          'floors',
          'tasks',
          'cost_events',
          'notifications',
          'floor_chat_messages',
          'orders',
          'ad_campaigns',
          'content_queue',
        ];
        const counts: Record<string, number> = {};
        for (const table of tables) {
          try {
            const { count } = await sb.from(table).select('*', { count: 'exact', head: true });
            counts[table] = count ?? 0;
          } catch {
            counts[table] = -1; // error retrieving count
          }
        }
        writeFileSync(summaryPath, JSON.stringify({ timestamp, counts }, null, 2));
        results.push(`DB summary written: ${summaryPath}`);
      } else {
        results.push('DB summary skipped: Supabase not connected');
      }
    } catch (supabaseErr) {
      results.push(`DB summary failed: ${(supabaseErr as Error).message}`);
    }
  } catch (err) {
    results.push(`DB summary export failed: ${(err as Error).message}`);
  }

  // 3. Prune old backups
  try {
    const cutoff = Date.now() - MAX_BACKUP_AGE_DAYS * 24 * 60 * 60 * 1000;
    const files = readdirSync(BACKUP_DIR);
    let pruned = 0;
    for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file);
      const stat = statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(filePath);
        pruned++;
      }
    }
    if (pruned > 0) results.push(`Pruned ${pruned} old backup files`);
  } catch (err) {
    results.push(`Prune failed: ${(err as Error).message}`);
  }

  return {
    success: !results.some((r) => r.includes('failed')),
    message: results.join('; '),
  };
}

/**
 * Schedule daily backup (called from Orchestrator start()).
 * Runs at 3 AM local time.
 */
export function scheduleDailyBackup(): NodeJS.Timeout {
  const MS_PER_HOUR = 60 * 60 * 1000;

  // Run every 24 hours at 3 AM local time
  const schedule = setInterval(async () => {
    const hour = new Date().getHours();
    if (hour === 3) {
      // Only run at 3 AM
      console.log('[Backup] Starting daily backup...');
      const result = await runDailyBackup();
      console.log(`[Backup] ${result.success ? '✓' : '✗'} ${result.message}`);
    }
  }, MS_PER_HOUR);

  return schedule;
}
