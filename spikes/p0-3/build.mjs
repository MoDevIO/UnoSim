// Builds spikes/p0-3/dist (worker, page script, probes with embedded HEX) and serves it.
// Usage: node spikes/p0-3/build.mjs [--serve]
import { build } from "esbuild";
import { createServer } from "node:http";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const dist = join(here, "dist");
const corpus = join(root, "tests/fixtures/runtime-corpus/hex/uno");
const probes = [
  ["int-probe", join(root, "packages/avr-emulator/tests/fixtures/uno-int_probe.hex")],
  ["IT05.5 intervall-ohne-delay", join(corpus, "it05-05-intervall-ohne-delay.hex")],
  ["IT11.5 matrizen-multiplizieren", join(corpus, "it11-05-matrizen-multiplizieren.hex")],
];

mkdirSync(dist, { recursive: true });
const embedded = JSON.stringify(probes.map(([name, file]) => ({ name, hex: readFileSync(file, "utf8") })));
for (const entry of ["worker", "main"]) {
  await build({ entryPoints: [join(here, `${entry}.ts`)], outfile: join(dist, `${entry}.js`), bundle: true, format: "iife", target: "es2020", minify: true, define: { __PROBES__: embedded } });
}
copyFileSync(join(here, "index.html"), join(dist, "index.html"));
console.log(`built ${dist}`);

if (process.argv.includes("--serve")) {
  const types = { ".html": "text/html", ".js": "text/javascript" };
  const port = 8765;
  createServer((request, response) => {
    const name = request.url === "/" || request.url === undefined ? "/index.html" : request.url.split("?")[0];
    try {
      const body = readFileSync(join(dist, name.replace(/\.\./g, "")));
      response.writeHead(200, { "content-type": types[extname(name)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  }).listen(port, "0.0.0.0", () => console.log(`serving on http://0.0.0.0:${port}/ (use this computer's LAN address on other devices)`));
}
