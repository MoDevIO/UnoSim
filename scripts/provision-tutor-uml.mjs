import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Only a hash-verified complete download becomes the installed artifact. */
export async function installVerifiedArtifact({ url, sha256, destination }, fetcher = fetch) {
  try { if (checksum(await readFile(destination)) === sha256) return; } catch { /* Not installed yet. */ }
  const response = await fetcher(url, { signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "UnoSim-UML-provisioner" } });
  if (!response.ok) throw new Error(`Artifact download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (checksum(bytes) !== sha256) throw new Error("Artifact checksum mismatch");
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.partial`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}

async function provision() {
  const lock = JSON.parse(await readFile(new URL("./tutor-uml-runtime.lock.json", import.meta.url), "utf8"));
  const cache = path.join(root, "cache/tutor-uml");
  const platform = `${process.platform}-${process.arch}`;
  const runtime = lock.java.platforms[platform];
  if (!runtime) throw new Error(`No pinned Java runtime for ${platform}`);
  const jar = path.join(cache, lock.plantuml.file);
  const archive = path.join(cache, `${platform}-jre.tar.gz`);
  await installVerifiedArtifact({ ...lock.plantuml, destination: jar });
  await installVerifiedArtifact({ ...runtime, destination: archive });
  const runtimeDir = path.join(cache, `jre-${platform}`);
  const java = path.join(runtimeDir, process.platform === "darwin" ? "Contents/Home/bin/java" : "bin/java");
  try { await access(java); } catch {
    const temporary = `${runtimeDir}.${randomUUID()}.partial`;
    await mkdir(temporary, { recursive: true });
    try {
      await promisify(execFile)("tar", ["-xzf", archive, "-C", temporary, "--strip-components=1"], { timeout: 60_000 });
      await rename(temporary, runtimeDir);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  const fontsArchive = path.join(cache, "fonts.tar.bz2");
  await installVerifiedArtifact({ ...lock.fonts, destination: fontsArchive });
  const fontsDir = path.join(cache, "fonts");
  await mkdir(fontsDir, { recursive: true });
  await promisify(execFile)("tar", ["-xjf", fontsArchive, "-C", fontsDir, "--strip-components=1"], { timeout: 60_000 });
  const fontCache = path.join(cache, "font-cache");
  await mkdir(fontCache, { recursive: true });
  const fontConfig = path.join(cache, "fonts.conf");
  const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  await writeFile(fontConfig, `<?xml version="1.0"?><fontconfig><dir>${xml(path.join(fontsDir, "ttf"))}</dir><cachedir>${xml(fontCache)}</cachedir></fontconfig>`);
  await writeFile(path.join(cache, "runtime.json"), JSON.stringify({ platform, java: path.relative(root, java), jar: path.relative(root, jar), fonts: path.relative(root, path.join(fontsDir, "ttf")), fontConfig: path.relative(root, fontConfig), javaVersion: lock.java.version, rendererVersion: lock.plantuml.version }, null, 2) + "\n");
  console.log(`Installed verified PlantUML ${lock.plantuml.version} and Temurin ${lock.java.version} (${platform}).`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await provision(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
