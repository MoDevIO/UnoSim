import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type CommandResult = { stdout: string; stderr?: string };
type CommandRunner = (file: string, args: string[]) => Promise<CommandResult>;

type OptionalHostSignals = {
  physicalMemoryBytes: number | null;
  loadAverage: number[] | null;
  availableMemoryBytes: number | null;
  swapUsedBytes: number | null;
  iowaitPercent: number | null;
  thermalPressure: string | null;
};

export type HostProbeDependencies = {
  run: CommandRunner;
  logicalCpus: () => number;
  architecture: string;
  nodeVersion: string;
  optional?: OptionalHostSignals;
};

export type HostProbe = {
  required: { gitSha: string; gitDirty: boolean; nodeVersion: string; architecture: string; logicalCpus: number };
  optional: OptionalHostSignals;
  safetySignals: { cpuAvailable: boolean; memoryAvailable: boolean };
};

export type DockerProbeDependencies = {
  run: (args: string[]) => Promise<CommandResult>;
};

export type DockerProbe = {
  clientVersion: string;
  serverVersion: string;
  architecture: string;
  cpus: number;
  memoryBytes: number;
  storageDriver: string;
  daemonHealthy: boolean;
  image: { reference: string; id: string; digest: string | null };
  runningContainers: Array<{ id: string; name: string; image: string; status: string; labels: Record<string, string> }>;
};

export type ControlLatencySample = {
  command: string;
  condition: "idle" | "parallel";
  durationsMs: number[];
  error: string | null;
};

export type ControlDependencies = {
  run: (args: string[]) => Promise<CommandResult>;
  now?: () => number;
};

