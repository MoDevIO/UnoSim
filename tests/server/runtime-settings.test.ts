import { describe, expect, it } from "vitest";
import { parseRuntimeSettings } from "../../server/runtime-settings";

const local = (env: Record<string, string> = {}) => parseRuntimeSettings(env, "local");
const docker = (env: Record<string, string> = {}, options = {}) => parseRuntimeSettings(env, "docker", options);

describe("runtime settings (plan 4.11, P2.6)", () => {
  it("offers browser and host mock locally, the host mock alone in Docker, and starts with the browser locally and the host mock in Docker", () => {
    expect(local()).toEqual({ backends: ["browser", "host-mock"], defaultRuntime: "browser", boards: undefined, defaultBoard: "uno" });
    expect(docker()).toEqual({ backends: ["host-mock"], defaultRuntime: "host-mock", boards: undefined, defaultBoard: "uno" });
  });

  describe("UNOSIM_RUNTIME_BACKENDS and UNOSIM_DEFAULT_RUNTIME", () => {
    it("takes a list in any order, with spaces", () => {
      expect(local({ UNOSIM_RUNTIME_BACKENDS: " host-mock , browser " }).backends).toEqual(["host-mock", "browser"]);
    });

    it("defaults to the browser when the host mock is not offered", () => {
      expect(local({ UNOSIM_RUNTIME_BACKENDS: "browser" }).defaultRuntime).toBe("browser");
    });

    it("lets the default runtime be chosen among the offered backends", () => {
      expect(local({ UNOSIM_DEFAULT_RUNTIME: "browser" }).defaultRuntime).toBe("browser");
      expect(local({ UNOSIM_DEFAULT_RUNTIME: "host-mock" }).defaultRuntime).toBe("host-mock");
    });

    it("defaults to the host mock locally when the browser backend is not offered, and in Docker with the compile sandbox", () => {
      expect(local({ UNOSIM_RUNTIME_BACKENDS: "host-mock" }).defaultRuntime).toBe("host-mock");
      expect(docker({ UNOSIM_RUNTIME_BACKENDS: "host-mock,browser" }, { compileSandboxAvailable: true }).defaultRuntime).toBe("host-mock");
    });

    it.each<[string, Record<string, string>, RegExp]>([
      ["an unknown backend", { UNOSIM_RUNTIME_BACKENDS: "browser,wasm" }, /unknown value "wasm"/],
      ["an empty list", { UNOSIM_RUNTIME_BACKENDS: " , " }, /must not be empty/],
      ["a duplicate", { UNOSIM_RUNTIME_BACKENDS: "browser,browser" }, /lists a value twice/],
      ["an unknown default runtime", { UNOSIM_DEFAULT_RUNTIME: "native" }, /UNOSIM_DEFAULT_RUNTIME: unknown value "native"/],
      ["a default runtime that is not offered", { UNOSIM_RUNTIME_BACKENDS: "host-mock", UNOSIM_DEFAULT_RUNTIME: "browser" }, /not among UNOSIM_RUNTIME_BACKENDS/],
    ])("rejects %s", (_name, env, message) => {
      expect(() => local(env)).toThrow(message);
    });

    it("refuses the browser backend in the Docker profile until the compile sandbox exists", () => {
      expect(() => docker({ UNOSIM_RUNTIME_BACKENDS: "browser,host-mock" })).toThrow(/compile sandbox/);
      expect(docker({ UNOSIM_RUNTIME_BACKENDS: "browser,host-mock" }, { compileSandboxAvailable: true }).backends).toEqual(["browser", "host-mock"]);
    });
  });

  describe("UNOSIM_BOARDS and the default board", () => {
    it("takes the listed boards and validates them", () => {
      expect(local({ UNOSIM_BOARDS: "uno,nano" }).boards).toEqual(["uno", "nano"]);
      expect(() => local({ UNOSIM_BOARDS: "uno,esp32" })).toThrow(/UNOSIM_BOARDS: unknown value "esp32"/);
    });

    it("takes UNOSIM_DEFAULT_BOARD and validates it", () => {
      expect(local({ UNOSIM_DEFAULT_BOARD: "nano" }).defaultBoard).toBe("nano");
      expect(() => local({ UNOSIM_DEFAULT_BOARD: "esp32" })).toThrow(/UNOSIM_DEFAULT_BOARD: unknown value/);
    });

    it("accepts ARDUINO_FQBN as an alias of the board it names", () => {
      expect(local({ ARDUINO_FQBN: "arduino:avr:nano:cpu=atmega328" }).defaultBoard).toBe("nano");
      expect(local({ ARDUINO_FQBN: "arduino:avr:uno", UNOSIM_DEFAULT_BOARD: "uno" }).defaultBoard).toBe("uno");
    });

    it("rejects an ARDUINO_FQBN outside the catalog and one that contradicts UNOSIM_DEFAULT_BOARD", () => {
      expect(() => local({ ARDUINO_FQBN: "esp32:esp32:esp32" })).toThrow(/must be the FQBN of a board in the catalog/);
      expect(() => local({ ARDUINO_FQBN: "arduino:avr:uno", UNOSIM_DEFAULT_BOARD: "nano" })).toThrow(/name different boards/);
    });

    it("rejects a board that none of the offered backends can run", () => {
      expect(() => local({ UNOSIM_BOARDS: "nano", UNOSIM_RUNTIME_BACKENDS: "host-mock" })).toThrow(/board nano needs one of the runtime backends browser/);
      expect(() => local({ UNOSIM_DEFAULT_BOARD: "mega2560", UNOSIM_RUNTIME_BACKENDS: "host-mock" })).toThrow(/board mega2560 needs/);
    });

    it("runs the Uno with the host mock alone and with the browser alone", () => {
      expect(local({ UNOSIM_RUNTIME_BACKENDS: "host-mock" }).defaultBoard).toBe("uno");
      expect(local({ UNOSIM_RUNTIME_BACKENDS: "browser" }).defaultBoard).toBe("uno");
    });
  });

  describe("boards that need the browser backend (plan P4.8)", () => {
    it("starts the Docker profile without the Nano: the default list leaves out boards no offered backend can run", () => {
      expect(() => docker()).not.toThrow();
      expect(docker().boards).toBeUndefined();
    });

    it("refuses a Docker profile that asks for the Nano explicitly", () => {
      expect(() => docker({ UNOSIM_BOARDS: "uno,nano" })).toThrow(/board nano needs one of the runtime backends browser/);
    });

    it("accepts the Nano locally, where the browser backend is offered", () => {
      expect(() => local({ UNOSIM_BOARDS: "uno,nano" })).not.toThrow();
    });
  });
});
