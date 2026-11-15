import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { installVerifiedArtifact } from "../../scripts/provision-tutor-uml.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("rejects a corrupt download without publishing a finished artifact", async () => {
 const dir = await mkdtemp(path.join(tmpdir(), "uml-runtime-"));
 const destination = path.join(dir, "renderer.jar");
 try {
  await assert.rejects(installVerifiedArtifact({ url: "https://example.invalid/renderer.jar", sha256: hash("expected"), destination }, async () => new Response("corrupt")), /checksum/i);
  await assert.rejects(access(destination));
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test("verifies cached content and reuses it without another download", async () => {
 const dir = await mkdtemp(path.join(tmpdir(), "uml-runtime-"));
 const destination = path.join(dir, "renderer.jar");
 let downloads = 0;
 const fetcher = async () => { downloads++; return new Response("expected"); };
 const spec = { url: "https://example.invalid/renderer.jar", sha256: hash("expected"), destination };
 try {
  await installVerifiedArtifact(spec, fetcher);
  await installVerifiedArtifact(spec, fetcher);
  assert.equal(downloads, 1);
  assert.equal(await readFile(destination, "utf8"), "expected");
 } finally { await rm(dir, { recursive: true, force: true }); }
});
