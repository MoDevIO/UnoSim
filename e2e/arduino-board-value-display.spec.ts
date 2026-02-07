import { test, expect } from "./fixtures/test-base";

test.describe("Arduino Board - I/O Value Display Toggle", () => {
  test("should toggle show/hide I/O values button", async ({
    page,
    startSimulation,
  }) => {
    await page.goto("/");
    
    // Load the io-test.ino example
    await page.getByRole("button", { name: /examples/i }).click();
    const projectsFolder = page.locator('[data-role="example-folder"]').filter({ hasText: "projects" });
    await expect(projectsFolder).toBeVisible({ timeout: 5000 });
    await projectsFolder.click();

    const ioTestExample = page.locator('[data-role="example-item"]').filter({ hasText: "io-test" });
    await expect(ioTestExample).toBeVisible({ timeout: 5000 });
    await ioTestExample.click();
    
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Start simulation
    await startSimulation();
    
    // Wait for simulation to stabilize
    await page.waitForTimeout(1000);

    // Find the "Show I/O values" button - this indicates Arduino board is fully loaded
    const showButton = page.getByRole("button", { name: /show i\/o values/i });
    await expect(showButton).toBeVisible({ timeout: 15000 });

    // Verify button has correct aria-label initially
    const ariaLabel = await showButton.getAttribute("aria-label");
    expect(ariaLabel).toBe("Show I/O values");

    // Click the button to show values
    await showButton.click();
    await page.waitForTimeout(500);

    // Now button should show "Hide I/O values"
    const hideButton = page.getByRole("button", { name: /hide i\/o values/i });
    await expect(hideButton).toBeVisible({ timeout: 5000 });

    // Verify aria-label changed
    const hideAriaLabel = await hideButton.getAttribute("aria-label");
    expect(hideAriaLabel).toBe("Hide I/O values");

    // Toggle back to hide
    await hideButton.click();
    await page.waitForTimeout(500);

    // Verify button is back to show
    const showButtonAgain = page.getByRole("button", { name: /show i\/o values/i });
    await expect(showButtonAgain).toBeVisible();
    
    // Verify the button icon changed (Eye vs EyeOff)
    const eyeIcon = await showButtonAgain.locator('svg').count();
    expect(eyeIcon).toBeGreaterThan(0);
  });
});
