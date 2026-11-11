import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TUTOR_REVIEW_LIMITS } from "@shared/tutor-review";
import { Toaster } from "@/components/ui/toaster";
import { TutorReviewPanel } from "@/components/features/tutor-review-panel";
import {
  beginTutorReviewRequest, clearTutorReviewRuns, completeTutorReviewStep, receiveTutorReviewResponse, tutorReviewRuns,
} from "@/lib/tutor-review-store";

/** The Tutor review panel (LearningQuestions 12.7): plain text only, honest copy results. */
beforeEach(() => {
  clearTutorReviewRuns();
  const handle = beginTutorReviewRequest({
    traceId: crypto.randomUUID(), requestId: crypto.randomUUID(), endpoint: "question",
    body: JSON.stringify({ code: "void setup() {}\nvoid loop() {}", credential: "sk-PANEL-KEY-0123456789" }),
  });
  receiveTutorReviewResponse(handle, { ok: true, body: { question: "<img src=x onerror=alert(1)>Welche Funktion?", responseStyle: "normal", model: "m" }, review: undefined, serverAvailable: false });
  completeTutorReviewStep(handle);
});
afterEach(() => { vi.unstubAllGlobals(); });

it("reports a failed clipboard write as failure, never as success", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
  render(<><TutorReviewPanel /><Toaster /></>);
  fireEvent.click(screen.getByRole("button", { name: "Copy Tutor review" }));
  await waitFor(() => expect(screen.getByText("Copy failed")).toBeTruthy());
  expect(screen.queryByText("Tutor review copied")).toBeNull();
});

it("shows step texts as inert text, the export size, and an honest completeness note", async () => {
  const { container } = render(<TutorReviewPanel />);
  expect(screen.getByTestId("tutor-review-summary").textContent).toContain("incomplete: server-review-unavailable");
  // The step list is collapsed by default; the first summary toggles it, the next one opens the step.
  const summary = container.querySelectorAll("summary")[1];
  (summary.parentElement as HTMLDetailsElement).open = true;
  fireEvent(summary.parentElement!, new Event("toggle"));
  expect(screen.getByTestId("tutor-review-step-text").textContent).toContain("<img src=x onerror=alert(1)>Welche Funktion?");
  expect(container.querySelector("img")).toBeNull();
  await waitFor(() => expect(screen.getByTestId("tutor-review-size").textContent).toMatch(/^\d+\.\d KiB$/));
});

it("updates an open step's text when its response arrives", async () => {
  const handle = beginTutorReviewRequest({
    traceId: crypto.randomUUID(), requestId: crypto.randomUUID(), endpoint: "question",
    body: JSON.stringify({ code: "void loop() {}" }),
  });
  const { container } = render(<TutorReviewPanel />);
  const summaries = container.querySelectorAll("summary");
  const running = summaries.item(summaries.length - 1).parentElement as HTMLDetailsElement;
  running.open = true;
  fireEvent(running, new Event("toggle"));
  const text = () => screen.getAllByTestId("tutor-review-step-text").at(-1)!.textContent;
  expect(text()).toContain("offen (noch keine Antwort)");
  act(() => {
    receiveTutorReviewResponse(handle, { ok: true, body: { question: "Jetzt beantwortet?", responseStyle: "normal", model: "m" }, review: undefined, serverAvailable: false });
    completeTutorReviewStep(handle);
  });
  await waitFor(() => expect(text()).toContain("Jetzt beantwortet?"));
  expect(text()).toContain("abgeschlossen");
});

it("keeps the Debug tab working when the export cannot be built", async () => {
  const run = tutorReviewRuns().at(-1)!;
  run.contexts.push({ contextId: crypto.randomUUID(), code: "x".repeat(TUTOR_REVIEW_LIMITS.runBytes), headers: [] });
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<><TutorReviewPanel /><Toaster /></>);
  await waitFor(() => expect(screen.getByTestId("tutor-review-size").textContent).toBe("export above the size limit"));
  fireEvent.click(screen.getByRole("button", { name: "Copy Tutor review" }));
  await waitFor(() => expect(screen.getByText("Copy failed")).toBeTruthy());
  expect(writeText).not.toHaveBeenCalled();
});
