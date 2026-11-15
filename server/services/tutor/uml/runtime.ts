import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import lock from "../../../../scripts/tutor-uml-runtime.lock.json" with { type: "json" };

export interface TutorUmlRuntime {
  readonly java: string;
  readonly jar: string;
  readonly fonts: string;
  readonly fontConfig: string;
  readonly directory: string;
}
const cached = new Map<string, Promise<TutorUmlRuntime | null>>();
const localPath = (directory: string, value: unknown): string => {
  if (typeof value !== "string") throw new Error("Invalid runtime manifest");
  const resolved = path.resolve(directory, "../..", value);
  if (!resolved.startsWith(directory + path.sep))
    throw new Error("Invalid runtime manifest");
  return resolved;
};
async function load(directory: string): Promise<TutorUmlRuntime | null> {
  try {
    const data: unknown = JSON.parse(
      await readFile(path.join(directory, "runtime.json"), "utf8"),
    );
    if (!data || typeof data !== "object") return null;
    const manifest = data as Record<string, unknown>;
    if (
      manifest.rendererVersion !== lock.plantuml.version ||
      manifest.javaVersion !== lock.java.version ||
      manifest.platform !== `${process.platform}-${process.arch}`
    )
      return null;
    const runtime = {
      directory,
      java: localPath(directory, manifest.java),
      jar: localPath(directory, manifest.jar),
      fonts: localPath(directory, manifest.fonts),
      fontConfig: localPath(directory, manifest.fontConfig),
    };
    await Promise.all([
      access(runtime.java),
      access(runtime.fontConfig),
      ...[
        "DejaVuSans.ttf",
        "DejaVuSans-Bold.ttf",
        "DejaVuSans-Oblique.ttf",
        "DejaVuSans-BoldOblique.ttf",
      ].map((font) => access(path.join(runtime.fonts, font))),
    ]);
    if (
      createHash("sha256")
        .update(await readFile(runtime.jar))
        .digest("hex") !== lock.plantuml.sha256
    )
      return null;
    const version = await promisify(execFile)(runtime.java, ["-version"], {
      env: { PATH: "/usr/bin:/bin" },
      timeout: 2_000,
      maxBuffer: 16_384,
    });
    return version.stderr.includes(lock.java.version) ? runtime : null;
  } catch {
    return null;
  }
}
export function tutorUmlRuntime(
  directory = path.resolve("cache/tutor-uml"),
): Promise<TutorUmlRuntime | null> {
  const resolved = path.resolve(directory);
  let result = cached.get(resolved);
  if (!result) {
    result = load(resolved);
    cached.set(resolved, result);
    void result.then((runtime) => {
      if (!runtime) cached.delete(resolved);
    });
  }
  return result;
}
