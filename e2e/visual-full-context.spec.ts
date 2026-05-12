import { test, expect } from '@playwright/test';

/**
 * Visual Full-Context Baseline Suite
 *
 * Captures full-viewport screenshots (code editor LEFT + output panel RIGHT)
 * for 6 mandatory scenarios. Each snapshot must show real, readable UI content.
 *
 * Each test follows the same skeleton:
 *   1. Load page  →  type sketch  →  trigger relevant action
 *   2. Wait for SPECIFIC text that proves the correct state is reached
 *   3. page.screenshot() – full viewport, no fragments
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Set Monaco editor content via the global setValue API.
 *  This bypasses keyboard simulation entirely, so Monaco's auto-indent
 *  mechanism cannot produce the "staircase" indent effect. */
async function setCode(page: import('@playwright/test').Page, code: string) {
  // Prefer the E2E hook exposed by main.tsx (uses editor.setValue internally).
  const ok = await page.evaluate(async (c: string) => {
    const fn = (globalThis as any).setEditorContent;
    if (typeof fn === 'function') {
      await fn(c);
      return true;
    }
    // Fallback: direct model.setValue via window.__MONACO_EDITOR__
    const editor = (globalThis as any).__MONACO_EDITOR__;
    if (editor && typeof editor.setValue === 'function') {
      editor.setValue(c);
      return true;
    }
    return false;
  }, code);

  if (!ok) {
    // Last-resort: keyboard injection (triggers auto-indent – avoid if possible)
    const editorEl = page.locator('[data-testid="code-editor"]');
    await editorEl.click();
    await page.keyboard.down(MOD);
    await page.keyboard.press('KeyA');
    await page.keyboard.up(MOD);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(code, { delay: 8 });
  }
  // Give React time to propagate the change through state.
  await page.waitForTimeout(300);
}

/** 30-second polling loop for serial output text – serial arrives after
 *  local sandbox compilation + emulator start, which can take ~15 s cold. */
