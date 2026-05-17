/**
 * E2E Scalability Test: Many iframes, all WebSockets must connect
 *
 * Reproduces the bug where ~10 out of 40 iframes never establish their
 * WebSocket connection and the Start-Button stays grey.
 *
 * TOPOLOGY (mirrors the real UnoSim_Test dashboard):
 *   One HTML container page → CLIENT_COUNT <iframe src="http://localhost:3000">
 *   Each iframe is a full UnoSim instance (same-origin to each other,
 *   cross-origin to the about:blank parent page injected by page.setContent).
 *
 * DETECTION:
 *   Uses window.__wsManager (exposed by websocket-manager.ts) to read the
 *   WebSocketManager state per iframe.  No code changes required.
 *
 * PASS CONDITION: All CLIENT_COUNT iframes reach state "connected" within
 *   CONNECT_TIMEOUT_MS (60 s).
 *
 * TOPOLOGY NOTE:
 *   The CSP header "frame-ancestors 'self' http://localhost:3000 …" blocks iframes
 *   from being embedded in a page with null (about:blank) origin.  Therefore the
 *   container page MUST be loaded from http://localhost:3000 itself so that the
 *   parent origin is 'self' and the frames are allowed to render.
 *
 *   Strategy:
 *     1. page.goto("http://localhost:3000") — parent origin = localhost:3000 ✓
 *     2. Inject CLIENT_COUNT iframes via JS (same src)
 *     3. Wait for Playwright to attach all frames
 *     4. Poll __wsManager().getState() in each iframe frame
 *
 * Usage:
 *   # Against running Docker stack (default, 40 clients):
 *   npx playwright test --config=playwright.scalability.config.ts
 *
 *   # Custom client count:
 *   CLIENT_COUNT=60 npx playwright test --config=playwright.scalability.config.ts
 */

import { test, expect, type Frame } from "@playwright/test";

// ── Parameters ────────────────────────────────────────────────────────────────

const CLIENT_COUNT = Number.parseInt(process.env.CLIENT_COUNT ?? "40", 10);
const CONNECT_TIMEOUT_MS = 60_000; // how long to wait for all iframes to connect
const FRAME_ATTACH_TIMEOUT_MS = 30_000; // how long to wait for Playwright to register frames

// ── Test ──────────────────────────────────────────────────────────────────────

test.describe("Scalability: many-client iframe load", () => {
  // Serial: the test itself loads many iframes; parallelism would multiply load.
  test.describe.configure({ mode: "serial" });

  test(`all ${CLIENT_COUNT} iframes establish WebSocket connection`, async ({ page }) => {
    // ── Init script: runs in EVERY frame (main page + each iframe) ────────────
    // Playwright injects addInitScript before any frame's scripts fire, including
    // dynamically created iframes.  Setting unoDebugMode makes the client-state
    // badge visible; __wsManager is already exposed by websocket-manager.ts.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("unoDebugMode", "1");
      } catch {
        // Ignore – storage might be unavailable in some contexts.
      }
    });

    // ── Navigate to parent page (must be localhost:3000 to satisfy CSP) ───────
    // CSP: "frame-ancestors 'self' http://localhost:3000 …"
    // An about:blank parent has null origin and is NOT in the allowlist.
    await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });

    // ── Register frame-attach listener BEFORE injecting iframes ──────────────
    // page.on("frameattached") fires for each new child frame.
    const iframeFrames: Frame[] = [];
    page.on("frameattached", (frame) => {
      if (frame !== page.mainFrame()) {
        iframeFrames.push(frame);
      }
    });

    // ── Inject CLIENT_COUNT iframes via JS ────────────────────────────────────
    await page.evaluate((count: number) => {
      for (let i = 0; i < count; i++) {
        const iframe = document.createElement("iframe");
        iframe.src = "http://localhost:3000";
        iframe.id = `iframe-${i}`;
        iframe.style.cssText =
          "width:1px;height:1px;position:absolute;border:none;top:0;left:0";
        document.body.appendChild(iframe);
      }
    }, CLIENT_COUNT);

    // ── Wait for Playwright to register all CLIENT_COUNT frames ───────────────
    await expect
      .poll(() => iframeFrames.length, {
        message: `Waiting for ${CLIENT_COUNT} iframe frames to attach`,
        timeout: FRAME_ATTACH_TIMEOUT_MS,
        intervals: [500],
      })
      .toBeGreaterThanOrEqual(CLIENT_COUNT);

    const targetFrames = iframeFrames.slice(0, CLIENT_COUNT);

    // ── Helper: query WS state from one frame ─────────────────────────────────
    type WsState = "connected" | "disconnected" | "connecting" | "reconnecting" | "not-loaded" | "error";

    async function getFrameWsState(frame: (typeof targetFrames)[number]): Promise<WsState> {
      try {
        return await frame.evaluate((): WsState => {
          const mgr = (window as unknown as { __wsManager?: () => { getState(): WsState } }).__wsManager;
          if (typeof mgr !== "function") return "not-loaded";
          return mgr().getState() as WsState;
        });
      } catch {
        return "error";
      }
    }

    // ── Poll until all iframes are connected or timeout ───────────────────────
    console.log(
      `[scalability] Waiting for ${CLIENT_COUNT} iframes to connect ` +
      `(timeout: ${CONNECT_TIMEOUT_MS / 1000}s) …`,
    );

    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    let disconnectedIndices: number[] = [];
    let lastProgressLog = Date.now();

    while (Date.now() < deadline) {
      const results = await Promise.all(
        targetFrames.map(async (frame, idx) => ({
          idx,
          state: await getFrameWsState(frame),
        })),
      );

      disconnectedIndices = results
        .filter((r) => r.state !== "connected")
        .map((r) => r.idx);

      if (disconnectedIndices.length === 0) break;

      // Print progress every ~5 s
      if (Date.now() - lastProgressLog >= 5_000) {
        const stateGroups: Record<string, number> = {};
        for (const r of results) {
          if (r.state !== "connected")
            stateGroups[r.state] = (stateGroups[r.state] ?? 0) + 1;
        }
        const summary = Object.entries(stateGroups)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ");
        console.log(
          `[scalability] ${CLIENT_COUNT - disconnectedIndices.length}/${CLIENT_COUNT} connected. ` +
          `Still waiting — ${summary}`,
        );
        lastProgressLog = Date.now();
      }

      await page.waitForTimeout(1_000);
    }

    // ── Report any persistent failures ────────────────────────────────────────
    if (disconnectedIndices.length > 0) {
      const finalResults = await Promise.all(
        targetFrames.map(async (frame, idx) => ({
          idx,
          state: await getFrameWsState(frame),
        })),
      );
      const notConnected = finalResults.filter((r) => r.state !== "connected");
      console.log(
        `\n[scalability] FAILED — ${notConnected.length}/${CLIENT_COUNT} iframes NOT connected:`,
      );
      for (const { idx, state } of notConnected) {
        console.log(`  iframe-${idx}: state="${state}"`);
      }
    } else {
      console.log(`[scalability] ✓ All ${CLIENT_COUNT} iframes connected.`);
    }

    expect(
      disconnectedIndices.length,
      `Expected 0 disconnected iframes, got ${disconnectedIndices.length}/${CLIENT_COUNT}. ` +
      `See console output above for details.`,
    ).toBe(0);
  });
});
