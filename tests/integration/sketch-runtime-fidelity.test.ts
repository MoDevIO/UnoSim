import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SketchFileBuilder } from "../../server/services/sketch-file-builder";

const execFileAsync = promisify(execFile);
const RUN_TIMEOUT_MS = 10_000;

function decodeSerial(stderr: string): string {
  return [...stderr.matchAll(/\[\[SERIAL_EVENT:\d+:([A-Za-z0-9+/=]*)\]\]/g)]
    .map((match) => Buffer.from(match[1], "base64").toString("utf8"))
    .join("");
}

/** Builds a sketch like the local runner, runs it, and returns its serial output once it prints DONE. */
async function runUntilDone(
  root: string,
  id: string,
  code: string,
  headers: Array<{ name: string; content: string }> = [],
): Promise<string> {
  const builder = new SketchFileBuilder(root);
  const { sketchDir, sketchFile, exeFile } = await builder.build(code, id, headers, headers.length > 0 ? "sketch.ino" : undefined);
  await execFileAsync("g++", ["-I", sketchDir, sketchFile, "-o", exeFile, "-pthread"]);

  return new Promise((resolve, reject) => {
    const child = spawn(exeFile, [], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Sketch ${id} did not print DONE; serial output: ${decodeSerial(stderr)}`));
    }, RUN_TIMEOUT_MS);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const serial = decodeSerial(stderr);
      if (serial.includes("DONE")) {
        clearTimeout(timer);
        child.kill("SIGKILL");
        resolve(serial);
      }
    });
  });
}

describe("sketch runtime fidelity", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "unosim-runtime-fidelity-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads an open INPUT_PULLUP pin as HIGH", async () => {
    const serial = await runUntilDone(root, "pullup", `
void setup() {
  Serial.begin(115200);
  pinMode(2, INPUT_PULLUP);
  Serial.print("PIN2=");
  Serial.println(digitalRead(2));
  Serial.println("DONE");
}
void loop() {}
`);
    expect(serial).toContain("PIN2=1");
  }, 30_000);

  it("runs a sketch whose helper signatures use a typedef", async () => {
    const serial = await runUntilDone(root, "typedef", `
typedef struct vektor { float x; float y; } Vektor;
void setup() {
  Serial.begin(115200);
  Vektor a = {1, 2};
  Serial.println(addieren(a, a).y, 1);
  Serial.println("DONE");
}
void loop() {}
Vektor addieren(Vektor v, Vektor s) { v.x += s.x; v.y += s.y; return v; }
`);
    expect(serial).toContain("4.0");
  }, 30_000);

  it("runs a sketch whose header uses constant array sizes and default arguments", async () => {
    const header = `
#pragma once
const int M = 2;
void printFirst(const double mat[M][M], const char *name = "M", byte precision = 2) {
  Serial.print(name);
  Serial.println(mat[0][0], precision);
}
`;
    const serial = await runUntilDone(root, "matrix", `
#include "mat.h"
double A[M][M] = {{1.5, 0}, {0, 1}};
void setup() {
  Serial.begin(115200);
  scale(A, 2);
  printFirst(A);
  printFirst(A, "A", 1);
  Serial.println("DONE");
}
void loop() {}
void scale(double mat[M][M], double factor) { mat[0][0] *= factor; }
`, [{ name: "mat.h", content: header }]);
    expect(serial).toContain("M3.00");
    expect(serial).toContain("A3.0");
  }, 30_000);
});
