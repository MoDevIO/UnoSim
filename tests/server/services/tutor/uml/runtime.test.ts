import { afterAll, beforeAll, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  cp,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { tutorUmlRuntime } from "../../../../../server/services/tutor/uml/runtime";
let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uml-manifest-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
async function fixture(name: string, platform: string, missingBold = false) {
  const directory = path.join(root, name, "cache/tutor-uml");
  await mkdir(directory, { recursive: true });
  const source = path.resolve("cache/tutor-uml");
  const manifest = JSON.parse(
    await readFile(path.join(source, "runtime.json"), "utf8"),
  );
  await symlink(path.resolve(manifest.java), path.join(directory, "java"));
  await cp(path.resolve(manifest.jar), path.join(directory, "renderer.jar"));
  await mkdir(path.join(directory, "fonts"));
  for (const font of [
    "DejaVuSans.ttf",
    "DejaVuSans-Bold.ttf",
    "DejaVuSans-Oblique.ttf",
    "DejaVuSans-BoldOblique.ttf",
  ]) {
    if (!(missingBold && font === "DejaVuSans-Bold.ttf"))
      await cp(
        path.resolve(manifest.fonts, font),
        path.join(directory, "fonts", font),
      );
  }
  await writeFile(path.join(directory, "fonts.conf"), "<fontconfig/>");
  await writeFile(
    path.join(directory, "runtime.json"),
    JSON.stringify({
      ...manifest,
      platform,
      java: "cache/tutor-uml/java",
      jar: "cache/tutor-uml/renderer.jar",
      fonts: "cache/tutor-uml/fonts",
      fontConfig: "cache/tutor-uml/fonts.conf",
    }),
  );
  return directory;
}
it("rejects runtime manifests for a different platform before rendering", async () => {
  expect(
    await tutorUmlRuntime(await fixture("wrong", "wrong-platform")),
  ).toBeNull();
});
it("does not declare graphics available with an incomplete pinned font family", async () => {
  expect(
    await tutorUmlRuntime(
      await fixture("font", `${process.platform}-${process.arch}`, true),
    ),
  ).toBeNull();
});
it("accepts the complete same-platform pinned runtime", async () => {
  expect(
    await tutorUmlRuntime(
      await fixture("correct", `${process.platform}-${process.arch}`),
    ),
  ).not.toBeNull();
});
