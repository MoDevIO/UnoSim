import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const dir = join(process.cwd(), "dist", "public", "assets");
const files = (await readdir(dir)).filter((name) => name.endsWith(".js"));
const sizes = await Promise.all(files.map(async (name) => ({ name, bytes: (await stat(join(dir, name))).size })));
const total = sizes.reduce((sum, file) => sum + file.bytes, 0);
const largest = Math.max(...sizes.map((file) => file.bytes), 0);
const limits = { total: 6_000_000, largest: 4_500_000, initial: 700_000 };
const initial = sizes.filter((file) => /^index-/.test(file.name)).reduce((sum, file) => sum + file.bytes, 0);
console.log(JSON.stringify({ totalBytes: total, largestChunkBytes: largest, initialBytes: initial, files: sizes.length }, null, 2));
if (total > limits.total || largest > limits.largest || initial > limits.initial) {
  console.error(`Bundle budget exceeded (limits: ${JSON.stringify(limits)})`);
  process.exit(1);
}
