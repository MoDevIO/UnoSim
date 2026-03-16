/**
 * FilesystemHelper: Manages temporary directory operations, cleanup, and path utilities
 * Extracted from Etappe C: Filesystem & Path Operations refactoring
 */

import { existsSync, renameSync, rmSync } from "node:fs";
import { Logger } from "@shared/logger";
import type { SketchFileBuilder } from "../sketch-file-builder";
import type { LocalCompiler } from "../local-compiler";

interface FilesystemHelperState {
  currentSketchDir: string | null;
  isCompiling: boolean;
  pendingCleanup: boolean;
  cleanupRetries: Map<string, number>;
  currentRegistryFile: string | null;
}

export class FilesystemHelper {
  private readonly logger = new Logger("FilesystemHelper");

  constructor(
    private readonly fileBuilder: SketchFileBuilder,
    private readonly localCompiler: LocalCompiler,
  ) {}

  /**
   * Check if compilation is currently in progress (blocks cleanup)
   */
  isCompilationInProgress(state: FilesystemHelperState): boolean {
    return state.isCompiling || this.localCompiler.isBusy;
  }

  /**
   * Check if a directory exists and is ready for cleanup
   */
  canCleanup(dir: string): boolean {
    return !!dir && existsSync(dir);
  }

  /**
   * Clear temporary directory from tracking after successful cleanup
   */
  clearTempDirTracking(state: FilesystemHelperState, dir: string): void {
    this.fileBuilder.clearCreatedSketchDir(dir);
    state.currentSketchDir = null;
    state.pendingCleanup = false;
  }

  /**
   * Mark a registry file for delayed cleanup
   */
  markRegistryForCleanup(state: FilesystemHelperState): void {
    if (state.currentRegistryFile && existsSync(state.currentRegistryFile)) {
      try {
        // Rename .pending.json to .cleanup.json
        const cleanupFile = state.currentRegistryFile.replaceAll(".pending.json", ".cleanup.json");
        renameSync(state.currentRegistryFile, cleanupFile);
        this.logger.debug(`Marked registry for cleanup: ${cleanupFile}`);
        state.currentRegistryFile = null;
      } catch (err) {
        this.logger.warn(
          `Failed to mark registry for cleanup: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Attempts to remove a directory with fallback strategies
   * Returns true if cleanup succeeded, false otherwise
   */
  attemptCleanupDir(dir: string): boolean {
    try {
      const cleanupDir = dir + ".cleanup";
      renameSync(dir, cleanupDir);
      this.logger.debug(`Marked temp directory for cleanup: ${cleanupDir}`);
      return true;
    } catch (err) {
      try {
        rmSync(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
        this.logger.debug(`Removed temp directory directly: ${dir}`);
        return true;
      } catch (rmErr) {
        this.logger.warn(
          `Failed to mark temp directory for cleanup: ${err instanceof Error ? err.message : String(err)}; remove failed: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
        );
        return false;
      }
    }
  }

  /**
   * Schedule a cleanup retry with exponential backoff
   */
  scheduleCleanupRetry(state: FilesystemHelperState, dir: string): void {
    const attempts = (state.cleanupRetries.get(dir) ?? 0) + 1;
    state.cleanupRetries.set(dir, attempts);
    if (attempts > 8) return;

    const delayMs = Math.min(200 + attempts * 150, 2000);
    const timer = setTimeout(() => {
      if (!existsSync(dir)) {
        state.cleanupRetries.delete(dir);
        this.fileBuilder.clearCreatedSketchDir(dir);
        return;
      }
      const cleaned = this.attemptCleanupDir(dir);
      if (cleaned) {
        state.cleanupRetries.delete(dir);
        this.fileBuilder.clearCreatedSketchDir(dir);
      } else {
        this.scheduleCleanupRetry(state, dir);
      }
    }, delayMs);

    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  /**
   * Attempts to remove the current sketch directory. If compilation is still
   * in progress, defers cleanup; the compile finisher will retry later.
   *
   * Defensive guard against race conditions where the linker writes the
   * executable while cleanup tries to delete the temp directory.
   */
  markTempDirForCleanup(state: FilesystemHelperState): void {
    if (!state.currentSketchDir) return;

    // Defer if compile is still running
    if (this.isCompilationInProgress(state)) {
      this.logger.debug("cleanup deferred until compile finishes");
      state.pendingCleanup = true;
      return;
    }

    const dir = state.currentSketchDir;
    if (!this.canCleanup(dir)) {
      this.clearTempDirTracking(state, dir);
      return;
    }

    const cleaned = this.attemptCleanupDir(dir);
    if (cleaned) {
      this.clearTempDirTracking(state, dir);
    } else {
      this.scheduleCleanupRetry(state, dir);
    }
  }
}
