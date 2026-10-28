#!/usr/bin/env node
// Provisions the curated library packages (ssot/ssot_function_definition_Libraries.md §10)
// before any user compile: downloads each archive of shared/library-catalog.json, checks
// size and SHA-256, unpacks it to <root>/<name>-<version>/<name> and writes
// <root>/provided.json, which the server reads. A package already installed with the
// catalog checksum is kept. Compiles never download or install anything.
//
//   node scripts/provision-libraries.mjs [--root <dir>] [--catalog <file>]
//
// Root: --root, else UNOSIM_LIBRARIES_DIR, else storage/libraries. Needs `unzip`.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const root = resolve(option("--root") ?? process.env.UNOSIM_LIBRARIES_DIR ?? join(repoRoot, "storage", "libraries"));
const catalogFile = resolve(option("--catalog") ?? join(repoRoot, "shared", "library-catalog.json"));

/** Same as providedLibraryDir in server/services/libraries/library-service.ts. */
const safe = (value) => value.replaceAll(/[^A-Za-z0-9._-]/g, "_");
const packageDir = (entry) => `${safe(entry.name)}-${safe(entry.version)}/${safe(entry.name)}`;
const MARKER = ".unosim-package.json";

function installedWithChecksum(entry) {
  const marker = join(root, dirname(packageDir(entry)), MARKER);
  if (!existsSync(marker) || !existsSync(join(root, packageDir(entry)))) return false;
  const recorded = JSON.parse(readFileSync(marker, "utf8"));
  return recorded.name === entry.name && recorded.version === entry.version && recorded.sha256 === entry.sha256;
}

async function download(entry) {
  const response = await fetch(entry.archive.url);
  if (!response.ok) throw new Error(`${entry.name} ${entry.version}: download failed with HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length !== entry.archive.size) {
    throw new Error(`${entry.name} ${entry.version}: archive has ${archive.length} bytes, the catalog expects ${entry.archive.size}`);
  }
  const sha256 = createHash("sha256").update(archive).digest("hex");
  if (sha256 !== entry.sha256) throw new Error(`${entry.name} ${entry.version}: SHA-256 ${sha256} does not match the catalog`);
  return archive;
}

function libraryProperties(dir) {
  const file = join(dir, "library.properties");
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.split("=")).filter((parts) => parts.length >= 2).map(([key, ...value]) => [key.trim(), value.join("=").trim()]));
}

function install(entry, archive) {
  const work = mkdtempSync(join(tmpdir(), "unosim-library-"));
  try {
    const zip = join(work, "package.zip");
    writeFileSync(zip, archive);
    execFileSync("unzip", ["-q", zip, "-d", join(work, "unpacked")], { stdio: "inherit" });
    const unpacked = join(work, "unpacked", entry.archive.root);
    const properties = libraryProperties(unpacked);
    if (properties.name !== entry.name || properties.version !== entry.version) {
      throw new Error(`${entry.name} ${entry.version}: the archive contains ${properties.name ?? "?"} ${properties.version ?? "?"}`);
    }
    const target = join(root, packageDir(entry));
    rmSync(dirname(target), { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    renameSync(unpacked, target);
    writeFileSync(join(dirname(target), MARKER), `${JSON.stringify({ name: entry.name, version: entry.version, sha256: entry.sha256 })}\n`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
mkdirSync(root, { recursive: true });
const provided = [];
for (const entry of catalog.packages) {
  if (installedWithChecksum(entry)) {
    console.log(`${entry.name} ${entry.version}: already installed`);
  } else {
    install(entry, await download(entry));
    console.log(`${entry.name} ${entry.version}: installed`);
  }
  provided.push({ name: entry.name, version: entry.version, sha256: entry.sha256, dir: packageDir(entry) });
}
writeFileSync(join(root, "provided.json"), `${JSON.stringify({ schemaVersion: 1, packages: provided }, null, 2)}\n`);
console.log(`Libraries provided in ${root}`);
