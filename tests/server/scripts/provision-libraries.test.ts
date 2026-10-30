import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { providedLibraryDir } from "../../../server/services/libraries/library-service";

const script = resolve(__dirname, "../../../scripts/provision-libraries.mjs");
const run = promisify(execFile);

describe("scripts/provision-libraries.mjs (SSOT Libraries §10)", () => {
  const work = mkdtempSync(join(tmpdir(), "unosim-provision-test-"));
  let server: Server;
  let requests = 0;
  let archive: Buffer;
  let baseUrl = "";

  beforeAll(async () => {
    const source = join(work, "src", "Demo Lib-2.0.0");
    mkdirSync(join(source, "src"), { recursive: true });
    writeFileSync(join(source, "library.properties"), "name=Demo Lib\nversion=2.0.0\n");
    writeFileSync(join(source, "src", "Demo.h"), "#define DEMO 1\n");
    execFileSync("zip", ["-qr", join(work, "demo.zip"), "Demo Lib-2.0.0"], { cwd: join(work, "src") });
    archive = readFileSync(join(work, "demo.zip"));
    server = createServer((_request, response) => {
      requests++;
      response.end(archive);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
    rmSync(work, { recursive: true, force: true });
  });

  function catalog(name: string, sha256: string): string {
    const file = join(work, `${name}.json`);
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      packages: [{ name: "Demo Lib", version: "2.0.0", sha256, archive: { url: `${baseUrl}/demo.zip`, size: archive.length, root: "Demo Lib-2.0.0" } }],
    }));
    return file;
  }

  it("installs a package with the catalog checksum where the server expects it, once", async () => {
    const root = join(work, "root-ok");
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const args = [script, "--root", root, "--catalog", catalog("ok", sha256)];

    await run(process.execPath, args);
    const before = requests;
    await run(process.execPath, args);

    const dir = providedLibraryDir({ name: "Demo Lib", version: "2.0.0" });
    expect(existsSync(join(root, dir, "src", "Demo.h"))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "provided.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      packages: [{ name: "Demo Lib", version: "2.0.0", sha256, dir }],
    });
    expect(requests).toBe(before);
  });

  it("refuses an archive whose checksum differs and installs nothing", async () => {
    const root = join(work, "root-bad");

    await expect(run(process.execPath, [script, "--root", root, "--catalog", catalog("bad", "0".repeat(64))])).rejects.toThrow(/does not match the catalog/);
    expect(existsSync(join(root, "provided.json"))).toBe(false);
    expect(existsSync(join(root, providedLibraryDir({ name: "Demo Lib", version: "2.0.0" })))).toBe(false);
  });
});
