import { Logger } from "../../shared/logger";

describe("Logger", () => {
  let logger: Logger;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger("TestSender");
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
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
    ["debug", "DEBUG"],
  ])("should log correct format for %s level", (methodName, level) => {
    const msg = "hello world";
    const now = new Date();

    // Mock Date to fix timestamp
    const dateSpy = jest.spyOn(global, "Date").mockImplementation(
      () =>
        ({
          toISOString: () => "fixed-timestamp",
        }) as any,
    );

    (logger as any)[methodName](msg);

    expect(consoleSpy).toHaveBeenCalledWith(
      `[fixed-timestamp][${level}][TestSender] ${msg}`,
    );

    dateSpy.mockRestore();
  });

  describe("Logger - Browser Environment", () => {
    const originalWindow = global.window;
    const originalProcess = global.process;

    beforeEach(() => {
      // Simulate browser environment
      (global as any).window = {};
      (global as any).process = { env: {} };
      jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      (global as any).window = originalWindow;
      (global as any).process = originalProcess;
      jest.restoreAllMocks();
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
