import { readFile, readdir } from "node:fs/promises";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const markdownFiles = [];

async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || (dir === join(root, "docs") && entry.name === "archive")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name.endsWith(".md")) markdownFiles.push(path);
  }
}

await collect(root);
const failures = [];
for (const file of markdownFiles) {
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0].trim();
    if (!target || target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:")) continue;
    try {
      await access(resolve(root, dirnameRelative(file), target));
    } catch {
      failures.push(`${file.slice(root.length + 1)} -> ${target}`);
    }
  }
  for (const match of content.matchAll(/npm\s+run\s+([a-zA-Z0-9:_-]+)/g)) {
    const script = match[1];
    if (!(script in packageJson.scripts)) failures.push(`${file.slice(root.length + 1)} -> npm script ${script}`);
  }
}

if (failures.length) {
  console.error("Documentation check failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`Documentation check passed (${markdownFiles.length} Markdown files).`);

function dirnameRelative(file) {
  return file.slice(root.length + 1).split("/").slice(0, -1).join("/");
}
