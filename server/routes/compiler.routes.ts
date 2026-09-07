import type { Express, Response } from "express";
import type { CompilationResult, CompileRequestOptions } from "../services/arduino-compiler";
import type { Logger } from "@shared/logger";
import { compileRequestSchema } from "@shared/schema";
import { TEST_RUN_ID_PATTERN } from "@shared/input-limits";
import { resolvePathWithinRoot } from "../security/safe-paths";
import { compileMetricsTracker } from "../services/server-metrics";
import path from "node:path";
import type { RequestIdentity } from "../security/access-control";
import type { RateLimitResult } from "../services/rate-limiter";
import { operationError } from "@shared/operation-errors";

type CompilerHeader = { name: string; content: string };

type CompilerDeps = {
  compiler: {
    compile: (code: string, headers?: CompilerHeader[], tempRoot?: string, options?: CompileRequestOptions) => Promise<CompilationResult>;
    tracksCompileMetrics?: boolean;
  };
  compilationCache: Map<string, { result: CompilationResult; timestamp: number }>;
  hashCode: (code: string, headers?: CompilerHeader[], options?: CompileRequestOptions) => string;
  CACHE_TTL: number;
  setLastCompiledCode: (code: string | null) => void;
  logger: Logger;
  compileRateLimiter?: { checkLimit: (identity: string) => RateLimitResult };
  disableRateLimit?: boolean;
};

type CompileRequestData = {
  code: string;
  headers?: CompilerHeader[];
  fqbn?: string;
  libraries?: string[];
};

type ParsedCompileRequest =
  | { success: true; data: CompileRequestData }
  | { success: false; error: string };

function parseCompileRequest(body: unknown): ParsedCompileRequest {
  const parsedRequest = compileRequestSchema.safeParse(body);

  if (!parsedRequest.success) {
    const codeMissing = parsedRequest.error.issues.some(
      (issue) => issue.path[0] === "code" && issue.code === "invalid_type",
    );
    return { success: false, error: codeMissing ? "Code is required" : "Invalid compile request" };
  }

  if (!parsedRequest.data.code) {
    return { success: false, error: "Code is required" };
  }

  return { success: true, data: parsedRequest.data };
}

function isTimedOutCompileResult(result: CompilationResult): boolean {
  return !result.success && `${result.stderr ?? ""} ${result.errors.map((err) => err.message).join(" ")}`.toLowerCase().includes("timeout");
}

function recordCompileMetricIfNeeded(
  compiler: CompilerDeps["compiler"],
  compileStartTime: number,
  result: CompilationResult,
): void {
  if (compiler.tracksCompileMetrics === true) return;
  compileMetricsTracker.recordCompileComplete(
    compileStartTime,
    0,
    result.success,
    isTimedOutCompileResult(result),
  );
}

function recordCompileErrorIfNeeded(
  compiler: CompilerDeps["compiler"],
  compileStartTime: number | null,
  error: unknown,
): void {
  if (compileStartTime === null || compiler.tracksCompileMetrics === true) return;
  const message = error instanceof Error ? error.message : String(error);
  compileMetricsTracker.recordCompileComplete(compileStartTime, 0, false, message.toLowerCase().includes("timeout"));
}

function enforceCompileRateLimit(
  res: Response,
  deps: CompilerDeps,
): boolean {
  if (!deps.compileRateLimiter || deps.disableRateLimit) return true;

  const identity = res.locals.unosimIdentity as RequestIdentity | undefined;
  if (!identity) {
    deps.logger.error("[Compiler Route] Missing trusted request identity");
    res.status(500).json({ error: "Compilation failed" });
    return false;
  }

  const limit = deps.compileRateLimiter.checkLimit(identity.subject);
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    res.status(429).json({
      error: operationError(
        "RATE_LIMITED",
        "Compile rate limit exceeded. Please try again later.",
        limit.retryAfter,
      ),
    });
    return false;
  }

  return true;
}

function getCachedCompilation(
  compilationCache: CompilerDeps["compilationCache"],
  codeHash: string,
  cacheTtl: number,
  cacheDisabled: boolean,
): { result: CompilationResult; ageMs: number } | null {
  if (cacheDisabled) return null;
  const cachedEntry = compilationCache.get(codeHash);
  if (!cachedEntry) return null;

  const ageMs = Date.now() - cachedEntry.timestamp;
  if (ageMs < cacheTtl) return { result: cachedEntry.result, ageMs };
  compilationCache.delete(codeHash);
  return null;
}

export function registerCompilerRoutes(app: Express, deps: CompilerDeps) {
  const { compiler, compilationCache, hashCode, CACHE_TTL, setLastCompiledCode, logger } = deps;

  app.post("/api/compile", async (req, res) => {
    let compileStartTime: number | null = null;
    try {
      if (!enforceCompileRateLimit(res, deps)) return;

      const parsedRequest = parseCompileRequest(req.body);
      if (!parsedRequest.success) {
        return res.status(400).json({ error: parsedRequest.error });
      }
      const { code, headers, fqbn, libraries } = parsedRequest.data;

      const codeHash = hashCode(code, headers, { fqbn, libraries });
      const cacheDisabled = process.env.DISABLE_COMPILE_CACHE === "true";
      const cachedResult = getCachedCompilation(
        compilationCache,
        codeHash,
        CACHE_TTL,
        cacheDisabled,
      );
      if (cachedResult) {
        logger.info(`✅ Cache hit for code (age: ${cachedResult.ageMs}ms)`);
        setLastCompiledCode(code);
        return res.json({ ...cachedResult.result, cached: true });
      }

      const testRunIdHeader = req.header("x-test-run-id");
      if (testRunIdHeader !== undefined && !TEST_RUN_ID_PATTERN.test(testRunIdHeader)) {
        return res.status(400).json({ error: "Invalid test run ID" });
      }
      const compileTempRoot = testRunIdHeader
        ? resolvePathWithinRoot(path.join(process.cwd(), "temp"), testRunIdHeader)
        : undefined;

      compileStartTime = Date.now();
      const result: CompilationResult = await compiler.compile(
        code,
        headers,
        compileTempRoot,
        {
          fqbn,
          libraries,
        },
      );

      recordCompileMetricIfNeeded(compiler, compileStartTime, result);

      if (result.success) {
        if (!cacheDisabled) {
          compilationCache.set(codeHash, { result, timestamp: Date.now() });
          logger.info(`✅ Cached compilation result for code`);
        }
        setLastCompiledCode(code);
      }

      res.json(result);
    } catch (error) {
      recordCompileErrorIfNeeded(compiler, compileStartTime, error);
      logger.error(`[Compiler Route] Error during /api/compile: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Compilation failed" });
    }
  });
}
