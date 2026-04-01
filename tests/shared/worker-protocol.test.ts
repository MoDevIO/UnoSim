import { describe, it, expect } from "vitest";
import {
  WorkerCommand,
  isCompileRequest,
  isCompileResponse,
  isReadyMessage,
  isShutdownMessage,
  createCompileRequest,
  createCompileResponse,
  createReadyMessage,
  createWorkerError,
} from "@shared/worker-protocol";

describe("worker-protocol", () => {
  describe("WorkerCommand enum", () => {
    it("has correct command values", () => {
      expect(WorkerCommand.COMPILE).toBe("compile");
      expect(WorkerCommand.READY).toBe("ready");
      expect(WorkerCommand.SHUTDOWN).toBe("shutdown");
      expect(WorkerCommand.COMPILE_RESULT).toBe("compile_result");
    });
  });

  describe("type guards", () => {
    it("isCompileRequest identifies compile requests", () => {
      const msg = createCompileRequest({ code: "void setup(){}" });
      expect(isCompileRequest(msg)).toBe(true);
    });

    it("isCompileRequest rejects non-compile messages", () => {
      const ready = createReadyMessage();
      expect(isCompileRequest(ready)).toBe(false);
    });

    it("isCompileRequest rejects messages without payload", () => {
      const msg = { type: WorkerCommand.COMPILE };
      expect(isCompileRequest(msg)).toBe(false);
    });

    it("isCompileResponse identifies compile responses", () => {
      const msg = createCompileResponse({ result: undefined });
      expect(isCompileResponse(msg)).toBe(true);
    });

    it("isCompileResponse rejects non-response messages", () => {
      const ready = createReadyMessage();
      expect(isCompileResponse(ready)).toBe(false);
    });

    it("isReadyMessage identifies ready messages", () => {
      const msg = createReadyMessage();
      expect(isReadyMessage(msg)).toBe(true);
    });

    it("isReadyMessage rejects non-ready messages", () => {
      const msg = createCompileRequest({ code: "" });
      expect(isReadyMessage(msg)).toBe(false);
    });

    it("isShutdownMessage identifies shutdown messages", () => {
      const msg = { type: WorkerCommand.SHUTDOWN };
      expect(isShutdownMessage(msg)).toBe(true);
    });

    it("isShutdownMessage rejects non-shutdown messages", () => {
      const msg = createReadyMessage();
      expect(isShutdownMessage(msg)).toBe(false);
    });
  });

  describe("factory functions", () => {
    it("createCompileRequest builds correct message", () => {
      const msg = createCompileRequest(
        { code: "void setup(){}", headers: [{ name: "test.h", content: "#define X" }] },
        "task-123",
      );
      expect(msg.type).toBe(WorkerCommand.COMPILE);
      expect(msg.payload.code).toBe("void setup(){}");
      expect(msg.payload.headers).toHaveLength(1);
      expect(msg.taskId).toBe("task-123");
    });

    it("createCompileRequest without taskId", () => {
      const msg = createCompileRequest({ code: "" });
      expect(msg.taskId).toBeUndefined();
    });

    it("createCompileResponse with result", () => {
      const msg = createCompileResponse({ result: { success: true } as any }, "task-456");
      expect(msg.type).toBe(WorkerCommand.COMPILE_RESULT);
      expect(msg.payload.result?.success).toBe(true);
      expect(msg.taskId).toBe("task-456");
    });

    it("createCompileResponse with error", () => {
      const msg = createCompileResponse({
        error: { message: "fail", code: "E_COMPILE" },
      });
      expect(msg.payload.error?.message).toBe("fail");
      expect(msg.payload.error?.code).toBe("E_COMPILE");
    });

    it("createReadyMessage builds correct message", () => {
      const msg = createReadyMessage();
      expect(msg.type).toBe(WorkerCommand.READY);
    });
  });

  describe("createWorkerError", () => {
    it("converts Error objects", () => {
      const err = new Error("test error");
      const workerErr = createWorkerError(err);
      expect(workerErr.message).toBe("test error");
      expect(workerErr.stack).toBeDefined();
    });

    it("converts Error with code", () => {
      const err = Object.assign(new Error("coded"), { code: "ENOENT" });
      const workerErr = createWorkerError(err);
      expect(workerErr.message).toBe("coded");
      expect(workerErr.code).toBe("ENOENT");
    });

    it("converts string errors", () => {
      const workerErr = createWorkerError("string error");
      expect(workerErr.message).toBe("string error");
    });

    it("converts number errors", () => {
      const workerErr = createWorkerError(42);
      expect(workerErr.message).toBe("42");
    });

    it("converts null errors", () => {
      const workerErr = createWorkerError(null);
      expect(workerErr.message).toBe("null");
    });
  });
});
