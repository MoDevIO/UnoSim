import fs from "node:fs/promises";
import path from "node:path";
import type { CalibrationRunResult } from "./calibrate-capacity";

export function renderCalibrationMarkdown(result: CalibrationRunResult): string {
  const { host, docker, effectiveCapacity } = result.fingerprint;
  const recommendationRows = Object.entries(result.recommendations)
    .map(([name, recommendation]) => `| ${name} | ${recommendation.value ?? "—"} | ${recommendation.status} | ${recommendation.confidence} | ${recommendation.measuredBasis.join("; ") || "—"} | ${recommendation.warnings.join("; ") || "—"} |`)
    .join("\n");
  const controlRows = result.phases.dockerControl
    .map((sample) => `| ${sample.command} | ${sample.condition} | ${sample.durationsMs.join(", ") || "—"} | ${sample.error ?? "—"} |`)
    .join("\n");
  return [
    "# UnoSim Capacity Calibration",
    "",
    `schemaVersion: ${result.schemaVersion}`,
    `policyVersion: ${result.policyVersion}`,
    `Partial run: ${result.partial ? "yes" : "no"}`,
    `Stop reason: ${result.stopReason ?? "none"}`,
    "",
    "## Reproducibility",
    "",
    `- Git SHA: ${result.fingerprint.gitSha}`,
    `- Git dirty: ${result.fingerprint.gitDirty}`,
    `- Node: ${host.required.nodeVersion}`,
    `- Architecture: ${host.required.architecture}`,
    `- Logical CPUs: ${host.required.logicalCpus}`,
    `- Docker: ${docker.clientVersion} / ${docker.serverVersion}`,
    `- Docker architecture: ${docker.architecture}`,
    `- Docker CPUs/RAM: ${docker.cpus} / ${docker.memoryBytes} bytes`,
    `- Storage driver: ${docker.storageDriver}`,
    `- Sandbox image: ${docker.image.reference} (${docker.image.id}, ${docker.image.digest ?? "no digest"})`,
    "",
    "## Effective capacity before calibration",
    "",
    "```json",
    JSON.stringify(effectiveCapacity, null, 2),
    "```",
    "",
    "## Policy",
    "",
    `- Expected users: ${result.policy.expectedUsers}`,
    `- Target CPU p95: ${result.policy.targetCpuPercent}%`,
    `- Hard CPU ceiling: ${result.policy.maxCpuPercent}%`,
    `- Maximum user wait: ${result.policy.maxUserWaitSec}s`,
    `- Fixed classroom simulation duration: ${result.policy.classroomDurationSec}s`,
    `- Classroom measurement queue timeout: ${result.fingerprint.measurementQueueTimeoutMs}ms (test-only)`,
    `- Active candidates: ${result.plan.activeCandidates.join(", ")}`,
    `- Startup candidates: ${result.plan.startupCandidates.join(", ")}`,
    "",
    "## Recommendations",
    "",
    "| Setting | Value | Status | Confidence | Measured basis | Warnings |",
    "| --- | ---: | --- | --- | --- | --- |",
    recommendationRows,
    "",
    "The values above are review recommendations only. No production configuration was changed.",
    "",
    "## Docker-control measurements",
    "",
    "| Command | Condition | Durations (ms) | Error |",
    "| --- | --- | --- | --- |",
    controlRows || "| — | — | — | — |",
    "",
    "## Phase results",
    "",
    `- Active measurements: ${result.phases.active.length}`,
    `- Startup measurements: ${result.phases.startup.length}`,
    `- Classroom measurement: ${result.phases.classroom ? "completed" : "not run"}`,
    ...(result.phases.classroom ? [
      `- Classroom outcomes: requested=${result.phases.classroom.requested}, admitted=${result.phases.classroom.admitted}, started=${result.phases.classroom.started}, successful=${result.phases.classroom.successful}, rejected=${result.phases.classroom.rejected}, failed=${result.phases.classroom.failed}, incomplete=${result.phases.classroom.incomplete}`,
    ] : []),
    `- Safety events: ${result.safetyEvents.length}`,
    `- Remaining owned containers: ${result.cleanup.remainingCapacityContainers}`,
    "",
    "## Safety and cleanup",
    "",
    result.safetyEvents.length > 0
      ? result.safetyEvents.map((event) => `- [${event.phase}/${event.kind}] ${event.message}`).join("\n")
      : "No safety events were recorded.",
    `- Backend exited: ${result.cleanup.backendExited}`,
    `- Active simulations after cleanup: ${result.cleanup.activeSimulationCount ?? "unknown"}`,
    `- Queue after cleanup: ${result.cleanup.queueWaiting ?? "unknown"}`,
    "",
    "Review the generated `capacity.env` before applying any value.",
    "",
  ].join("\n");
}

