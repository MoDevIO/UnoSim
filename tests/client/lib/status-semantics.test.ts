import { describe, expect, it } from "vitest";
import {
  getStatusColor,
  getStatusTextClass,
  getHighestSeverityStatus,
  getSeverityStatus,
  type ApplicationStatus,
} from "@/lib/status-semantics";

describe("application status semantics", () => {
  it.each([
    ["success", "text-status-success", "var(--color-status-success)"],
    ["error", "text-status-error", "var(--color-status-error)"],
    ["warning", "text-status-warning", "var(--color-status-warning)"],
    ["info", "text-accent-cyan", "var(--color-accent-cyan)"],
    ["busy", "text-accent-cyan", "var(--color-accent-cyan)"],
    ["idle", "text-muted-foreground", "var(--muted-foreground)"],
    ["unknown", "text-muted-foreground", "var(--muted-foreground)"],
  ] as const)("maps %s to its semantic color", (status, textClass, color) => {
    expect(getStatusTextClass(status as ApplicationStatus)).toBe(textClass);
    expect(getStatusColor(status as ApplicationStatus)).toBe(color);
  });

  it("maps existing parser severities to shared status tones", () => {
    expect(getSeverityStatus(1)).toBe("info");
    expect(getSeverityStatus(2)).toBe("warning");
    expect(getSeverityStatus(3)).toBe("error");
    expect(getSeverityStatus(0)).toBe("unknown");
    expect(getHighestSeverityStatus([])).toBe("idle");
    expect(getHighestSeverityStatus([1, 2])).toBe("warning");
    expect(getHighestSeverityStatus([2, 3])).toBe("error");
  });
});