const defaultRun: CommandRunner = async (file, args) => {
  const result = await execFileAsync(file, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
};

function defaultHostDependencies(): HostProbeDependencies {
  return {
    run: defaultRun,
    logicalCpus: () => os.cpus().length,
    architecture: process.arch,
    nodeVersion: process.version,
    optional: {
      physicalMemoryBytes: os.totalmem(),
      loadAverage: os.loadavg(),
      availableMemoryBytes: os.freemem(),
      swapUsedBytes: null,
      iowaitPercent: null,
      thermalPressure: null,
    },
  };
}

function parseJson<T>(stdout: string, label: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function collectHostProbe(deps: Partial<HostProbeDependencies> = {}): Promise<HostProbe> {
  const resolved = { ...defaultHostDependencies(), ...deps } as HostProbeDependencies;
  const gitSha = (await resolved.run("git", ["rev-parse", "HEAD"])).stdout.trim();
  if (!gitSha) throw new Error("Git SHA probe returned no value");
  const gitStatus = (await resolved.run("git", ["status", "--porcelain"])).stdout;
  const logicalCpus = resolved.logicalCpus();
  if (!Number.isInteger(logicalCpus) || logicalCpus < 1) throw new Error("Logical CPU probe returned an invalid value");
  const optional = resolved.optional ?? defaultHostDependencies().optional!;
  return {
    required: {
      gitSha,
      gitDirty: gitStatus.trim().length > 0,
      nodeVersion: resolved.nodeVersion,
      architecture: resolved.architecture,
      logicalCpus,
    },
    optional,
    safetySignals: {
      cpuAvailable: logicalCpus > 0,
      memoryAvailable: optional.availableMemoryBytes !== null && optional.availableMemoryBytes > 0,
    },
  };
}

function parseLabels(value: unknown): Record<string, string> {
  if (typeof value !== "string") return {};
  return Object.fromEntries(value.split(",").map((entry) => {
    const separator = entry.indexOf("=");
    return separator < 0 ? [entry, ""] : [entry.slice(0, separator), entry.slice(separator + 1)];
  }).filter(([key]) => key.length > 0));
}

export async function collectDockerProbe(
  image: string,
  deps: Partial<DockerProbeDependencies> = {},
): Promise<DockerProbe> {
  const run = deps.run ?? (async (args) => {
    const result = await execFileAsync("docker", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  });
  const version = (await run(["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"])).stdout.trim().split("|");
  const info = parseJson<Record<string, unknown>>((await run(["info", "--format", "{{json .}}"])).stdout, "docker info");
  const imageRows = parseJson<unknown>((await run(["image", "inspect", image, "--format", "{{json .}}"])).stdout, "docker image inspect");
  const inspectedImage = Array.isArray(imageRows) ? imageRows[0] as Record<string, unknown> : imageRows as Record<string, unknown>;
  const containers = (await run(["ps", "--format", "{{json .}}"])).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJson<Record<string, unknown>>(line, "docker ps"))
    .map((row) => ({
      id: String(row.ID ?? ""),
      name: String(row.Names ?? ""),
      image: String(row.Image ?? ""),
      status: String(row.Status ?? ""),
      labels: parseLabels(row.Labels),
    }));
  const cpus = Number(info.NCPU);
  const memoryBytes = Number(info.MemTotal);
  if (!Number.isFinite(cpus) || cpus < 1 || !Number.isFinite(memoryBytes) || memoryBytes <= 0) {
    throw new Error("Docker info returned invalid CPU or memory values");
  }
  const id = String(inspectedImage.Id ?? "");
  if (!id) throw new Error(`Docker image ${image} has no image ID`);
  const digests = Array.isArray(inspectedImage.RepoDigests) ? inspectedImage.RepoDigests : [];
  return {
    clientVersion: version[0] ?? "unknown",
    serverVersion: version[1] ?? "unknown",
    architecture: String(info.Architecture ?? "unknown"),
    cpus,
    memoryBytes,
    storageDriver: String(info.Driver ?? "unknown"),
    daemonHealthy: true,
    image: { reference: image, id, digest: digests.length > 0 ? String(digests[0]) : null },
    runningContainers: containers,
  };
}

function controlCommands(image: string): Array<{ name: string; args: string[] }> {
  return [
    { name: "docker --version", args: ["--version"] },
    { name: "docker info", args: ["info"] },
    { name: `docker image inspect ${image}`, args: ["image", "inspect", image] },
  ];
}

async function timedControlCall(
  command: { name: string; args: string[] },
  run: ControlDependencies["run"],
  now: () => number,
): Promise<{ durationMs: number | null; error: string | null }> {
  const startedAt = now();
  try {
    await run(command.args);
    return { durationMs: Math.max(0, now() - startedAt), error: null };
  } catch (error) {
    return { durationMs: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function measureControlSeries(
  command: { name: string; args: string[] },
  count: number,
  parallelism: number,
  run: ControlDependencies["run"],
  now: () => number,
): Promise<{ durationsMs: number[]; error: string | null }> {
  const durationsMs: number[] = [];
  let error: string | null = null;
  for (let sample = 0; sample < count; sample += 1) {
    const measurements = await Promise.all(
      Array.from({ length: parallelism }, () => timedControlCall(command, run, now)),
    );
    for (const measurement of measurements) {
      if (measurement.durationMs !== null) durationsMs.push(measurement.durationMs);
      error ??= measurement.error;
    }
  }
  return { durationsMs, error };
}

export async function measureDockerControlLatency(
  image: string,
  parallelism: number,
  samples: number,
  deps: Partial<ControlDependencies> = {},
): Promise<ControlLatencySample[]> {
  if (!Number.isInteger(parallelism) || parallelism < 1) throw new Error("parallelism must be a positive integer");
  if (!Number.isInteger(samples) || samples < 1) throw new Error("samples must be a positive integer");
  const run = deps.run ?? (async (args) => {
    const result = await execFileAsync("docker", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  });
  const now = deps.now ?? (() => Number(process.hrtime.bigint()) / 1_000_000);
  const commands = controlCommands(image);
  const result: ControlLatencySample[] = [];
  for (const command of commands) {
    const idle = await measureControlSeries(command, samples, 1, run, now);
    result.push({ command: command.name, condition: "idle", ...idle });
    const parallel = await measureControlSeries(command, samples, parallelism, run, now);
    result.push({ command: command.name, condition: "parallel", ...parallel });
  }
  return result;
}
