import { Logger, setLogLevel } from "../../shared/logger";

describe("Logger", () => {
  let logger: Logger;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // force DEBUG so all levels are emitted during tests
    setLogLevel("DEBUG");

    logger = new Logger("TestSender");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // legacy TEST level removed; focus on current levels

  it.each([
    ["info", "INFO"],
    ["warn", "WARN"],
    ["error", "ERROR"],

  ])("should log correct format for %s level", (methodName, level) => {
    const msg = "hello world";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

    (logger as any)[methodName](msg);

    const spy = level === "ERROR" ? errorSpy : logSpy;
    expect(spy).toHaveBeenCalledWith(
      `[2025-01-01T00:00:00.000Z][${level}][TestSender] ${msg}`,
    );

    vi.useRealTimers();
  });

  it('should suppress DEBUG logs in test environment when level < DEBUG', () => {
    // set a stricter level and verify buffer behavior
    setLogLevel("INFO");
    const msg = 'debug message';
    logger.debug(msg);
    expect(logSpy).not.toHaveBeenCalled();
  });

  describe("Logger - Browser Environment", () => {
    const originalWindow = globalThis.window;
    const originalProcess = globalThis.process;

    beforeEach(() => {
      // Simulate browser environment
      (globalThis as any).window = {};
      (globalThis as any).process = { env: {} };
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      (globalThis as any).window = originalWindow;
      (globalThis as any).process = originalProcess;
      vi.restoreAllMocks();
    });

    it("should suppress DEBUG logs in browser production mode", () => {
      (globalThis as any).process.env.NODE_ENV = "production";
      // override log level to INFO so debug is filtered
      setLogLevel("INFO");
      const browserLogger = new Logger("TestBrowser");

      browserLogger.debug("This should not appear");

      expect(logSpy).not.toHaveBeenCalled();
    });

    it("should buffer DEBUG logs even in browser development mode", () => {
      (globalThis as any).process.env.NODE_ENV = "development";
      setLogLevel("DEBUG");
      const browserLogger = new Logger("TestBrowser");

      browserLogger.debug("This should appear");

      // debug entries go to buffer, not console
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("should always allow INFO/WARN/ERROR in browser", () => {
      (globalThis as any).process.env.NODE_ENV = "production";
      setLogLevel("INFO");
      const browserLogger = new Logger("TestBrowser");

      browserLogger.info("Info message");
      browserLogger.warn("Warn message");
      browserLogger.error("Error message");

      // error goes to console.error, so check both spies
      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Logger - Sanitization (sanitize() coverage)", () => {
    it("should redact password= values in log messages", () => {
      setLogLevel("INFO");
      const sanitizeLogger = new Logger("SanitizeTest");
      sanitizeLogger.info("login failed: password=hunter2");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[REDACTED]"),
      );
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("hunter2"),
      );
    });

    it("should redact pwd= values in log messages", () => {
      setLogLevel("INFO");
      const sanitizeLogger = new Logger("SanitizeTest");
      sanitizeLogger.info("login: pwd=s3cr3t");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[REDACTED]"),
      );
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("s3cr3t"),
      );
    });

    it("should redact email addresses in log messages", () => {
      setLogLevel("INFO");
      const sanitizeLogger = new Logger("SanitizeTest");
      sanitizeLogger.info("User logged in: user@example.com");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[EMAIL_REDACTED]"),
      );
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("user@example.com"),
      );
    });

    it("should redact bearer tokens in log messages", () => {
      setLogLevel("INFO");
      const sanitizeLogger = new Logger("SanitizeTest");
      sanitizeLogger.info("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("bearer [REDACTED_TOKEN]"),
      );
    });

    it("should not redact normal log messages", () => {
      setLogLevel("INFO");
      const sanitizeLogger = new Logger("SanitizeTest");
      sanitizeLogger.info("Simulation started successfully");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Simulation started successfully"),
      );
    });
  });
});
