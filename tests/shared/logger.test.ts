import { Logger, setLogLevel, markTestAsFailed, initializeGlobalErrorHandlers } from "../../shared/logger";

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
    function logSanitized(input: string): void {
      setLogLevel("INFO");
      new Logger("SanitizeTest").info(input);
    }

    // The plaintext secret must be replaced by the marker and must not be logged.
    it.each([
      {
        title: "should redact credential key-value pairs in log messages",
        input: "login failed: password=redact-me", // NOSONAR S2068
        marker: "[REDACTED]",
        leaked: "redact-me",
      },
      {
        title: "should redact abbreviated credential key-value pairs in log messages",
        input: "login: pwd=redact-me", // NOSONAR S2068
        marker: "[REDACTED]",
        leaked: "redact-me",
      },
      {
        title: "should redact email addresses in log messages",
        input: "User logged in: user@example.com",
        marker: "[EMAIL_REDACTED]",
        leaked: "user@example.com",
      },
      {
        title: "should redact JSON sensitive fields (password/token/secret in JSON objects)",
        input: 'Request body: {"password": "hunter2", "user": "admin"}',
        marker: "[REDACTED]",
        leaked: "hunter2",
      },
    ])("$title", ({ input, marker, leaked }) => {
      logSanitized(input);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(marker));
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining(leaked));
    });

    // Patterns whose replacement marker is the whole contract; ordinary text passes through.
    it.each([
      {
        title: "should redact bearer tokens in log messages",
        input: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc",
        marker: "bearer [REDACTED_TOKEN]",
      },
      {
        title: "should not redact normal log messages",
        input: "Simulation started successfully",
        marker: "Simulation started successfully",
      },
      { title: "should redact SSN patterns (XXX-XX-XXXX)", input: "Customer SSN: 123-45-6789", marker: "[SSN_REDACTED]" },
      { title: "should redact phone numbers", input: "Call us at 555-123-4567", marker: "[PHONE_REDACTED]" },
      { title: "should redact credit card numbers", input: "Card: 1234 5678 9012 3456", marker: "[CARD_REDACTED]" },
    ])("$title", ({ input, marker }) => {
      logSanitized(input);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(marker));
    });
  });

  describe("RingBuffer overflow and markTestAsFailed", () => {
    it("should overflow ring buffer and flush via markTestAsFailed with reason", () => {
      setLogLevel("DEBUG");
      const bufLogger = new Logger("RingBufferTest");
      // Fill ring buffer past its maxSize (200) to trigger overflow branch
      for (let i = 0; i < 205; i++) {
        bufLogger.debug(`debug message ${i}`);
      }
      // markTestAsFailed flushes the buffer via flushDebugOnFailure
      markTestAsFailed("overflow test");
      // error spy should have been called with the flush header
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("DEBUG BUFFER FLUSH"),
      );
    });

    it("should flush buffer via markTestAsFailed without reason", () => {
      setLogLevel("DEBUG");
      const bufLogger = new Logger("RingBufferFlushTest");
      bufLogger.debug("test entry for flush");
      markTestAsFailed();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("DEBUG BUFFER FLUSH"),
      );
    });

    it("should handle markTestAsFailed when buffer is empty (no-op)", () => {
      // First clear the buffer by calling markTestAsFailed
      markTestAsFailed();
      // Now buffer is empty - calling again should be a no-op
      errorSpy.mockClear();
      markTestAsFailed("empty buffer");
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("DEBUG BUFFER FLUSH"),
      );
    });
  });

  describe("initializeGlobalErrorHandlers", () => {
    it("should register process error handlers without throwing", () => {
      expect(() => initializeGlobalErrorHandlers()).not.toThrow();
    });

    it("does not print an unhandled rejection's diagnostic text", () => {
      const diagnostic = "F01_COMPILER_DIAGNOSTIC_SENTINEL";
      logger.debug("safe buffered context");
      initializeGlobalErrorHandlers();
      const handler = process.listeners("unhandledRejection").at(-1) as (
        reason: unknown,
        promise: Promise<unknown>,
      ) => void;
      const uncaughtHandler = process.listeners("uncaughtException").at(-1) as (
        error: Error,
      ) => void;
      try {
        handler(new Error(diagnostic), Promise.resolve());
        expect(errorSpy.mock.calls.flat().join(" ")).not.toContain(diagnostic);
      } finally {
        process.off("unhandledRejection", handler);
        process.off("uncaughtException", uncaughtHandler);
      }
    });
  });
});
