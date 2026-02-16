import type { Express } from "express";
import type { CompilationResult } from "../services/arduino-compiler";
import type { Logger } from "@shared/logger";

export type CompilerDeps = {
  compiler: {
    compile: (code: string, headers?: any[], tempRoot?: string) => Promise<CompilationResult>;
  };
  compilationCache: Map<string, { result: CompilationResult; timestamp: number }>;
  hashCode: (code: string, headers?: Array<{ name: string; content: string }>) => string;
  CACHE_TTL: number;
  setLastCompiledCode: (code: string | null) => void;
  logger: Logger;
};

import path from "path";

export function registerCompilerRoutes(app: Express, deps: CompilerDeps) {
  const { compiler, compilationCache, hashCode, CACHE_TTL, setLastCompiledCode, logger } = deps;

  app.post("/api/compile", async (req, res) => {
    try {
      const { code, headers } = req.body;
      if (!code || typeof code !== "string") {
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
