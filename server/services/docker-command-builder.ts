import { realpathSync } from "node:fs";

/**
 * Docker Command Builder
 * 
 * Handles the construction of secure Docker run commands with all necessary
 * security constraints and resource limits for Arduino sketch execution.
 */

interface DockerRunOptions {
  sketchDir: string;
  memoryMB: number;
  cpuLimit: string;
  pidsLimit: number;
  imageName: string;
  command: string[];
  containerName?: string;
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
      "--security-opt",
      "no-new-privileges", // Prevent privilege escalation
      "--cap-drop",
      "ALL", // Drop all Linux capabilities
      "--read-only", // Keep the container root filesystem immutable
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,noexec,mode=1777,size=64m", // Only bounded transient runtime storage
      "-v",
      `${realSketchDir}:/sandbox:rw`, // Mount sketch directory (realpath resolves macOS /tmp symlink)
      options.imageName,
      ...options.command, // Execution command
    ];
  }

  /**
   * Builds the compile and run command for Docker
   */
  static buildCompileAndRunCommand(): string[] {
    return [
      "sh",
      "-c",
      // The echo marker ensures that a successful silent compilation (no
      // warnings, no output) still triggers an onStdout event so that
      // isCompilePhase is reset before the sketch starts writing to stderr.
      // Without this, isCompilePhase would stay true and all runtime stderr
      // (SERIAL_EVENT, IO_REGISTRY, …) would accumulate in compileErrorBuffer,
      // causing a spurious 'compilation_error' message on process exit.
      "g++ /sandbox/sketch.cpp -o /sandbox/sketch -pthread 2>&1 && echo '[[RUNTIME_START]]' && /sandbox/sketch",
    ];
  }
}
