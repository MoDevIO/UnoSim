import { describe, expect, it } from "vitest";
import { ProcessController, MAX_PENDING_STDIN_BYTES } from "../../../server/services/process-controller";

describe("ProcessController stdin bound", () => {
  it("refuses input once a child that does not read stdin has a full backlog", async () => {
    const controller = new ProcessController();
    const child = await controller.spawn("node", ["-e", "setTimeout(() => {}, 3000)"]);
    const chunk = "x".repeat(64 * 1024);

    let refused = 0;
    for (let i = 0; i < 64; i += 1) {
      if (!controller.writeStdin(chunk)) refused += 1;
    }

    expect(refused).toBeGreaterThan(0);
    expect(child?.stdin?.writableLength ?? 0).toBeLessThanOrEqual(MAX_PENDING_STDIN_BYTES + chunk.length);
    controller.kill("SIGKILL");
  });
});
