import { existsSync } from "fs";
import { tmpdir } from "os";

export function getFastTmpBaseDir(): string {
  if (process.platform === "linux" && existsSync("/dev/shm")) {
    return "/dev/shm";
  }
  return tmpdir();
}
