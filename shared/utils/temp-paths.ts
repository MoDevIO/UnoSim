import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

export function getFastTmpBaseDir(): string {
  if (process.platform === "linux" && existsSync("/dev/shm")) {
    return "/dev/shm";
  }
  return tmpdir();
}
