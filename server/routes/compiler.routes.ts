import type { Express, Response } from "express";
import type { CompilationResult, CompileRequestOptions } from "../services/arduino-compiler";
import type { Logger } from "@shared/logger";
import { compileRequestSchema } from "@shared/schema";
import { type BoardCatalogEntry, type BoardId, enabledBoards, findBoardByFqbn, getBoard } from "@shared/boards";
import { TEST_RUN_ID_PATTERN } from "@shared/input-limits";
import { resolvePathWithinRoot } from "../security/safe-paths";
import { compileMetricsTracker } from "../services/server-metrics";
import path from "node:path";
import type { RequestIdentity } from "../security/access-control";
import type { RateLimitResult } from "../services/rate-limiter";
import { operationError, SYSTEM_BUSY_MESSAGE } from "@shared/operation-errors";
import { CompileCapacityError } from "../services/compilation-worker-pool";
import { safeErrorLogMetadata } from "../services/safe-error-log-metadata";

type CompilerHeader = { name: string; content: string };

type CompilerDeps = {
  compiler: {
    compile: (code: string, headers?: CompilerHeader[], tempRoot?: string, options?: CompileRequestOptions) => Promise<CompilationResult>;
    tracksCompileMetrics?: boolean;
    /** Toolchain, libraries, options and artifact format the compiler checks its own cache under (plan E15). */
    buildEnvironmentId?: () => Promise<string>;
  };
  compilationCache: Map<string, { result: CompilationResult; timestamp: number }>;
  hashCode: (code: string, headers?: CompilerHeader[], options?: CompileRequestOptions) => string;
  CACHE_TTL: number;
  setLastCompiledCode: (subject: string, code: string) => void;
  logger: Logger;
  compileRateLimiter?: { checkLimit: (identity: string) => RateLimitResult };
  disableRateLimit?: boolean;
  /** Whether the response may carry the flash image (`artifact`); false when omitted. */
  artifactDelivery?: boolean;
  /** Boards this deployment offers; the catalog default (plan 4.11) when omitted. */
  offeredBoards?: () => readonly BoardCatalogEntry[];
};

type CompileRequestData = {
  code: string;
  headers?: CompilerHeader[];
  entryFile?: string;
  board?: BoardId;
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

/**
 * The board a request compiles for. `board` wins; the deprecated `fqbn` alone
 * means the board it belongs to (the schema ensures there is one). Requests
 * without either compile for the server default and leave the options as they
 * were. A board that is not offered is refused.
 */
function resolveCompileTarget(data: CompileRequestData, offered: readonly BoardCatalogEntry[]): { options: { board?: BoardId; fqbn?: string }; error?: string } {
  const board = data.board ?? (data.fqbn === undefined ? undefined : findBoardByFqbn(data.fqbn)?.id);
  if (board === undefined) return { options: {} };
  if (!offered.some((entry) => entry.id === board)) return { options: {}, error: `Board ${board} is not available` };
  return data.board === undefined ? { options: { fqbn: data.fqbn } } : { options: { board, fqbn: getBoard(board).fqbn } };
}

/**
 * What the client gets: never the HEX (`binary`), and the `artifact` only for
 * a successful build when the deployment may deliver it (plan 4.10: the local
 * profile; the Docker profile once the compile sandbox exists).
 */
function clientResultOf(result: CompilationResult, deliverArtifact: boolean): CompilationResult {
  const { binary: _binary, artifact, ...clientResult } = result;
  return deliverArtifact && result.success && artifact ? { ...clientResult, artifact } : clientResult;
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
  const rememberCompiledCode = (res: Response, code: string) => {
    const identity = res.locals.unosimIdentity as RequestIdentity | undefined;
    if (identity) setLastCompiledCode(identity.subject, code);
  };

  app.post("/api/compile", async (req, res) => {
    let compileStartTime: number | null = null;
    try {
      if (!enforceCompileRateLimit(res, deps)) return;

      const parsedRequest = parseCompileRequest(req.body);
      if (!parsedRequest.success) {
        return res.status(400).json({ error: parsedRequest.error });
      }
      const { code, headers, entryFile, libraries } = parsedRequest.data;
      const target = resolveCompileTarget(parsedRequest.data, (deps.offeredBoards ?? enabledBoards)());
      if (target.error) return res.status(400).json({ error: target.error });

      const compileOptions = {
        libraries,
        ...target.options,
        ...(entryFile ? { entryFile } : {}),
      };
      // The result cache answers before the compiler: its key carries the compiler's build environment, so a
      // changed toolchain or library set misses it just as it misses the compiler's own caches.
      const environment = await compiler.buildEnvironmentId?.();
      const requestHash = hashCode(code, headers, compileOptions);
      const codeHash = environment ? `${requestHash}:${environment}` : requestHash;
      const cacheDisabled = process.env.DISABLE_COMPILE_CACHE === "true";
      const cachedResult = getCachedCompilation(
        compilationCache,
        codeHash,
        CACHE_TTL,
        cacheDisabled,
      );
      if (cachedResult) {
        logger.info(`✅ Cache hit for code (age: ${cachedResult.ageMs}ms)`);
        rememberCompiledCode(res, code);
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
        compileOptions,
      );

      recordCompileMetricIfNeeded(compiler, compileStartTime, result);

      const clientResult = clientResultOf(result, deps.artifactDelivery === true);
      if (result.success) {
        if (!cacheDisabled) {
          compilationCache.set(codeHash, { result: clientResult, timestamp: Date.now() });
          logger.info(`✅ Cached compilation result for code`);
        }
        rememberCompiledCode(res, code);
      }

      res.json(clientResult);
    } catch (error) {
      if (error instanceof CompileCapacityError) {
        const retryAfter = 5;
        logger.warn(`[Compiler Route] Compile capacity exhausted: ${error.message}`);
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(503).json({ error: operationError("SYSTEM_BUSY", SYSTEM_BUSY_MESSAGE, retryAfter) });
      }
      recordCompileErrorIfNeeded(compiler, compileStartTime, error);
      logger.error(`[Compiler Route] Error during /api/compile (${safeErrorLogMetadata(error)})`);
      res.status(500).json({ error: "Compilation failed" });
    }
  });
}
