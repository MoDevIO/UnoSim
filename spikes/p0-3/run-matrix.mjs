// Drives the P0.3 measuring page in a headless browser and writes the JSON result.
// Runs on the host or inside the Playwright container (see run-vm-matrix.sh).
// Usage: node spikes/p0-3/run-matrix.mjs --browser chromium|firefox --out result.json [--repeat 3]
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { cpus, totalmem, release, platform, arch } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const browserName = arg("--browser", "chromium");
const out = arg("--out", `p03-${browserName}.json`);
const repeat = Number(arg("--repeat", 3));

const types = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer((request, response) => {
  const name = !request.url || request.url === "/" ? "/index.html" : request.url.split("?")[0].replaceAll("..", "");
  try {
    const body = readFileSync(join(here, "dist", name));
    response.writeHead(200, { "content-type": types[extname(name)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const read = (path) => (existsSync(path) ? readFileSync(path, "utf8").trim() : null);
const environment = {
  node: process.version,
  os: `${platform()} ${release()} ${arch()}`,
  osRelease: read("/etc/os-release")?.split("\n").find((line) => line.startsWith("PRETTY_NAME="))?.slice(13, -1) ?? null,
  visibleCpus: cpus().length,
  cpuModel: cpus()[0]?.model ?? null,
  visibleMemoryMiB: Math.round(totalmem() / 2 ** 20),
  cgroupCpuMax: read("/sys/fs/cgroup/cpu.max"),
  cgroupMemoryMax: read("/sys/fs/cgroup/memory.max"),
  cpuset: read("/sys/fs/cgroup/cpuset.cpus.effective"),
};

const browserType = browserName === "firefox" ? firefox : chromium;
const browser = await browserType.launch({ args: browserName === "chromium" ? ["--no-sandbox"] : [] });
const runs = [];
for (let index = 0; index < repeat; index++) {
  const page = await browser.newPage();
  await page.goto(url);
  await page.click("#run");
  await page.waitForFunction(() => document.querySelector("#output")?.textContent?.includes('"rows"'), null, { timeout: 180_000 });
  runs.push(JSON.parse(await page.textContent("#output")));
  await page.close();
}
const browserVersion = browser.version();
await browser.close();
server.close();

const it055 = runs.map((run) => run.rows.find((row) => row.sketch.startsWith("IT05.5")).peakSpeed);
const summary = { browser: browserName, browserVersion, it055PeakSpeeds: it055, it055PeakSpeedMin: Math.min(...it055), criterionPeakSpeed: 1.2, criterionMet: Math.min(...it055) >= 1.2 };
writeFileSync(out, `${JSON.stringify({ synthetic: "VM/container measurement, not real school devices", environment, summary, runs }, null, 2)}\n`);
console.log(JSON.stringify({ environment, summary }));
