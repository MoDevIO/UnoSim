import { realpathSync } from "node:fs";

// Match the existing 64 MiB transient /tmp ceiling while keeping runtime-relative
// writes and the compiled executable off the host-backed source bind.
const SANDBOX_WORK_SIZE_MB = 64;
const SANDBOX_WORK_MAX_INODES = 4096;

/**
 * Docker Command Builder
 * 
 * Handles the construction of secure Docker run commands with all necessary
 * security constraints and resource limits for Arduino sketch execution.
 */

interface DockerRunOptions {
  sketchDir: string;
  memoryMB: number;
  user?: string;
  cpuLimit: string;
  pidsLimit: number;
  imageName: string;
  command: string[];
  containerName?: string;
  labels?: string[];
}

export class DockerCommandBuilder {
  /**
   * Builds a secure Docker run command with all security constraints
   * 
   * @param options - Docker run configuration
   * @returns Array of command arguments for spawn
   */
  static buildSecureRunCommand(options: DockerRunOptions): string[] {
    // Resolve symlinks so Docker Desktop on macOS gets the real path (e.g. /private/tmp not /tmp)
    let realSketchDir = options.sketchDir;
    try { realSketchDir = realpathSync(options.sketchDir); } catch { /* keep original */ }
    return [
      "run",
      "--rm", // Remove container after exit
      ...(options.containerName ? ["--name", options.containerName] : []),
      ...(options.labels ?? []).flatMap((label) => ["--label", label]),
      "-i", // Interactive mode for stdin
      "--network",
      "none", // No network access
      "--memory",
      `${options.memoryMB}m`, // Memory limit
      "--memory-swap",
      `${options.memoryMB}m`, // Disable swap
      "--cpus",
      options.cpuLimit, // CPU limit (e.g., "0.5" for 50%)
      "--pids-limit",
      String(options.pidsLimit), // Limit number of processes
      ...(options.user ? ["--user", options.user] : []),
      "--security-opt",
      "no-new-privileges", // Prevent privilege escalation
      "--cap-drop",
      "ALL", // Drop all Linux capabilities
      "--read-only", // Keep the container root filesystem immutable
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,noexec,mode=1777,size=64m", // Only bounded transient runtime storage
      "--tmpfs",
      `/sandbox-work:rw,nosuid,nodev,exec,mode=1777,size=${SANDBOX_WORK_SIZE_MB}m,nr_inodes=${SANDBOX_WORK_MAX_INODES}`,
      "-v",
      `${realSketchDir}:/sandbox:ro`, // Source and headers are visible to the compiler, never writable by sketch code
      options.imageName,
      ...options.command, // Execution command
    ];
  }

  /**
   * Builds the compile and run command for Docker
   */
  static buildCompileAndRunCommand(maxLifetimeSeconds: number): string[] {
    return [
      // Independent hard lifetime: the container ends after this wall-clock
      // time even if the backend that would stop it has died. As PID 1 the
      // timeout takes the whole container down with it.
      "timeout",
      "--signal=KILL",
      String(maxLifetimeSeconds),
      "sh",
      "-c",
      // The echo marker is the only signal that compilation succeeded. This
      // matters because g++ stderr is redirected to stdout above; compiler
      // diagnostics must not be mistaken for runtime output.
      "g++ -I/sandbox /sandbox/sketch.cpp -o /sandbox-work/sketch -pthread 2>&1 && echo '[[RUNTIME_START]]' && cd /sandbox-work && ./sketch",
    ];
  }
}
