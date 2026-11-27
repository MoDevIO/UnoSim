import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { TutorUmlRenderer } from "../../../../../server/services/tutor/uml/renderer";
import { activityExcerptProposal } from "../../../../../server/services/tutor/uml/excerpt";
import { exportTutorUml } from "../../../../../server/services/tutor/uml/export";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";

/** The excerpt of `site` as the application delivers it: built, then checked against the code. */
function checkedExcerpt(code: string, site: string) {
  const context = { question: "Wie läuft es?", code, entryFile: "sketch.ino", board: "uno" };
  const checked = validateTutorUmlProposal(activityExcerptProposal(context, site), context);
  if (!checked.ok || checked.proposal.status !== "diagram") throw new Error("valid excerpt expected");
  return checked.proposal;
}
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

// An excerpt's return ends its path in a final node; the regular path leaves through a connector (review6).
it.each([
  ["one branch returns", "  if (digitalRead(2) == LOW) {\n    digitalWrite(8, LOW);\n    return;\n  }", "digitalRead(2) == LOW"],
  ["every branch returns", "  if (digitalRead(2) == LOW) {\n    return;\n  } else {\n    delay(5);\n    return;\n  }", "digitalRead(2) == LOW"],
  ["a loop body returns", "  while (digitalRead(2) == LOW) {\n    if (millis() > 100) {\n      return;\n    }\n  }", "while (digitalRead(2) == LOW)"],
])("renders an excerpt where %s", async (name, body, site) => {
  const code = `void setup() {}\nvoid loop() {\n${body}\n  delay(1);\n}`;
  const image = await new TutorUmlRenderer().render(exportTutorUml(checkedExcerpt(code, site)), "activity");
  // Where every path returns, no path goes on after the excerpt.
  expect(image.svg.includes("weiter nach Zeile")).toBe(name !== "every branch returns");
  expect(image.svg).toContain("return");
}, 30_000);

it("renders a return in loop() leading back to the statement that reads the tested value (review6)", async () => {
  const code = "void setup() {}\nvoid loop() {\n  int button = digitalRead(2);\n  if (button == LOW) {\n    digitalWrite(8, LOW);\n    return;\n  }\n  delay(1);\n}";
  const proposal = checkedExcerpt(code, "button == LOW");
  if (!("enclosing" in proposal) || !proposal.enclosing) throw new Error("excerpt in loop() expected");
  const image = await new TutorUmlRenderer().render(exportTutorUml(proposal), "activity");
  for (const text of ["digitalRead(2)", "Zeile 3", "return;", "weiter nach Zeile 7"]) expect(image.svg).toContain(text);
}, 30_000);
