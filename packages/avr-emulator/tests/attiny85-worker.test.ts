import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_LIMITS, type RunEvent, WorkerHost, buildSimulationImage, decodeBase64, parseCommand } from "../src/index";
import { FakeClock } from "./fake-clock";

describe("serialBaud of the start command (plan P6.5)", () => {
  it("is optional and checked against its limits", () => {
    expect(parseCommand({ type: "start", runId: 2, timeoutMs: 60_000, serialBaud: 9600 })).toEqual({ ok: true, command: { type: "start", runId: 2, timeoutMs: 60_000, serialBaud: 9600 } });
    expect(parseCommand({ type: "start", runId: 2, timeoutMs: 60_000 })).toEqual({ ok: true, command: { type: "start", runId: 2, timeoutMs: 60_000 } });
    for (const serialBaud of [COMMAND_LIMITS.minSerialBaud - 1, COMMAND_LIMITS.maxSerialBaud + 1, 9600.5, "9600"]) {
      expect(parseCommand({ type: "start", runId: 2, timeoutMs: 60_000, serialBaud })).toMatchObject({ ok: false });
    }
  });

  it("lets the ATtiny85 decode a byte too short for baud detection with the sketch's rate", () => {
    const image = buildSimulationImage({ board: "attiny85", hex: readFileSync(join(__dirname, "fixtures", "attiny85-tiny_serial_ff.hex"), "utf8") });
    const bytes = decodeBase64(image.flashBase64);
    const events: RunEvent[] = [];
    let host: WorkerHost | undefined;
    const clock = new FakeClock(() => host?.simTimeMs ?? 0);
    host = new WorkerHost({ clock, post: (event) => events.push(event) });
    host.handleMessage({
      type: "load", runId: 1, board: "attiny85", artifactBoard: "attiny85", buildId: "build-1", sha256: image.sha256, symbols: image.symbols,
      flash: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    host.handleMessage({ type: "start", runId: 2, timeoutMs: 10_000, serialBaud: 9600 });
    clock.runUntil(300);

    const serial = events.filter((event) => event.type === "serial").map((event) => (event as { text: string }).text).join("");
    expect(serial).toBe("�"); // the byte 0xFF, never valid UTF-8
  });
});
