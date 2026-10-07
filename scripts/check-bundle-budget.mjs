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
// Index limit: Vite 8/Rolldown places react-dom (~129 kB) in the index chunk; the former
// 700 kB limit reflected Vite 5 chunk placement. Recalibrated together with the initial-path check below.
const limits = { total: 6_000_000, largest: 4_500_000, initial: 710_000 };
const initial = sizes
  .filter((file) => /^index-/.test(file.name))
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
if (
  total > limits.total ||
  largest > limits.largest ||
  initial > limits.initial
) {
  console.error(`Bundle budget exceeded (limits: ${JSON.stringify(limits)})`);
  process.exit(1);
}
