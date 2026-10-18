// Spike P0.2 – compile latency: today (arduino-cli in a long-running container)
// versus one short-lived sandbox container per compile.
// Usage: node spikes/p0-2/bench.mjs <examples-dir> <out.json>
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const IMAGE = process.env.IMAGE ?? "unosim-compile-sandbox-spike:p0-2";
const [examplesDir, outFile] = process.argv.slice(2);
const SERIAL_RUNS = Number(process.env.SERIAL_RUNS ?? 20);
const BATCHES = Number(process.env.BATCHES ?? 3);
const LEVELS = (process.env.LEVELS ?? "1,8,20").split(",").map(Number);
const VARIANTS = (process.env.VARIANTS ?? "today,sandbox-buildpath-cpu2,sandbox-copycache-cpu2,sandbox-copycache-cpu1").split(",");

const work = mkdtempSync(join(process.env.SPIKE_TMP ?? tmpdir(), "p02-"));
const sketches = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".ino")) {
      const name = basename(e.name, ".ino").replaceAll("-", "_");
      mkdirSync(join(work, "sk", name), { recursive: true });
      cpSync(p, join(work, "sk", name, `${name}.ino`));
      for (const h of readdirSync(dirname(p)).filter((f) => f.endsWith(".h"))) cpSync(join(dirname(p), h), join(work, "sk", name, h));
      sketches.push(name);
    }
  }
}
walk(examplesDir);
sketches.sort();
for (const s of sketches) { chmodSync(join(work, "sk", s), 0o755); }

function run(cmd, args) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ ms: performance.now() - started, code, err: err.slice(-400) }));
  });
}

const sandboxFlags = ["--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "512m",
  "--tmpfs", "/tmp:rw,size=256m,mode=1777", "--label", "unosim.owner=spike-p0-2"];
let n = 0;
const variants = {
  today: (sk) => run("docker", ["exec", "p02-today", "arduino-cli", "compile", "--fqbn", "arduino:avr:uno",
    "--build-path", `/tmp/b-${process.pid}-${n++}`, `/sk/${sk}`]),
  "sandbox-buildpath-cpu2": (sk) => run("docker", ["run", ...sandboxFlags, "--cpus", "2",
    "-v", `${join(work, "sk", sk)}:/sketch/${sk}:ro`, IMAGE,
    "compile", "--fqbn", "arduino:avr:uno", "--build-path", "/tmp/build", `/sketch/${sk}`]),
  ...Object.fromEntries([1, 2].map((cpus) => [`sandbox-copycache-cpu${cpus}`, (sk) => run("docker", ["run", ...sandboxFlags, "--cpus", String(cpus),
    "-v", `${join(work, "sk", sk)}:/sketch/${sk}:ro`, "--entrypoint", "bash", IMAGE, "-c",
    `cp -a ~/.cache/arduino /tmp/cache && ARDUINO_BUILD_CACHE_PATH=/tmp/cache arduino-cli compile --fqbn arduino:avr:uno --output-dir /tmp/out /sketch/${sk}`])])),
};

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const results = [];
await run("docker", ["rm", "-f", "p02-today"]);
await run("docker", ["run", "-d", "--name", "p02-today", "--entrypoint", "sleep", "-v", `${join(work, "sk")}:/sk:ro`, IMAGE, "infinity"]);
await variants.today(sketches[0]);
try {
  for (const level of LEVELS) {
    for (const v of VARIANTS) {
      const samples = [];
      let failures = 0;
      if (level === 1) {
        for (let i = 0; i < SERIAL_RUNS; i++) {
          const r = await variants[v](sketches[i % sketches.length]);
          if (r.code !== 0) { failures++; console.error(v, r.err); } else samples.push(r.ms);
        }
      } else {
        for (let b = 0; b < BATCHES; b++) {
          const rs = await Promise.all(Array.from({ length: level }, (_, i) => variants[v](sketches[(b * level + i) % sketches.length])));
          for (const r of rs) { if (r.code !== 0) { failures++; console.error(v, r.err); } else samples.push(r.ms); }
        }
      }
      const row = { variant: v, concurrency: level, n: samples.length, failures,
        p50: Math.round(pct(samples, 50)), p95: Math.round(pct(samples, 95)), max: Math.round(Math.max(...samples)) };
      results.push(row);
      console.log(JSON.stringify(row));
    }
  }
} finally {
  await run("docker", ["rm", "-f", "p02-today"]);
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(outFile, JSON.stringify({ image: IMAGE, sketches: sketches.length, results }, null, 2));
