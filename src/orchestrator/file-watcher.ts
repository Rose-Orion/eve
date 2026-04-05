/**
 * FileWatcher — watches workspace directories for agent output files.
 * Uses chokidar to detect when agents write files to the workspace.
 * Emits agent:output-detected events when expected output files appear.
 */

import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { join, relative } from 'node:path';
import { getConfig } from '../config/index.js';
import type { EventBus } from './event-bus.js';

interface WatchedFloor {
  floorSlug: string;
  floorId: string;
  watcher: FSWatcher;
}

export class FileWatcher {
  private watchers = new Map<string, WatchedFloor>();
  private projectsDir: string;

  constructor(private eventBus: EventBus) {
    this.projectsDir = getConfig().PROJECTS_DIR;
  }

  /** Start watching a floor's workspace directory. */
  watchFloor(floorId: string, floorSlug: string): void {
    if (this.watchers.has(floorId)) return;

    const floorDir = join(this.projectsDir, floorSlug);
    const watcher = watch(floorDir, {
      ignoreInitial: true,
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/*.log',
        '**/.next/**',
        '**/.vercel/**',
        '**/dist/**',
      ],
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 200,
      },
    });

    watcher.on('add', (filePath) => {
      const relPath = relative(floorDir, filePath);
      this.eventBus.emit('agent:output-detected', {
        taskId: '', // Orchestrator matches by file path
        floorId,
        filePath: relPath,
      });
    });

    watcher.on('change', (filePath) => {
      const relPath = relative(floorDir, filePath);
      this.eventBus.emit('agent:output-detected', {
        taskId: '',
        floorId,
        filePath: relPath,
      });
    });

    this.watchers.set(floorId, { floorSlug, floorId, watcher });
  }

  /** Stop watching a floor's workspace. */
  async unwatchFloor(floorId: string): Promise<void> {
    const watched = this.watchers.get(floorId);
    if (watched) {
      await watched.watcher.close();
      this.watchers.delete(floorId);
    }
  }

  /** Stop all watchers. */
  async stopAll(): Promise<void> {
    for (const watched of this.watchers.values()) {
      await watched.watcher.close();
    }
    this.watchers.clear();
  }
}
