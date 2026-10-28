import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const publicDir = process.argv[2] ?? join(process.cwd(), "dist", "public");
const dir = join(publicDir, "assets");
const files = (await readdir(dir)).filter((name) => name.endsWith(".js"));
const sizes = await Promise.all(
  files.map(async (name) => ({
    name,
    bytes: (await stat(join(dir, name))).size,
  })),
);
const total = sizes.reduce((sum, file) => sum + file.bytes, 0);
const largest = Math.max(...sizes.map((file) => file.bytes), 0);
// Initial limit: Vite 8/Rolldown places react-dom (~129 kB) in the index chunk; the former
// 700 kB limit reflected Vite 5 chunk placement. It applies to the whole initial load path (every chunk the
// entry loads statically), not to the index chunk alone: splitting shared code into further initial chunks
// must not hide bytes from the budget. Zod 4 (the client validates the WebSocket messages with it) adds
// about 34 kB to that path over Zod 3, which raised the limit from 710 kB to 745 kB.
const limits = { total: 6_000_000, largest: 4_500_000, initial: 745_000 };
const initial = sizes
  .filter((file) => file.name.startsWith("index-"))
  .reduce((sum, file) => sum + file.bytes, 0);

// Initial load path: static import closure of the HTML entry, from the Vite build manifest.
const manifest = JSON.parse(
  await readFile(join(publicDir, ".vite", "manifest.json"), "utf8"),
);
const initialFiles = new Set();
const visit = (key) => {
  const chunk = manifest[key];
  if (!chunk || initialFiles.has(chunk.file)) return;
  initialFiles.add(chunk.file);
  (chunk.imports ?? []).forEach(visit);
};
visit("index.html");
const initialChunks = await Promise.all(
  [...initialFiles].map(async (file) => ({
    file,
    source: await readFile(join(publicDir, file), "utf8"),
  })),
);
// Recharts belongs to the lazy serial plotter and must not be reachable on the initial path.
const eagerRecharts = initialChunks
  .filter(({ source }) => source.includes("recharts-wrapper"))
  .map(({ file }) => file);
// The emulator (avr8js) belongs to the worker chunk only (plan P3.9). These enum names exist only in avr8js;
// the sanity check keeps the test from passing for the wrong reason if the marker ever disappears.
const AVR8JS_MARKERS = ["PWMPhaseFrequencyCorrect", "Internal2V56"];
const hasAvr8js = (source) => AVR8JS_MARKERS.every((marker) => source.includes(marker));
const eagerEmulator = initialChunks.filter(({ source }) => hasAvr8js(source)).map(({ file }) => file);
const emulatorChunks = (
  await Promise.all(files.map(async (name) => ({ name, source: await readFile(join(dir, name), "utf8") })))
).filter(({ source }) => hasAvr8js(source));
const initialPathBytes = (
  await Promise.all(
    [...initialFiles].map((file) => stat(join(publicDir, file))),
  )
).reduce((sum, file) => sum + file.size, 0);

console.log(
  JSON.stringify(
    {
      totalBytes: total,
      largestChunkBytes: largest,
      initialBytes: initial,
      initialPathJsBytes: initialPathBytes,
      initialPathChunks: initialFiles.size,
      files: sizes.length,
      emulatorChunks: emulatorChunks.map(({ name }) => name),
    },
    null,
    2,
  ),
);
if (eagerRecharts.length > 0) {
  console.error(
    `Recharts is part of the initial load path (should be lazy): ${eagerRecharts.join(", ")}`,
  );
  process.exit(1);
}
if (eagerEmulator.length > 0) {
  console.error(`The emulator (avr8js) is part of the initial load path (should be in the worker chunk): ${eagerEmulator.join(", ")}`);
  process.exit(1);
}
if (emulatorChunks.length === 0) {
  console.error(`No chunk contains avr8js (markers ${AVR8JS_MARKERS.join(", ")}): the emulator check cannot be trusted`);
  process.exit(1);
}
if (
  total > limits.total ||
  largest > limits.largest ||
  initialPathBytes > limits.initial
) {
  console.error(`Bundle budget exceeded (limits: ${JSON.stringify(limits)})`);
  process.exit(1);
}
