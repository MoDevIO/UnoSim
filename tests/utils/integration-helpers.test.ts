import { vi } from "vitest";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  default: { execSync: vi.fn() },
}));

describe("integration-helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  test("isServerRunningSync -> true when execSync succeeds", async () => {
    const childProcess = await import("child_process");
    vi.mocked(childProcess.execSync).mockImplementation(() => Buffer.from("ok"));
    const mod = await import("../../tests/utils/integration-helpers");
    expect(mod.isServerRunningSync()).toBe(true);
  });

  test("isServerRunningSync -> false when execSync throws", async () => {
    const childProcess = await import("child_process");
    vi.mocked(childProcess.execSync).mockImplementation(() => {
      throw new Error("no");
    });
    const mod = await import("../../tests/utils/integration-helpers");
    expect(mod.isServerRunningSync()).toBe(false);
  });

  test("isServerRunning (async) resolves true when http.request returns 200", async () => {
    const events = await import("events");
    const childProcess = await import("child_process");
    vi.mocked(childProcess.execSync).mockImplementation(() => Buffer.from("ok"));

    vi.doMock("http", () => ({
      request: vi.fn((opts: any, cb: any) => {
        const res = { statusCode: 200 };
        if (typeof cb === "function") cb(res);
        const req = new events.EventEmitter();
        (req as any).end = () => {};
        (req as any).on = (req as any).addListener;
        return req;
      }),
      default: {
        request: vi.fn((opts: any, cb: any) => {
          const res = { statusCode: 200 };
          if (typeof cb === "function") cb(res);
          const req = new events.EventEmitter();
          (req as any).end = () => {};
          (req as any).on = (req as any).addListener;
          return req;
        }),
      },
    }));

    const mod = await import("../../tests/utils/integration-helpers");
    await expect(mod.isServerRunning()).resolves.toBe(true);
  });
});
