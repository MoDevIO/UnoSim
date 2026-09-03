import type { Express } from "express";
import type { CompilationResult, CompileRequestOptions } from "../services/arduino-compiler";
import type { Logger } from "@shared/logger";
import { compileRequestSchema } from "@shared/schema";

type CompilerHeader = { name: string; content: string };

type CompilerDeps = {
  compiler: {
    compile: (code: string, headers?: CompilerHeader[], tempRoot?: string, options?: CompileRequestOptions) => Promise<CompilationResult>;
  };
  compilationCache: Map<string, { result: CompilationResult; timestamp: number }>;
  hashCode: (code: string, headers?: CompilerHeader[]) => string;
  CACHE_TTL: number;
  setLastCompiledCode: (code: string | null) => void;
  logger: Logger;
};

import path from "node:path";

export function registerCompilerRoutes(app: Express, deps: CompilerDeps) {
  const { compiler, compilationCache, hashCode, CACHE_TTL, setLastCompiledCode, logger } = deps;

  app.post("/api/compile", async (req, res) => {
    try {
      const parsedRequest = compileRequestSchema.safeParse(req.body);
      if (!parsedRequest.success) {
        const codeMissing = parsedRequest.error.issues.some(
          (issue) => issue.path[0] === "code" && issue.code === "invalid_type",
        );
        if (codeMissing) {
          return res.status(400).json({ error: "Code is required" });
        }
        return res.status(400).json({ error: "Invalid compile request" });
      }
      const { code, headers, fqbn, libraries } = parsedRequest.data;
      if (!code) {
        return res.status(400).json({ error: "Code is required" });
      }

      const codeHash = hashCode(code, headers);
      const cachedEntry = compilationCache.get(codeHash);

      if (cachedEntry) {
        const cacheAge = Date.now() - cachedEntry.timestamp;
        if (cacheAge < CACHE_TTL) {
          logger.info(`✅ Cache hit for code (age: ${cacheAge}ms)`);
          const result = cachedEntry.result;
          setLastCompiledCode(code);
          return res.json({ ...result, cached: true });
        } else {
          compilationCache.delete(codeHash);
        }
      }

      const testRunIdHeader = req.header("x-test-run-id") || undefined;
      const compileTempRoot = testRunIdHeader
        ? path.join(process.cwd(), "temp", testRunIdHeader)
        : undefined;

      const result: CompilationResult = await compiler.compile(
        code,
        headers,
        compileTempRoot,
        {
          fqbn,
          libraries,
        },
      );

      if (result.success) {
        compilationCache.set(codeHash, { result, timestamp: Date.now() });
        logger.info(`✅ Cached compilation result for code`);
        setLastCompiledCode(code);
      }

      res.json(result);
    } catch (error) {
      logger.error(`[Compiler Route] Error during /api/compile: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Compilation failed" });
    }
  });
}
