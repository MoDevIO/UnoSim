import { describe, expect, it } from "vitest";
import type { UmlCodeContext } from "@shared/tutor-uml";
import { activityErrorNote, activityExcerptProposal } from "../../../../../server/services/tutor/uml/excerpt";
import { exportTutorUml } from "../../../../../server/services/tutor/uml/export";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";
import { TEMPERATURE_CONTROLLER } from "../support/aspect-fixtures";

function context(code: string): UmlCodeContext {
  return { question: "Welcher Zweig läuft?", code, entryFile: "sketch.ino", board: "uno" };
}

function sketch(body: string): string {
  return `void setup() {}\nvoid loop() {\n${body}\n}`;
}

function valid(code: string, site: string) {
  const proposal = activityExcerptProposal(context(code), site);
  const checked = validateTutorUmlProposal(proposal, context(code));
  if (!proposal || !checked.ok || checked.proposal.status !== "diagram") throw new Error(`no valid excerpt for ${site}`);
  return { proposal, source: exportTutorUml(checked.proposal) };
}

describe("activity excerpt built from the code", () => {
  it("shows the else-if chain of the temperature controller within the element limit", () => {
    const { proposal } = valid(TEMPERATURE_CONTROLLER, "(temperature < TEMP_MIN)");
    const [first] = proposal.body;
    expect(proposal.body).toHaveLength(1);
    expect(first).toMatchObject({ type: "decision", condition: "temperature < TEMP_MIN" });
    if (first.type !== "decision") throw new Error("decision expected");
    expect(first.whenTrue).toHaveLength(1);
    expect(first.whenFalse).toMatchObject([{ type: "decision", condition: "temperature > TEMP_MAX" }]);
  });

  it("rejoins a branch with an early return in a merge and ends the excerpt once", () => {
    const { proposal, source } = valid(TEMPERATURE_CONTROLLER, "(raw == 0)");
    const [first] = proposal.body;
    if (first.type !== "decision") throw new Error("decision expected");
    expect(first.whenFalse).toEqual([]);
    expect(first.whenTrue.at(-1)).toMatchObject({ type: "action" });
    const lines = source.split("\n");
    expect(lines.filter((line) => line === "stop")).toHaveLength(1);
    expect(lines.at(-2)).toBe("stop");
    expect(lines[lines.findIndex((line) => line.includes("return")) + 1]).toBe("case ([sonst])");
  });

  it("unfolds a for loop into its start, its condition and its step", () => {
    const { proposal } = valid(sketch("  for (int i = 0; i < 3; i++) { Serial.println(i); }"), "i < 3");
    expect(proposal.body).toMatchObject([
      { type: "action", code: "int i = 0;" },
      { type: "loop", condition: "i < 3", body: [{ type: "action", code: "Serial.println(i);" }, { type: "action", code: "i++;" }] },
    ]);
  });

  it("takes a branch without braces", () => {
    const { proposal } = valid(sketch("  int x = analogRead(A0);\n  if (x > 500) digitalWrite(13, HIGH); else digitalWrite(13, LOW);"), "(x > 500)");
    expect(proposal.body).toMatchObject([{ type: "decision", whenTrue: [{ code: "digitalWrite(13, HIGH);" }], whenFalse: [{ code: "digitalWrite(13, LOW);" }] }]);
  });

  it.each([
    ["a break", "  while (digitalRead(2) == LOW) { delay(10); break; }", "digitalRead(2) == LOW"],
    ["a switch", "  int x = 1;\n  if (x > 0) { switch (x) { case 1: delay(1); } }", "(x > 0)"],
    ["code after a return", "  int x = 1;\n  if (x > 0) { return; delay(1); }", "(x > 0)"],
    ["an empty loop body", "  while (digitalRead(2) == LOW) {}", "digitalRead(2) == LOW"],
  ])("builds nothing for %s", (_name, body, site) => {
    expect(activityExcerptProposal(context(sketch(body)), site)).toBeUndefined();
  });

  it("builds nothing when the sketch has no statement with that head", () => {
    expect(activityExcerptProposal(context(TEMPERATURE_CONTROLLER), "(humidity > 80)")).toBeUndefined();
  });

  it("rejects an excerpt that differs from what the application builds", () => {
    const proposal = activityExcerptProposal(context(TEMPERATURE_CONTROLLER), "(raw == 0)");
    if (!proposal) throw new Error("proposal expected");
    const [first] = proposal.body;
    if (first.type !== "decision") throw new Error("decision expected");
    const tampered = { ...proposal, body: [{ ...first, whenTrue: first.whenTrue.slice(0, -1) }] };
    const shortened = { ...proposal, body: [{ ...first, condition: "raw == 1" }] };
    expect(validateTutorUmlProposal(tampered, context(TEMPERATURE_CONTROLLER))).toEqual({ ok: false, reason: "invalid-evidence" });
    expect(validateTutorUmlProposal(shortened, context(TEMPERATURE_CONTROLLER))).toEqual({ ok: false, reason: "invalid-evidence" });
  });

  describe("with one deliberate error", () => {
    it("reverses the first ordered comparison and says so for the rating", () => {
      const proposal = activityExcerptProposal(context(TEMPERATURE_CONTROLLER), "(temperature < TEMP_MIN)", true);
      expect(proposal?.excerpt).toBe("statement-with-error");
      expect(proposal?.body).toMatchObject([{ type: "decision", condition: "temperature > TEMP_MIN" }]);
      expect(activityErrorNote(TEMPERATURE_CONTROLLER, "(temperature < TEMP_MIN)")).toBe("Im Code lautet die Bedingung `temperature < TEMP_MIN`, im Diagramm steht `temperature > TEMP_MIN`.");
      const checked = validateTutorUmlProposal(proposal, context(TEMPERATURE_CONTROLLER));
      expect(checked.ok).toBe(true);
      if (checked.ok && checked.proposal.status === "diagram") expect(exportTutorUml(checked.proposal)).toContain("title Ausschnitt mit einem eingebauten Fehler");
    });

    it("lets the branches change places when no comparison is ordered", () => {
      const proposal = activityExcerptProposal(context(TEMPERATURE_CONTROLLER), "(raw == 0)", true);
      const [first] = proposal?.body ?? [];
      if (first?.type !== "decision") throw new Error("decision expected");
      expect([first.whenTrue.length, first.whenFalse.length]).toEqual([0, 1]);
      expect(activityErrorNote(TEMPERATURE_CONTROLLER, "(raw == 0)")).toContain("vertauscht");
    });

    it("is the same on every call and differs from the correct diagram", () => {
      const once = activityExcerptProposal(context(TEMPERATURE_CONTROLLER), "(temperature < TEMP_MIN)", true);
      expect(activityExcerptProposal(context(TEMPERATURE_CONTROLLER), "(temperature < TEMP_MIN)", true)).toEqual(once);
      expect(once?.body).not.toEqual(activityExcerptProposal(context(TEMPERATURE_CONTROLLER), "(temperature < TEMP_MIN)")?.body);
    });

    it("rejects the correct diagram under the error variant and any other error", () => {
      const correct = activityExcerptProposal(context(TEMPERATURE_CONTROLLER), "(temperature < TEMP_MIN)");
      const mislabeled = { ...correct, excerpt: "statement-with-error" };
      expect(validateTutorUmlProposal(mislabeled, context(TEMPERATURE_CONTROLLER))).toEqual({ ok: false, reason: "invalid-evidence" });
    });

    it("has no error to build where nothing can change", () => {
      const code = sketch("  while (digitalRead(2)) { delay(10); }");
      expect(activityExcerptProposal(context(code), "digitalRead(2)", true)).toBeUndefined();
      expect(activityErrorNote(code, "digitalRead(2)")).toBeUndefined();
    });
  });
});
