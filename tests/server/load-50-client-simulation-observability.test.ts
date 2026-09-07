import { describe, it, expect } from "vitest";
import WebSocket from "ws";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

type StatusSnapshot = {
  webSocketSessions?: { active: number; running: number; paused: number; totalConnections: number; totalDisconnections: number };
  processMetrics?: { cpuPercent: number; memoryPercent: number };
  sandboxRunners?: { total: number; available: number; inUse: number; queued: number; max: number };
};

type ClientResult = {
  connected: boolean;
  started: boolean;
  firstOutputMs: number | null;
  startLatencyMs: number | null;
  stopped: boolean;
  timedOut: boolean;
  disconnects: number;
  serialMessages: number;
  telemetryMessages: number;
  serialDroppedBytes: number;
  pinDroppedChanges: number;
  errors: string[];
};

function getStatus(baseUrl: string): Promise<StatusSnapshot> {
  return new Promise((resolve, reject) => {
    const target = new URL(`${baseUrl}/api/status`);
    const request = http.get({ hostname: target.hostname, port: target.port, path: target.pathname }, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => {
        try { resolve(JSON.parse(body) as StatusSnapshot); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
  });
}

function sketch(clientId: number): string {
  return `void setup() { Serial.begin(9600); Serial.println("CLIENT_${clientId}_START"); }\nvoid loop() { Serial.println("CLIENT_${clientId}_TICK"); delay(100); }`;
}

function runClient(baseUrl: string, clientId: number, timeoutMs = 120_000): Promise<ClientResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const result: ClientResult = { connected: false, started: false, firstOutputMs: null, startLatencyMs: null, stopped: false, timedOut: false, disconnects: 0, serialMessages: 0, telemetryMessages: 0, serialDroppedBytes: 0, pinDroppedChanges: 0, errors: [] };
    const ws = new WebSocket(baseUrl.replace(/^http/, "ws") + "/ws");
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); if (ws.readyState === WebSocket.OPEN) ws.close(); resolve(result); };
    const timer = setTimeout(() => { result.timedOut = true; result.errors.push(`timeout after ${timeoutMs}ms`); finish(); }, timeoutMs);
    ws.on("open", () => { result.connected = true; ws.send(JSON.stringify({ type: "start_simulation", code: sketch(clientId) })); });
    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; status?: string; data?: string };
        if (message.type === "simulation_status" && message.status === "running" && !result.started) { result.started = true; result.startLatencyMs = Date.now() - startedAt; }
        if (message.type === "serial_output") {
          result.serialMessages++;
          if (result.firstOutputMs === null) {
            result.firstOutputMs = Date.now() - startedAt;
            ws.send(JSON.stringify({ type: "stop_simulation" }));
          }
        }
        if (message.type === "sim_telemetry" || message.type === "telemetry") {
          result.telemetryMessages++;
          const metrics = (message as { metrics?: { serialDroppedBytesPerSecond?: number; droppedPinChangesPerSecond?: number } }).metrics;
          result.serialDroppedBytes += metrics?.serialDroppedBytesPerSecond ?? 0;
          result.pinDroppedChanges += metrics?.droppedPinChangesPerSecond ?? 0;
        }
        if (message.type === "simulation_status" && message.status === "stopped" && result.started) { result.stopped = true; setTimeout(finish, 100); }
      } catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)); }
    });
    ws.on("close", () => { result.disconnects++; if (!result.stopped && !result.timedOut) finish(); });
    ws.on("error", (error) => { result.errors.push(error.message); finish(); });
  });
}

describe("real Docker simulation observability", () => {
  it("measures concurrent WebSocket simulations", async () => {
    const baseUrl = process.env.LOAD_TEST_SERVER_URL || "http://127.0.0.1:3000";
    const clientCount = Number.parseInt(process.env.LOAD_TEST_CLIENT_COUNT || "50", 10);
    const history: StatusSnapshot[] = [];
    const poller = setInterval(async () => { try { history.push(await getStatus(baseUrl)); } catch { /* server shutdown */ } }, 250);
    const start = Date.now();
    const startStatus = await getStatus(baseUrl);
    const clients = await Promise.all(Array.from({ length: clientCount }, (_, index) => runClient(baseUrl, index + 1)));
    clearInterval(poller);
    const endStatus = await getStatus(baseUrl);
    history.push(endStatus);
    const peak = {
      active: Math.max(...history.map((item) => item.webSocketSessions?.active ?? 0)),
      running: Math.max(...history.map((item) => item.webSocketSessions?.running ?? 0)),
      paused: Math.max(...history.map((item) => item.webSocketSessions?.paused ?? 0)),
      runnersInUse: Math.max(...history.map((item) => item.sandboxRunners?.inUse ?? 0)),
      runnerQueue: Math.max(...history.map((item) => item.sandboxRunners?.queued ?? 0)),
      cpuPercent: Math.max(...history.map((item) => item.processMetrics?.cpuPercent ?? 0)),
      memoryPercent: Math.max(...history.map((item) => item.processMetrics?.memoryPercent ?? 0)),
    };
    const result = {
      clients: clientCount,
      successful: clients.filter((item) => item.started && item.firstOutputMs !== null && item.stopped && !item.timedOut).length,
      connected: clients.filter((item) => item.connected).length,
      firstOutputCount: clients.filter((item) => item.firstOutputMs !== null).length,
      timeouts: clients.filter((item) => item.timedOut).length,
      errors: clients.reduce((sum, item) => sum + item.errors.length, 0),
      disconnects: clients.reduce((sum, item) => sum + item.disconnects, 0),
      serialMessages: clients.reduce((sum, item) => sum + item.serialMessages, 0),
      telemetryMessages: clients.reduce((sum, item) => sum + item.telemetryMessages, 0),
      serialDroppedBytes: clients.reduce((sum, item) => sum + item.serialDroppedBytes, 0),
      pinDroppedChanges: clients.reduce((sum, item) => sum + item.pinDroppedChanges, 0),
      avgStartLatencyMs: clients.reduce((sum, item) => sum + (item.startLatencyMs ?? 0), 0) / clientCount,
      avgFirstOutputLatencyMs: clients.reduce((sum, item) => sum + (item.firstOutputMs ?? 0), 0) / clientCount,
      totalTimeMs: Date.now() - start,
      peak,
      startStatus,
      endStatus,
      clientsDetail: clients,
    };
    const outputDir = path.join(process.cwd(), "load-test-results");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${clientCount}-client-simulation-observability-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    expect(result.successful).toBe(clientCount);
    expect(result.timeouts).toBe(0);
    expect(result.errors).toBe(0);
  }, 900_000);
});
