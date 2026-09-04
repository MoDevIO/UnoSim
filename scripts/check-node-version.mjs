import { readFile } from "node:fs/promises";
const expected = (await readFile(".nvmrc", "utf8")).trim();
const declared = JSON.parse(await readFile("package.json", "utf8")).engines?.node;
if (!declared || !declared.includes(expected)) {
  console.error(`Node mismatch: expected ${expected}, engines=${declared}, runtime=${process.version}`);
  process.exit(1);
}
if (!process.version.startsWith(`v${expected}`)) {
  const message = `Node metadata is aligned to ${expected}, but this runtime is ${process.version}`;
  if (process.env.CI) { console.error(message); process.exit(1); }
  console.warn(`${message}; run 'nvm use' for the pinned local runtime`);
} else {
  console.log(`Node ${expected} aligned across .nvmrc, package.json and runtime`);
}
