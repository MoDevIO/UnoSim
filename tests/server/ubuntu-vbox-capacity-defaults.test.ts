import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_SIMULATIONS_PER_SUBJECT, SimulationAdmissionController } from "../../server/services/simulation-admission-controller";

const repoRoot = join(__dirname, "../..");

function renderInstallerEnv(): Record<string, string> {
  const output = execFileSync("bash", [
    join(repoRoot, "scripts/ubuntu-vbox-render.sh"), "env", "--lan-ip", "192.168.10.20", "--docker-gid", "115",
  ], { input: `${"s".repeat(40)}\n`, encoding: "utf8" });
  return Object.fromEntries(output.trim().split("\n").map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

describe("Ubuntu/VBox installer capacity defaults", () => {
  it("renders the admission limit measured on the reference VM", () => {
    const admission = Number(renderInstallerEnv().SIMULATION_ADMISSION_MAX);

    // A class of about 30 learners plus reserve for extra tabs and restarts.
    expect(Number.isInteger(admission)).toBe(true);
    expect(admission).toBeGreaterThanOrEqual(30);
    expect(admission).toBe(40);
  });

  it("passes the rendered value through Compose and keeps the application default elsewhere", () => {
    const compose = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
    expect(compose).toContain("- SIMULATION_ADMISSION_MAX=${SIMULATION_ADMISSION_MAX:-25}");
  });

  it("keeps the per-subject and global admission limits effective at the installer value", () => {
    const admission = Number(renderInstallerEnv().SIMULATION_ADMISSION_MAX);
    const controller = new SimulationAdmissionController(admission);

    const tabs = Array.from({ length: DEFAULT_MAX_SIMULATIONS_PER_SUBJECT + 1 }, () => controller.reserve("ip-10.0.0.1"));
    expect(tabs.filter((result) => result.admitted)).toHaveLength(DEFAULT_MAX_SIMULATIONS_PER_SUBJECT);
    expect(tabs.at(-1)).toEqual({ admitted: false, reason: "identity" });

    for (let learner = 2; controller.getStats().active < admission; learner++) controller.reserve(`ip-10.0.0.${learner}`);
    expect(controller.getStats().active).toBe(admission);
    expect(controller.reserve("ip-10.0.1.1")).toEqual({ admitted: false, reason: "capacity" });
  });
});
