import { readFile } from "node:fs/promises";
const expected = (await readFile(".nvmrc", "utf8")).trim();
const declared = JSON.parse(await readFile("package.json", "utf8")).engines?.node;
if (!declared || !declared.includes(expected) || (process.env.CI && !process.version.startsWith(`v${expected}`))) {
  console.error(`Node mismatch: expected ${expected}, engines=${declared}, runtime=${process.version}`);
  process.exit(1);
}
console.log(`Node ${expected} aligned across .nvmrc, package.json and runtime`);
