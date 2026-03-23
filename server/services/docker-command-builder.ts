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
  /** Host path for the Arduino compiler cache. When set, the directory is
   *  bind-mounted into the container at the same path and ARDUINO_CACHE_DIR
   *  is forwarded as an environment variable so the compiler inside the
   *  container writes artefacts to the persisted host location. */
  arduinoCacheDir?: string;
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
      "-v",
      `${realSketchDir}:/sandbox:rw`, // Mount sketch directory (realpath resolves macOS /tmp symlink)
      // Cache volume: only added when a host cache dir is configured
      ...(options.arduinoCacheDir
        ? [
            "-v",
            `${options.arduinoCacheDir}:${options.arduinoCacheDir}`,
            "-e",
            `ARDUINO_CACHE_DIR=${options.arduinoCacheDir}`,
          ]
        : []),
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
      "g++ /sandbox/sketch.cpp -o /tmp/sketch -pthread 2>&1 && /tmp/sketch",
    ];
  }
}
