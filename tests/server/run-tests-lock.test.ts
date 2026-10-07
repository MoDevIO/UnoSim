import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repository = process.cwd();
const helper = path.join(repository, "scripts", "run-tests-lock.sh");
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "unosim-run-tests-lock-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A live process whose command line contains "run-tests", standing in for a running pipeline. */
function fakePipeline(): number {
  const child = spawn("bash", ["-c", "exec -a run-tests.sh sleep 30"], { stdio: "ignore", detached: true });
  child.unref();
  cleanups.push(() => {
    try { process.kill(child.pid as number); } catch { /* already gone */ }
  });
  return child.pid as number;
}

function bash(script: string) {
  return spawnSync("bash", ["-c", `source "${helper}"; ${script}`], { encoding: "utf8" });
}

describe("run-tests.sh single-instance lock", () => {
  it("acquires a free lock and records the owner's PID", () => {
    const lock = path.join(temporaryDirectory(), "lock");
    const result = bash(`run_tests_lock_acquire "${lock}"; echo "pid=$$"`);

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(lock, "pid"), "utf8").trim()).toBe(/pid=(\d+)/.exec(result.stdout)?.[1]);
  });

  it("refuses while a live pipeline holds the lock and keeps that lock untouched", () => {
    const lock = path.join(temporaryDirectory(), "lock");
    const owner = fakePipeline();
    mkdirSync(lock);
    writeFileSync(path.join(lock, "pid"), `${owner}\n`);

    const result = bash(`run_tests_lock_acquire "${lock}"`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`PID ${owner}`);
    expect(readFileSync(path.join(lock, "pid"), "utf8").trim()).toBe(String(owner));
  });

  it("takes over a lock whose owner is gone", () => {
    const lock = path.join(temporaryDirectory(), "lock");
    mkdirSync(lock);
    writeFileSync(path.join(lock, "pid"), "999999\n");

    expect(bash(`run_tests_lock_acquire "${lock}"`).status).toBe(0);
  });

  it("takes over a lock whose PID now belongs to an unrelated process", () => {
    const lock = path.join(temporaryDirectory(), "lock");
    const unrelated = spawn("sleep", ["30"], { stdio: "ignore", detached: true });
    unrelated.unref();
    cleanups.push(() => {
      try { process.kill(unrelated.pid as number); } catch { /* already gone */ }
    });
    mkdirSync(lock);
    writeFileSync(path.join(lock, "pid"), `${unrelated.pid}\n`);

    expect(bash(`run_tests_lock_acquire "${lock}"`).status).toBe(0);
  });

  it("takes over a half-created lock without a PID file", () => {
    const lock = path.join(temporaryDirectory(), "lock");
    mkdirSync(lock);

    expect(bash(`run_tests_lock_acquire "${lock}"`).status).toBe(0);
  });

  it("releases only its own lock", () => {
    const lock = path.join(temporaryDirectory(), "lock");
    const own = bash(`run_tests_lock_acquire "${lock}" && run_tests_lock_release "${lock}"`);
    expect(own.status).toBe(0);
    expect(existsSync(lock)).toBe(false);

    mkdirSync(lock);
    writeFileSync(path.join(lock, "pid"), "424242\n");
    expect(bash(`run_tests_lock_release "${lock}"`).status).toBe(0);
    expect(existsSync(lock)).toBe(true);
  });

  it("makes run-tests.sh stop before it touches anything when another pipeline is running", () => {
    // Run in an isolated working directory: run-tests.sh resolves its log, temp/build folders and
    // lock helper relative to the cwd, so the repository's own run-tests_output.log (which an outer
    // pipeline may be writing right now) is never read or touched.
    const directory = temporaryDirectory();
    const workdir = path.join(directory, "work");
    mkdirSync(path.join(workdir, "scripts"), { recursive: true });
    copyFileSync(path.join(repository, "run-tests.sh"), path.join(workdir, "run-tests.sh"));
    copyFileSync(helper, path.join(workdir, "scripts", "run-tests-lock.sh"));
    const log = path.join(workdir, "run-tests_output.log");
    writeFileSync(log, "previous pipeline output\n");
    const entriesBefore = readdirSync(workdir).sort();

    const lock = path.join(directory, "lock");
    const owner = fakePipeline();
    mkdirSync(lock);
    writeFileSync(path.join(lock, "pid"), `${owner}\n`);

    const result = spawnSync("bash", ["./run-tests.sh"], {
      cwd: workdir,
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, RUN_TESTS_LOCK_DIR: lock },
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain(`PID ${owner}`);
    expect(readFileSync(log, "utf8")).toBe("previous pipeline output\n");
    expect(readdirSync(workdir).sort()).toEqual(entriesBefore);
    expect(readFileSync(path.join(lock, "pid"), "utf8").trim()).toBe(String(owner));
  });
});