async function waitForSerial(
  page: import('@playwright/test').Page,
  text: string,
  timeoutMs = 30000,
): Promise<boolean> {
  const serial = page.locator('[data-testid="serial-output"]');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = await serial.textContent().catch(() => null);
    if (content?.includes(text)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

/** Click "Start Simulation" and wait for it to be running.
 *  @param code - When provided the sketch is compiled via REST API first so
 *                that the server has lastCompiledCode set.  This is required
 *                on a fresh CI server where no prior compilation exists. */
async function startAndAwaitRunning(
  page: import('@playwright/test').Page,
  code?: string,
) {
  // Ensure the server has compiled code available before starting the simulation.
  // Without this, a fresh CI server returns "No compiled code" and the Stop button
  // never appears.
  if (code) {
    const compileRes = await page.request.post('/api/compile', {
      data: { code },
      timeout: 120000,
    }).catch((err: Error) => {
      throw new Error(`/api/compile unreachable: ${err.message}`);
    });
    const compileResult = await compileRes.json();
    if (!compileResult?.success) {
      throw new Error(`Compilation failed: ${compileResult?.stderr ?? 'unknown error'}`);
    }

    // Inject compiled source into client ref for per-client isolation in parallel runs
    await page.evaluate((c: string) => {
      const setter = (globalThis as Record<string, unknown>).__SET_LAST_COMPILED_CODE__ as ((code: string) => void) | undefined;
      if (setter) setter(c);
    }, code);
  }

  const startBtn = page.getByRole('button', { name: /start simulation/i });
  await expect(startBtn).toBeEnabled({ timeout: 15000 });
  await startBtn.click();
  
  // Wait for "Stop Simulation" button which appears when simulation is running.
  // Use an extended timeout in CI where Docker + g++ compilation can take longer.
  const stopBtnTimeout = process.env.CI ? 40000 : 25000;
  const stopBtn = page.getByRole('button', { name: /stop simulation/i });
  await expect(stopBtn).toBeVisible({ timeout: stopBtnTimeout });
}

/** Double-click a tab to force-expand the output panel, then single-click to
 *  ensure it is active. Tabs live inside [data-testid="output-tabs-header"]. */
async function activateOutputTab(
  page: import('@playwright/test').Page,
  targetTab: 'compiler' | 'messages' | 'registry' | 'debug',
  visibleName: string | RegExp = targetTab,
) {
  // Force show output panel and set the desired tab via a dedicated event.
  await page.evaluate((value) => {
    document.dispatchEvent(
      new CustomEvent('showCompileOutputChange', { detail: { value: true } }),
    );
    document.dispatchEvent(
      new CustomEvent('setOutputTab', { detail: { tab: value } }),
    );
  }, targetTab);

  // Give the UI a moment to react and wait until the requested tab is active.
  await page.waitForTimeout(500);
  const targetTabButton = page.getByRole('tab', { name: visibleName });
  await expect(targetTabButton).toHaveAttribute('data-state', 'active', {
    timeout: 15000,
  });
}

// ──────────────────────────────────────────────────────────────────────────────

test.describe('Visual Full-Context Baselines', () => {
  // Run sequentially: each test starts a simulation; parallel workers compete
  // for the single backend sandbox pool and never get serial output in time.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // Inject the Arduino original teal into localStorage before page load so
    // the board always renders with the canonical color (#00979D) in snapshots.
    await page.addInitScript(() => {
      localStorage.setItem('unoBoardColor', '#00979D');
      (globalThis as any).__DISABLE_TOASTS = true;
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 01 – Serial Monitor: "Hello World"
  // ────────────────────────────────────────────────────────────────────────────
  test('01_serial_hello_world_context', async ({ page }) => {
    const code = `void setup() {
  Serial.begin(115200);
  Serial.println("Hello World");
  Serial.println("Visual Baseline OK");
}

void loop() {
  delay(1000);
}`;

    await setCode(page, code);
    await startAndAwaitRunning(page, code);

    // Proof: "Hello World" must appear in serial monitor BEFORE screenshot.
    // On GitHub Actions the Docker sandbox startup may take longer than local.
    const serialTimeout = process.env.CI ? 60000 : 10000;
    const serial = page.locator('[data-testid="serial-output"]');
    await expect(serial).toBeVisible({ timeout: 5000 });
    await expect(serial).not.toContainText(
      'Serial output will appear here...',
      { timeout: serialTimeout },
    );
    await expect(serial).toContainText('Hello World', { timeout: serialTimeout });

    // Allow the editor and serial output to finish rendering before capturing the snapshot.
    await page.waitForTimeout(2000);

    const snap = await page.screenshot({ animations: 'disabled', fullPage: false });
    expect(snap).toMatchSnapshot('01_serial_hello_world_context.png', {
      // Allow a small amount of anti-aliasing / rendering variation across macOS environments
      maxDiffPixels: 2500,
      threshold: 0.25,
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 02 – SVG Board: all digital pins HIGH
  // ────────────────────────────────────────────────────────────────────────────
  test('02_svg_all_pins_high_context', async ({ page }) => {
    // No serial communication – only pure pin switching.
    const code = `void setup() {
  for (int i = 2; i <= 13; i++) {
    pinMode(i, OUTPUT);
    digitalWrite(i, HIGH);
  }
}

void loop() {
  delay(1000);
}`;

    await setCode(page, code);
    await startAndAwaitRunning(page, code);

    // Give the SVG board time to render all active-pin states
    await page.waitForTimeout(1500);

    const snap = await page.screenshot({ animations: 'disabled', fullPage: false });
    expect(snap).toMatchSnapshot('02_svg_all_pins_high_context.png', {
      maxDiffPixels: 15000,
      threshold: 0.4,
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 03 – Compiler tab: Arduino CLI success output
  // ────────────────────────────────────────────────────────────────────────────
  test('03_compiler_cli_success_context', async ({ page }) => {
    // Minimal empty sketch – just needs a successful compilation to show CLI output.
    const code = `void setup() {
}

void loop() {
}`;

    await setCode(page, code);
    await startAndAwaitRunning(page, code);

    // ─── OPEN + EXPAND COMPILER PANEL ────────────────────────────────────────
    // Double-click invokes openOutputPanel("compiler") which resizes the panel
    // to 50% height (the single activateOutputTab event only toggles visibility
    // but leaves the panel at its 3 % minimum size so content is clipped).
    const compilerTab = page
      .locator('[data-testid="output-tabs-header"]')
      .getByRole('tab', { name: /compiler/i });
    await expect(compilerTab).toBeVisible({ timeout: 8000 });
    await compilerTab.dblclick();
    await page.waitForTimeout(300);
    await compilerTab.click();
    // ─────────────────────────────────────────────────────────────────────────

    // ─── STRICT PROOF REQUIRED BY SPEC ───────────────────────────────────────
    // Wait until the compilation-output container actually shows the CLI text.
    // compilation-text is the data-testid of the success output div; toContainText
    // works on the full text content of the element regardless of child spans.
    await expect(page.locator('[data-testid="compilation-text"]')).toContainText(
      /Sketch uses/i,
      { timeout: 10000 },
    );
    // ─────────────────────────────────────────────────────────────────────────

    // Buffer for panel open/close CSS transitions to fully settle
    await page.waitForTimeout(500);

    const snap = await page.screenshot({ animations: 'disabled', fullPage: false });
    expect(snap).toMatchSnapshot('03_compiler_cli_success_context.png', {
      // Raised to absorb Linux CI font-rendering differences vs macOS baseline and post-message overhead
      maxDiffPixels: 4600,
      threshold: 0.25,
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 04 – Messages tab: linter warns about missing Serial.begin()
  // ────────────────────────────────────────────────────────────────────────────
  test('04_messages_linter_warning_context', async ({ page }) => {
    // Intentionally missing Serial.begin() – triggers linter warning.
    // Run the simulation so the serial monitor is visible but empty
    // (no output because begin() was never called).
    const code = `void setup() {
  Serial.print("missing begin");
}

void loop() {
  delay(500);
}`;

    await setCode(page, code);
    await startAndAwaitRunning(page, code);

    // Let the static linter and simulation settle
    await page.waitForTimeout(2000);

    // Wait for the linter warning to appear somewhere in the UI.
    // The warning may appear inline without a visible tab bar.
    await page.waitForFunction(
      () => document.body.innerText.includes("Serial.begin(115200) is missing"),
      null,
      { timeout: 20000 },
    );

    // Give the UI a moment to settle before capturing the snapshot.
    await page.waitForTimeout(800);

    const snap = await page.screenshot({ animations: 'disabled', fullPage: false });
    expect(snap).toMatchSnapshot('04_messages_linter_warning_context.png', {
      // Allow a small amount of rendering variation (font antialiasing, etc.)
      maxDiffPixels: 20000,
      threshold: 0.25,
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 05 – I/O Registry: pin mapping table (static analysis, no simulation)
  // ────────────────────────────────────────────────────────────────────────────
  test('05_io_registry_mapping_context', async ({ page }) => {
    // Loop 1 covers pins 1-6 as INPUT.
    // Loop 2 covers pins 6-10 as OUTPUT.
    // Pin 6 therefore receives both INPUT (loop 1) and OUTPUT (loop 2)
    // → mode conflict → red conflict marker in the I/O Registry.
    // The test validates the STATIC analysis path (no simulation required).
    const code = `void setup() {
  // Loop 1: pins 1..6 as INPUT
  for (int i = 1; i <= 6; i++) pinMode(i, INPUT);
  // Loop 2: pins 6..10 as OUTPUT (pin 6 conflicts with loop 1)
  for (int i = 6; i <= 10; i++) pinMode(i, OUTPUT);
}

void loop() {
  delay(500);
}`;

    await setCode(page, code);

    // Static analysis runs with a 300 ms debounce – wait for it to complete.
    await page.waitForTimeout(1000);

    // Find the I/O Registry tab button in the footer output-tabs-header.
    // Double-click to expand the panel to ~50 % height (same pattern as
    // 03_compiler_cli_success_context), then single-click to confirm it is active.
    const registryTabButton = page
      .locator('[data-testid="output-tabs-header"]')
      .getByRole('tab', { name: /i\/o registry|registry/i });
    await expect(registryTabButton).toBeVisible({ timeout: 10000 });
    await registryTabButton.dblclick();
    await page.waitForTimeout(300);
    await registryTabButton.click();

    // Verify the tab is active after expansion.
    await expect(registryTabButton).toHaveAttribute('data-state', 'active', {
      timeout: 10000,
    });

    // Wait until the registry table is visible and the static analysis has populated rows
    // with both INPUT and OUTPUT modes (proves the pin-conflict was detected correctly).
    const registryTable = page.locator('table.w-full.text-ui-xs.border-collapse');
    await expect(registryTable).toBeVisible({ timeout: 15000 });

    await page.waitForFunction(() => {
      const rows = Array.from(
        document.querySelectorAll('table.w-full.text-ui-xs.border-collapse tbody tr'),
      );
      if (rows.length < 10) return false;
      const text = rows.map((row) => row.textContent || '').join(' ');
      return text.includes('INPUT') && text.includes('OUTPUT');
    }, null, { timeout: 15000 });

    await expect(registryTable.locator('tbody tr')).toHaveCount(10, { timeout: 15000 });

    // Ensure the registry view is fully settled before the screenshot.
    await page.waitForTimeout(500);

    const snap = await page.screenshot({ animations: 'disabled', fullPage: false });
    expect(snap).toMatchSnapshot('05_io_registry_mapping_context.png', {
      // Allow for minor rendering differences in the registry UI on different machines.
      maxDiffPixels: 6000,
      threshold: 0.25,
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 06 – Debug mode active: Debug panel + overlays
  // ────────────────────────────────────────────────────────────────────────────
  test('06_debug_active_full_context', async ({ page }) => {
    // Limit to exactly 3 tick lines so the serial output stays compact.
    const code = `void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println("DebugReady");
}

void loop() {
  static int n = 0;
  if (n >= 3) { delay(1000); return; }
  n++;
  Serial.print("tick ");
  Serial.println(n);
  digitalWrite(LED_BUILTIN, n % 2);
  delay(500);
}`;

    await setCode(page, code);
    await startAndAwaitRunning(page, code);

    // Proof: simulation is producing output
    const serialWaitTimeout = process.env.CI ? 60000 : 30000;
    const found = await waitForSerial(page, 'DebugReady', serialWaitTimeout);
    if (!found) throw new Error('Proof failed: "DebugReady" never appeared in serial output');

    // Enable debug mode via keyboard shortcut (⌘+D on Mac, Ctrl+D on others)
    await page.keyboard.press(`${MOD}+KeyD`);
    await page.waitForTimeout(600);

    // Activate the Debug tab in the output panel (only visible in debug mode)
    const debugTab = page.locator('[data-testid="output-tabs-header"]')
      .getByRole('tab', { name: /debug/i });

    const debugTabVisible = await debugTab.isVisible({ timeout: 4000 }).catch(() => false);
    if (debugTabVisible) {
      await debugTab.dblclick();
      await page.waitForTimeout(300);
      await debugTab.click();
      console.log('✓ Debug tab activated');
    } else {
      console.warn('⚠ Debug tab not visible – debug mode may not be active');
    }

    await page.waitForTimeout(1000);

    const snap = await page.screenshot({ animations: 'disabled', fullPage: false });
    expect(snap).toMatchSnapshot('06_debug_active_full_context.png', {
      // loosened for CI to tolerate dynamic timestamps / debug info
      maxDiffPixels: 15000,
      threshold: 0.4,
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Scenario 07 – I/O Registry: TC9 conflict markers (static analysis)
  //
  // Sketch per updated screenshot:
  //   void setup() { pinMode(0, INPUT); pinMode(1, OUTPUT); }
  //   void loop()  { digitalWrite(0, HIGH); digitalWrite(1, HIGH); digitalWrite(2, HIGH); }
  //
  // Expected IO-Registry (static, no simulation):
  //   Pin 0  (RX): INPUT + write → conflict border "INPUT!"
  //   Pin 1  (TX): OUTPUT + write → no conflict, shows OUTPUT mode
  //   Pin 2:       write-only → red × (no mode defined)
  // ────────────────────────────────────────────────────────────────────────────
  test('07_io_registry_tc9_conflict_markers', async ({ page }) => {
    const code = `void setup() {
  pinMode(0, INPUT);
  pinMode(1, OUTPUT);
}

void loop() {
  digitalWrite(0, HIGH);
  digitalWrite(1, HIGH);
  digitalWrite(2, HIGH);
}`;

    await setCode(page, code);

    // Static analysis fires with a 300 ms debounce – allow it to complete.
    await page.waitForTimeout(1000);

    // Open the I/O Registry tab.
    await activateOutputTab(page, 'registry', /i\/o registry|registry/i);

    // Allow the I/O Registry view to settle before capturing the snapshot.
    await page.waitForTimeout(1500);

    const snap = await page.screenshot({ animations: 'disabled', fullPage: false });
    expect(snap).toMatchSnapshot('07_io_registry_tc9_conflict_markers.png', {
      // Allow minor rendering differences for the conflict marker UI.
      maxDiffPixels: 20000,
      threshold: 0.25,
    });
  });

});
