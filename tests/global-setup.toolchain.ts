import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { config } from "../server/config";

/** Provisions storage/libraries once per run, so toolchain files can run in parallel without racing over it. */
export function setup(): void {
  execFileSync(process.execPath, [resolve(__dirname, "../scripts/provision-libraries.mjs"), "--root", config.compilation.librariesDir], { stdio: "pipe" });
}
