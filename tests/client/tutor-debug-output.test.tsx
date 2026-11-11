import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DebugOutput } from "@/components/features/debug-output";
import { filterDebugMessages, formatDebugMessages } from "@/lib/debug-messages";
import type { DebugMessage } from "@/hooks/use-debug-console";

const traceId = "11111111-1111-4111-8111-111111111111";
const messages: DebugMessage[] = Array.from({ length: 180 }, (_, index) => ({
  id: String(index), timestamp: new Date("2026-11-11T10:00:00Z"), sender: "server", protocol: "http", type: "tutor.parsing", category: "tutor", content: "<img src=x onerror=alert(1)>PRIVATE_RAW",
  details: { version: 1, traceId, requestId: traceId, sequence: index + 1, timestamp: "2026-11-11T10:00:00.000Z", operation: "question", origin: "provider", stage: "parsing", outcome: "not-provided", reason: "not-provided" },
}));

it("filters and copies all matching Tutor entries while disclosing the smaller visible window", () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
  function Harness() {
    const [filter, setFilter] = useState("");
    const [view, setView] = useState<"table" | "tiles">("table");
    return <DebugOutput debugMessages={messages} debugMessageFilter={filter} setDebugMessageFilter={setFilter} debugViewMode={view} setDebugViewMode={setView} debugMessagesContainerRef={{ current: null }} onCopyDebugMessages={() => void navigator.clipboard.writeText(formatDebugMessages(filterDebugMessages(messages, filter)))} onClearDebugMessages={() => {}} />;
  }
  const result = render(<Harness />);
  expect(screen.getByText(/100 of 180/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "tutor" } });
  fireEvent.change(screen.getByLabelText("Search debug messages"), { target: { value: traceId } });
  fireEvent.click(screen.getByLabelText("Copy debug messages"));
  expect(write.mock.calls[0][0].split("\n")).toHaveLength(180);
  expect(write.mock.calls[0][0]).toContain('"reason":"not-provided"');
  expect(write.mock.calls[0][0]).not.toContain("PRIVATE_RAW");
  expect(result.container.querySelector("img")).toBeNull();
  expect(screen.getAllByText("Details")[0].closest("summary")).not.toBeNull();
  fireEvent.click(screen.getByLabelText("Switch to tiles view"));
  expect(screen.getByText(/50 of 180/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search debug messages"), { target: { value: "no-match" } });
  expect(screen.getByText("No messages match filter")).toBeInTheDocument();
});
