/**
 * Test-Suite für SandboxRunner
 * Tests für sichere Code-Ausführung mit Docker-Sandbox
 */

// Store original setTimeout
const originalSetTimeout = global.setTimeout;

// Mock child_process
const spawnInstances: any[] = [];

jest.mock("child_process", () => ({
  spawn: jest.fn(() => {
    const proc = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      stdin: { write: jest.fn() },
      on: jest.fn(),
      kill: jest.fn(),
      killed: false,
    };
    spawnInstances.push(proc);
    return proc;
  }),
  execSync: jest.fn(),
}));

jest.mock("fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
}));

import { spawn, execSync } from "child_process";
import { mkdir, writeFile, rm, chmod } from "fs/promises";
import { SandboxRunner } from "../../../server/services/sandbox-runner";

describe("SandboxRunner", () => {
  const wait = (ms = 10) => new Promise(resolve => originalSetTimeout(resolve, ms));

  beforeEach(() => {
    spawnInstances.length = 0;
    (mkdir as jest.Mock).mockClear();
    (writeFile as jest.Mock).mockClear();
    (rm as jest.Mock).mockClear();
    (chmod as jest.Mock).mockClear();
    (spawn as jest.Mock).mockClear();
    (execSync as jest.Mock).mockClear();
    
    jest.spyOn(global, 'setTimeout');
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Docker Availability Detection", () => {
    it("should detect when Docker is available and image exists", () => {
      // Mock successful docker checks
      (execSync as jest.Mock)
        .mockReturnValueOnce(Buffer.from("Docker version 24.0.0"))  // docker --version
        .mockReturnValueOnce(Buffer.from("{}"))                      // docker info
        .mockReturnValueOnce(Buffer.from("[]"));                     // docker image inspect

      const runner = new SandboxRunner();
      const status = runner.getSandboxStatus();

      expect(status.dockerAvailable).toBe(true);
      expect(status.dockerImageBuilt).toBe(true);
      expect(status.mode).toBe('docker-sandbox');
    });

    it("should fallback when Docker daemon is not running", () => {
      // Mock docker --version success but docker info fails
      (execSync as jest.Mock)
        .mockReturnValueOnce(Buffer.from("Docker version 24.0.0"))
        .mockImplementationOnce(() => { throw new Error("Cannot connect to Docker daemon"); });

      const runner = new SandboxRunner();
      const status = runner.getSandboxStatus();

      expect(status.dockerAvailable).toBe(false);
      expect(status.dockerImageBuilt).toBe(false);
      expect(status.mode).toBe('local-limited');
    });

    it("should fallback when Docker is not installed", () => {
      (execSync as jest.Mock).mockImplementation(() => { 
        throw new Error("command not found: docker"); 
      });

      const runner = new SandboxRunner();
      const status = runner.getSandboxStatus();

      expect(status.dockerAvailable).toBe(false);
      expect(status.mode).toBe('local-limited');
    });

    it("should detect when Docker image is not built", () => {
      (execSync as jest.Mock)
        .mockReturnValueOnce(Buffer.from("Docker version 24.0.0"))
        .mockReturnValueOnce(Buffer.from("{}"))
        .mockImplementationOnce(() => { throw new Error("No such image"); });

      const runner = new SandboxRunner();
      const status = runner.getSandboxStatus();

      expect(status.dockerAvailable).toBe(true);
      expect(status.dockerImageBuilt).toBe(false);
      expect(status.mode).toBe('local-limited');
    });
  });

  describe("Local Fallback Execution", () => {
    beforeEach(() => {
      // Simulate no Docker available
      (execSync as jest.Mock).mockImplementation(() => { 
        throw new Error("Docker not available"); 
      });
    });

    it("should compile and run sketch locally", async () => {
      const runner = new SandboxRunner();
      const outputs: string[] = [];
      let exitCode: number | null = null;

      runner.runSketch(
        "void setup(){} void loop(){}",
        (line) => outputs.push(line),
        jest.fn(),
        (code) => (exitCode = code)
      );

      await wait();

      // Compile process
      const compileProc = spawnInstances[0];
      expect(compileProc).toBeDefined();
      
      const compileClose = compileProc.on.mock.calls.find(
        ([event]: any[]) => event === "close"
      )?.[1];
      compileClose(0);

      await wait();

      // Run process
      const runProc = spawnInstances[1];
      expect(runProc).toBeDefined();

      const stdoutHandler = runProc.stdout.on.mock.calls.find(
        ([event]: any[]) => event === "data"
      )?.[1];
      
      stdoutHandler(Buffer.from("Hello World\n"));

      const runClose = runProc.on.mock.calls.find(
        ([event]: any[]) => event === "close"
      )?.[1];
      runClose(0);

      expect(outputs).toContain("Hello World");
      expect(exitCode).toBe(0);
    });

    it("should handle compile errors", async () => {
      const runner = new SandboxRunner();
      let compileError: string | null = null;
      let exitCode: number | null = null;

      runner.runSketch(
        "invalid code {{{",
        jest.fn(),
        jest.fn(),
        (code) => (exitCode = code),
        (err) => (compileError = err)
      );

      await wait();

      const compileProc = spawnInstances[0];
      
      // Simulate stderr output
      const stderrHandler = compileProc.stderr.on.mock.calls.find(
        ([event]: any[]) => event === "data"
      )?.[1];
      stderrHandler(Buffer.from("error: expected '}'\n"));

      const compileClose = compileProc.on.mock.calls.find(
        ([event]: any[]) => event === "close"
      )?.[1];
      compileClose(1);

      await wait();

      expect(compileError).toContain("expected '}'");
      expect(exitCode).toBe(-1);
    });

    it("should make executable chmod on macOS/Linux", async () => {
      const runner = new SandboxRunner();

      runner.runSketch(
        "void setup(){} void loop(){}",
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      await wait();

      const compileProc = spawnInstances[0];
      const compileClose = compileProc.on.mock.calls.find(
        ([event]: any[]) => event === "close"
      )?.[1];
      compileClose(0);

      await wait();

      expect(chmod).toHaveBeenCalled();
    });
  });

  describe("Docker Sandbox Execution", () => {
    beforeEach(() => {
      // Simulate Docker available with image
      (execSync as jest.Mock)
        .mockReturnValueOnce(Buffer.from("Docker version 24.0.0"))
        .mockReturnValueOnce(Buffer.from("{}"))
        .mockReturnValueOnce(Buffer.from("[]"));
    });

    it("should use single Docker container for compile+run", async () => {
      const runner = new SandboxRunner();
      const outputs: string[] = [];
      let exitCode: number | null = null;

      runner.runSketch(
        "void setup(){} void loop(){}",
        (line) => outputs.push(line),
        jest.fn(),
        (code) => (exitCode = code)
      );

      await wait();

      // Only ONE spawn call for combined compile+run
      expect(spawnInstances.length).toBe(1);
      
      const dockerProc = spawnInstances[0];
      
      // Verify Docker command
      expect(spawn).toHaveBeenCalledWith("docker", expect.arrayContaining([
        "run",
        "--rm",
        "-i",
        "--network", "none",
        expect.stringMatching(/--memory/),
      ]));

      // Simulate output
      const stdoutHandler = dockerProc.stdout.on.mock.calls.find(
        ([event]: any[]) => event === "data"
      )?.[1];
      stdoutHandler(Buffer.from("Output from sketch\n"));

      const closeHandler = dockerProc.on.mock.calls.find(
        ([event]: any[]) => event === "close"
      )?.[1];
      closeHandler(0);

      expect(outputs).toContain("Output from sketch");
      expect(exitCode).toBe(0);
    });

    it("should apply security constraints to Docker", async () => {
      const runner = new SandboxRunner();

      runner.runSketch(
        "void setup(){} void loop(){}",
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      await wait();

      const spawnCall = (spawn as jest.Mock).mock.calls[0];
      const dockerArgs = spawnCall[1] as string[];

      // Check security options
      expect(dockerArgs).toContain("--network");
      expect(dockerArgs).toContain("none");
      expect(dockerArgs).toContain("--cap-drop");
      expect(dockerArgs).toContain("ALL");
      expect(dockerArgs).toContain("--security-opt");
      expect(dockerArgs).toContain("no-new-privileges");
      expect(dockerArgs).toContain("--pids-limit");
    });

    it("should handle Docker compile errors", async () => {
      const runner = new SandboxRunner();
      let compileError: string | null = null;

      runner.runSketch(
        "invalid code",
        jest.fn(),
        jest.fn(),
        jest.fn(),
        (err) => (compileError = err)
      );

      await wait();

      const dockerProc = spawnInstances[0];
      
      // Simulate compile error via stderr
      const stderrHandler = dockerProc.stderr.on.mock.calls.find(
        ([event]: any[]) => event === "data"
      )?.[1];
      stderrHandler(Buffer.from("sketch.cpp:10: error: syntax error\n"));

      const closeHandler = dockerProc.on.mock.calls.find(
        ([event]: any[]) => event === "close"
      )?.[1];
      closeHandler(1);

      await wait();

      expect(compileError).toContain("syntax error");
    });
  });

  describe("Output Buffering", () => {
    beforeEach(() => {
      (execSync as jest.Mock).mockImplementation(() => { 
        throw new Error("Docker not available"); 
      });
    });

    it("should buffer incomplete lines", async () => {
      const runner = new SandboxRunner();
      const outputs: { line: string; complete: boolean }[] = [];

      runner.runSketch(
        "void setup(){} void loop(){}",
        (line, isComplete) => outputs.push({ line, complete: isComplete ?? true }),
        jest.fn(),
        jest.fn()
      );

      await wait();

      const compileProc = spawnInstances[0];
      compileProc.on.mock.calls.find(([e]: any[]) => e === "close")?.[1](0);

      await wait();

      const runProc = spawnInstances[1];
      const stdoutHandler = runProc.stdout.on.mock.calls.find(
        ([event]: any[]) => event === "data"
      )?.[1];

      // Send partial data
      stdoutHandler(Buffer.from("Hel"));
      
      // No complete lines yet
      const completeLines = outputs.filter(o => o.complete);
      expect(completeLines).toHaveLength(0);
    });

    it("should send complete lines immediately", async () => {
      const runner = new SandboxRunner();
      const outputs: string[] = [];

      runner.runSketch(
        "void setup(){} void loop(){}",
        (line) => outputs.push(line),
        jest.fn(),
        jest.fn()
      );

      await wait();

      const compileProc = spawnInstances[0];
      compileProc.on.mock.calls.find(([e]: any[]) => e === "close")?.[1](0);

      await wait();

      const runProc = spawnInstances[1];
      const stdoutHandler = runProc.stdout.on.mock.calls.find(
        ([event]: any[]) => event === "data"
      )?.[1];

      stdoutHandler(Buffer.from("Line1\nLine2\n"));
      
      expect(outputs).toContain("Line1");
      expect(outputs).toContain("Line2");
    });
  });

  describe("Process Control", () => {
    beforeEach(() => {
      (execSync as jest.Mock).mockImplementation(() => { 
        throw new Error("Docker not available"); 
      });
    });

    it("should stop running process", async () => {
      const runner = new SandboxRunner();

      runner.runSketch(
        "void setup(){} void loop(){}",
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      await wait();

      const compileProc = spawnInstances[0];
      compileProc.on.mock.calls.find(([e]: any[]) => e === "close")?.[1](0);

      await wait();

      const runProc = spawnInstances[1];
      
      runner.stop();

      expect(runProc.kill).toHaveBeenCalledWith('SIGKILL');
      expect(runner.isRunning).toBe(false);
    });

    it("should cleanup temp directory on stop", async () => {
      const runner = new SandboxRunner();

      runner.runSketch(
        "void setup(){} void loop(){}",
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      await wait();

      const compileProc = spawnInstances[0];
      compileProc.on.mock.calls.find(([e]: any[]) => e === "close")?.[1](0);

      await wait();
      
      runner.stop();

      // rm should be called for cleanup
      await wait(50);
      expect(rm).toHaveBeenCalled();
    });

    it("should handle serial input", async () => {
      const runner = new SandboxRunner();

      runner.runSketch(
        "void setup(){} void loop(){}",
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      await wait();

      const compileProc = spawnInstances[0];
      compileProc.on.mock.calls.find(([e]: any[]) => e === "close")?.[1](0);

      await wait();

      const runProc = spawnInstances[1];
      
      runner.sendSerialInput("test input");

      expect(runProc.stdin.write).toHaveBeenCalledWith("test input\n");
    });
  });

  describe("Resource Limits", () => {
    beforeEach(() => {
      (execSync as jest.Mock)
        .mockReturnValueOnce(Buffer.from("Docker version 24.0.0"))
        .mockReturnValueOnce(Buffer.from("{}"))
        .mockReturnValueOnce(Buffer.from("[]"));
    });

    it("should enforce output size limit", async () => {
      const runner = new SandboxRunner();
      const errors: string[] = [];

      runner.runSketch(
        "void setup(){} void loop(){}",
        jest.fn(),
        (err) => errors.push(err),
        jest.fn()
      );

      await wait();

      const dockerProc = spawnInstances[0];
      const stdoutHandler = dockerProc.stdout.on.mock.calls.find(
        ([event]: any[]) => event === "data"
      )?.[1];

      // Send more than 1MB of data
      const largeOutput = "x".repeat(1024 * 1024 + 100);
      stdoutHandler(Buffer.from(largeOutput));

      expect(errors).toContain("Output size limit exceeded (1MB)");
    });
  });

  describe("Arduino Code Processing", () => {
    beforeEach(() => {
      (execSync as jest.Mock).mockImplementation(() => { 
        throw new Error("Docker not available"); 
      });
    });

    it("should remove Arduino.h include", async () => {
      const runner = new SandboxRunner();

      runner.runSketch(
        '#include <Arduino.h>\nvoid setup(){} void loop(){}',
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      await wait();

      // Check that writeFile was called with code without Arduino.h
      const writeCall = (writeFile as jest.Mock).mock.calls[0];
      const writtenCode = writeCall[1] as string;
      
      expect(writtenCode).not.toContain('#include <Arduino.h>');
      expect(writtenCode).not.toContain('#include "Arduino.h"');
    });

    it("should add main() wrapper with setup and loop", async () => {
      const runner = new SandboxRunner();

      runner.runSketch(
        'void setup(){} void loop(){}',
        jest.fn(),
        jest.fn(),
        jest.fn()
      );

      await wait();

      const writeCall = (writeFile as jest.Mock).mock.calls[0];
      const writtenCode = writeCall[1] as string;
      
      expect(writtenCode).toContain('int main()');
      expect(writtenCode).toContain('setup()');
      expect(writtenCode).toContain('loop()');
    });
  });
});
