import type { Express } from "express";

interface TestResetApi {
  stopAllRunnersAndNotify: () => Promise<{
    cleanedUpCount: number;
    cleanedTestRunIds: string[];
  }>;
}

interface TestResetLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface TestResetRouteOptions {
  isTest: boolean;
  enabled: boolean;
  getSimulationApi: () => TestResetApi | null;
  logger: TestResetLogger;
}

export function registerTestResetRoute(
  app: Express,
  options: TestResetRouteOptions,
): void {
  // Requiring both conditions prevents a lone production environment flag
  // from exposing a destructive, process-global endpoint.
  if (!options.isTest || !options.enabled) return;

  app.post("/api/test-reset", async (_req, res) => {
    try {
      const simulationApi = options.getSimulationApi();
      if (!simulationApi) {
        options.logger.warn("/api/test-reset called before WS module initialized");
        return res.json({
          status: "reset",
          message: "No active runners",
          cleanedTestRunIds: [],
          timestamp: new Date().toISOString(),
        });
      }

      const { cleanedUpCount, cleanedTestRunIds } =
        await simulationApi.stopAllRunnersAndNotify();

      options.logger.info(
        `[Test Reset] Cleaned up ${cleanedUpCount} client runner(s). TestRunIds: ${cleanedTestRunIds.join(", ") || "none"}`,
      );
      res.json({
        status: "reset",
        message: `Backend reset complete. Cleaned up ${cleanedUpCount} runner(s).`,
        cleanedTestRunIds,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      options.logger.error(`[Test Reset] Error during reset: ${error}`);
      res.status(500).json({ error: "Reset failed", message: String(error) });
    }
  });
}
