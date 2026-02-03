import { Logger } from "../../shared/logger";

describe("Logger", () => {
  let logger: Logger;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger = new Logger("TestSender");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("should log only the message for TEST level", () => {
    const msg = "test message";
    logger.test(msg);
    expect(consoleSpy).toHaveBeenCalledWith(msg);
  });

  it.each([
    ["info", "INFO"],
    ["warn", "WARN"],
    ["error", "ERROR"],

  ])("should log correct format for %s level", (methodName, level) => {
    const msg = "hello world";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    (logger as any)[methodName](msg);

    expect(consoleSpy).toHaveBeenCalledWith(
      `[2025-01-01T00:00:00.000Z][${level}][TestSender] ${msg}`,
    );

    vi.useRealTimers();
  });

  it('should suppress DEBUG logs in test environment', () => {
    const msg = 'debug message';
    logger.debug(msg);
    // DEBUG logs are suppressed in test environment
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  describe("Logger - Browser Environment", () => {
    const originalWindow = global.window;
    const originalProcess = global.process;

    beforeEach(() => {
      // Simulate browser environment
      (global as any).window = {};
      (global as any).process = { env: {} };
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      (global as any).window = originalWindow;
      (global as any).process = originalProcess;
      vi.restoreAllMocks();
    });

    it("should suppress DEBUG logs in browser production mode", () => {
      (global as any).process.env.NODE_ENV = "production";
      const browserLogger = new Logger("TestBrowser");

      browserLogger.debug("This should not appear");

      expect(console.log).not.toHaveBeenCalled();
    });

    it("should allow DEBUG logs in browser development mode", () => {
      (global as any).process.env.NODE_ENV = "development";
      const browserLogger = new Logger("TestBrowser");

      browserLogger.debug("This should appear");

      expect(console.log).toHaveBeenCalled();
    });

    it("should always allow INFO/WARN/ERROR in browser", () => {
      (global as any).process.env.NODE_ENV = "production";
      const browserLogger = new Logger("TestBrowser");

      browserLogger.info("Info message");
      browserLogger.warn("Warn message");
      browserLogger.error("Error message");

      expect(console.log).toHaveBeenCalledTimes(3);
    });
  });
});
