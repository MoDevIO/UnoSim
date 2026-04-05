import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

export function getFastTmpBaseDir(): string {
  const configuredTempDir = process.env.UNOSIM_SHARED_TEMP_DIR?.trim();
  if (configuredTempDir) {
    return configuredTempDir;
  }

  if (process.platform === "linux" && existsSync("/dev/shm")) {
    return "/dev/shm";
  }
  return tmpdir();
}