export function renderCapacityEnv(result: CalibrationRunResult): string {
  const lines = [
    "# UnoSim capacity calibration proposal",
    "# REVIEW ONLY: review this file before applying; it is not applied automatically.",
    `# Git SHA: ${result.fingerprint.gitSha}`,
    `# Policy version: ${result.policyVersion}`,
    "",
  ];
  const classroom = result.phases.classroom;
  const admissionValidated = classroom !== null
    && classroom.requested === result.policy.expectedUsers
    && classroom.admitted >= result.policy.expectedUsers
    && classroom.started === result.policy.expectedUsers
    && classroom.successful === result.policy.expectedUsers
    && classroom.rejected === 0
    && classroom.failed === 0
    && classroom.incomplete === 0
    && classroom.errors.length === 0
    && classroom.runtimeConfiguration.simulationAdmissionMax >= result.policy.expectedUsers
    && classroom.cleanup.remainingCapacityContainers === 0
    && classroom.cleanup.activeSimulationCount === 0
    && classroom.cleanup.queueWaiting === 0
    && classroom.cleanup.admissionCurrent === 0
    && classroom.cleanup.sandboxStartActive === 0
    && classroom.cleanup.sandboxStartWaiting === 0;
  const values: Array<[string, keyof CalibrationRunResult["recommendations"]]> = [
    ["SIMULATION_MAX_CONCURRENT", "simulationMaxConcurrent"],
    ["SANDBOX_START_MAX_CONCURRENT", "sandboxStartMaxConcurrent"],
    ["SIMULATION_ADMISSION_MAX", "simulationAdmissionMax"],
    ["SIMULATION_QUEUE_TIMEOUT_MS", "simulationQueueTimeoutMs"],
    ["SANDBOX_START_SLOT_TIMEOUT_MS", "sandboxStartSlotTimeoutMs"],
    ["DOCKER_CONTROL_TIMEOUT_MS", "dockerControlTimeoutMs"],
    ["COMPILE_MAX_CONCURRENT", "compileMaxConcurrent"],
  ];
  for (const [environmentName, recommendationName] of values) {
    const recommendation = result.recommendations[recommendationName];
    if (recommendationName === "simulationAdmissionMax" && !admissionValidated) {
      lines.push(`# ${environmentName} omitted: classroom admission validation not completed successfully`);
      continue;
    }
    if (recommendation.status === "recommended" && recommendation.value !== null) {
      lines.push(`${environmentName}=${recommendation.value}`);
    } else {
      lines.push(`# ${environmentName} omitted: ${recommendation.status}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export async function writeCalibrationArtifacts(
  result: CalibrationRunResult,
  outputDir: string,
): Promise<{ jsonPath: string; markdownPath: string; envPath: string }> {
  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "capacity-calibration.json");
  const markdownPath = path.join(outputDir, "capacity-calibration.md");
  const envPath = path.join(outputDir, "capacity.env");
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`),
    fs.writeFile(markdownPath, renderCalibrationMarkdown(result)),
    fs.writeFile(envPath, renderCapacityEnv(result)),
  ]);
  return { jsonPath, markdownPath, envPath };
}
