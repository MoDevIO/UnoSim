/**
 * Docker Command Builder
 * 
 * Handles the construction of secure Docker run commands with all necessary
 * security constraints and resource limits for Arduino sketch execution.
 */

export interface DockerRunOptions {
  sketchDir: string;
  memoryMB: number;
  cpuLimit: string;
  pidsLimit: number;
  imageName: string;
  command: string[];
}

export class DockerCommandBuilder {
  /**
   * Builds a secure Docker run command with all security constraints
   * 
   * @param options - Docker run configuration
   * @returns Array of command arguments for spawn
   */
  static buildSecureRunCommand(options: DockerRunOptions): string[] {
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
      `${options.sketchDir}:/sandbox:rw`, // Mount sketch directory
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
