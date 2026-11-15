import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { TutorUmlRenderer } from "../../../../../server/services/tutor/uml/renderer";
const source = () => readFile("docs/examples/tutor-uml/activity.puml", "utf8");

it("renders with the real pinned runtime and checked output", async () => {
  const image = await new TutorUmlRenderer().render(await source(), "activity");
  expect(image.svg).toContain("digitalWrite(LED, HIGH)");
  expect(image.rendererRevision).toContain("smetana");
  expect(image.svg).not.toContain("SRC=");
});
it("reaps a real process before reporting cancellation", async () => {
  const renderer = new TutorUmlRenderer();
  const controller = new AbortController();
  const pending = renderer.render(
    await source(),
    "activity",
    controller.signal,
  );
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    clearTimeout(timer);
  }
  expect(renderer.activity).toEqual({ active: 0, queued: 0 });
});
it("reports a fixed timeout without exposing process stderr", async () => {
  const renderer = new TutorUmlRenderer({ timeoutMs: 30 });
  await expect(
    renderer.render(await source(), "activity"),
  ).rejects.toMatchObject({ kind: "renderer-timeout" });
  expect(renderer.activity.active).toBe(0);
});
it("removes an aborted waiting request without starting a third process", async () => {
  const renderer = new TutorUmlRenderer({ active: 1, queued: 1 });
  const text = await source();
  const first = renderer.render(text, "activity");
  const controller = new AbortController();
  const second = renderer.render(text, "activity", controller.signal);
  controller.abort();
  await expect(second).rejects.toMatchObject({ name: "AbortError" });
  await first;
  expect(renderer.activity).toEqual({ active: 0, queued: 0 });
});
it("rejects excess queued work and keeps the accepted request usable", async () => {
  const renderer = new TutorUmlRenderer({ active: 1, queued: 0 });
  const text = await source();
  const first = renderer.render(text, "activity");
  await expect(renderer.render(text, "activity")).rejects.toMatchObject({
    kind: "render-queue-limit",
  });
  await first;
});
it("treats a missing runtime as a fixed optional feature failure", async () => {
  const renderer = new TutorUmlRenderer({
    runtimeDirectory: "/private/tmp/unosim-no-runtime-7b8d",
  });
  await expect(
    renderer.render(await source(), "activity"),
  ).rejects.toMatchObject({ kind: "renderer-unavailable" });
});
