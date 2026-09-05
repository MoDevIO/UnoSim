import { mkdir, rm, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Logger } from "@shared/logger";

const logger = new Logger("TempFS");

/**
 * Robust cleanup function that handles file locking on Windows/Unix.
 * Uses rename-before-delete to work around EPERM and EBUSY errors.
 */
export async function robustCleanupDir(dirPath: string): Promise<void> {
  const maxRetries = 3;
  const retryDelayMs = 100;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Fast path: try direct deletion first
      await rm(dirPath, { recursive: true, force: true });
      logger.debug(`Successfully deleted ${dirPath}`);
      return;
    } catch (directError) {
      logger.debug(
        `Direct delete failed (attempt ${attempt + 1}/${maxRetries}): ${directError}`,
      );

      // If not the last attempt, try the rename-trick
      if (attempt < maxRetries - 1) {
        try {
          // Rename to a trash path to work around file locks
          const trashPath = `${dirPath}.trash.${randomUUID()}`;
          logger.debug(
            `Attempting rename-before-delete: ${dirPath} -> ${trashPath}`,
          );
          await rename(dirPath, trashPath);

          // Try to delete the trash path in the background (non-blocking)
          rm(trashPath, { recursive: true, force: true }).catch((trashError) => {
            logger.warn(
              `Failed to delete trash directory ${trashPath}: ${trashError}`,
            );
            // This is non-critical; we got the original dir out of the way
          });
          return;
        } catch (renameError) {
          logger.debug(`Rename-trick failed: ${renameError}`);
          // Fall through to next retry or throw
        }
      }
    }

    // If not the last attempt, wait before retrying
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  // Last resort: log a warning but don't throw
  // The OS will clean up temp directories eventually
  logger.warn(
    `Failed to clean up ${dirPath} after ${maxRetries} attempts. It will be cleaned up by the OS.`,
  );
}

/**
 * Ensures all required temporary and cache directories exist.
 */
export async function ensureTempDirs(dirs: {
  tempDir: string;
  hexCacheDir: string;
  buildCachePath: string;
  binaryStorageDir: string;
}): Promise<void> {
  try {
    await mkdir(dirs.tempDir, { recursive: true });
    await mkdir(dirs.hexCacheDir, { recursive: true });
    await mkdir(dirs.buildCachePath, { recursive: true });
    await mkdir(dirs.binaryStorageDir, { recursive: true });
  } catch (error) {
    logger.warn(
      `Failed to create temp directory: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/**
 * Remove sketch-specific temporary directories created during compilation.
 */
export async function cleanupSketchDirs(
  sketchDir: string,
  baseTempDir: string,
  tempRoot?: string,
): Promise<void> {
  try {
    await robustCleanupDir(sketchDir);
  } catch (error) {
    logger.warn(`Failed to clean up sketch directory: ${error}`);
  }
  if (!tempRoot) {
    try {
      await robustCleanupDir(baseTempDir);
    } catch (error) {
      logger.warn(`Failed to remove base temp directory: ${error}`);
    }
  }
}
