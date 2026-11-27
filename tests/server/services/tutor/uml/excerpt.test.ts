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

  it("leads a return in loop() back to the statement that sets the condition, through a merge node (review6)", () => {
    const { proposal, source } = valid(TEMPERATURE_CONTROLLER, "(raw == 0)");
    expect(proposal.enclosing).toEqual({ function: "loop", inputs: [{ type: "action", code: "int raw = analogRead(sensorPin);", ref: { file: "sketch.ino", startLine: 16, endLine: 16 } }] });
    const lines = source.split("\n");
    const start = lines.indexOf("repeat");
    // The merge node, then the statement that reads raw with its line as a note.
    expect(lines.slice(start, start + 3)).toEqual(["repeat", ":int raw <U+003D> analogRead<U+0028>sensorPin<U+0029><U+003B>;", "note right: Zeile 16"]);
    // The branch with its return is the one node on the way back; the decision is the loop's own node.
    expect(lines.find((line) => line.startsWith("backward :"))).toMatch(/return<U\+003B>;$/);
    expect(lines).toContain("repeat while () is ([raw <U+003D><U+003D> 0]) not ([sonst])");
    expect(lines).not.toContain("stop");
    expect(lines.slice(-4)).toEqual(["(A)", `note right: weiter nach Zeile ${proposal.scope.endLine}`, "detach", "@enduml"]);
  });

  it("leads a return back to the decision itself when its condition reads the value itself", () => {
    const code = sketch("  if (digitalRead(2) == LOW) {\n    digitalWrite(8, LOW);\n    return;\n  }\n  delay(1);");
    const { proposal, source } = valid(code, "digitalRead(2) == LOW");
    expect(proposal.enclosing).toEqual({ function: "loop", inputs: [] });
    const lines = source.split("\n");
    // The merge node leads straight to the decision: the next pass reads the pin again there.
    expect(lines[lines.indexOf("repeat") + 1]).toMatch(/^backward :/);
    expect(lines).toContain("repeat while () is ([digitalRead<U+0028>2<U+0029> <U+003D><U+003D> LOW]) not ([sonst])");
    expect(lines).not.toContain("stop");
  });

  it("widens a narrow node on the way back, so that the way up passes beside its guard", () => {
    const code = sketch("  if (digitalRead(2) == LOW) {\n    return;\n  }\n  delay(1);");
    const back = valid(code, "digitalRead(2) == LOW").source.split("\n").find((line) => line.startsWith("backward :")) ?? "";
    const guard = "[digitalRead(2) == LOW]";
    expect(back).toMatch(/^backward :return<U\+003B>(<U\+00A0>)+;$/);
    expect(back.match(/<U\+00A0>/g)?.length ?? 0).toBeGreaterThanOrEqual(2 * guard.length - "return;".length);
    // A node wide enough already keeps its text as it is.
    expect(valid(TEMPERATURE_CONTROLLER, "(raw == 0)").source).not.toContain("<U+00A0>");
  });

  it("rejects an excerpt whose loop() inputs were changed", () => {
    const { proposal } = valid(TEMPERATURE_CONTROLLER, "(raw == 0)");
    const forged = { ...proposal, enclosing: { function: "loop", inputs: [{ type: "action", code: "int raw = 0;", ref: { file: "sketch.ino", startLine: 16, endLine: 16 } }] } };
    expect(validateTutorUmlProposal(forged, context(TEMPERATURE_CONTROLLER)).ok).toBe(false);
    const { enclosing: _dropped, ...without } = proposal;
    expect(validateTutorUmlProposal(without, context(TEMPERATURE_CONTROLLER)).ok).toBe(false);
  });

  it.each([
    ["a condition on a global", "int raw = 0;\nvoid setup() {}\nvoid loop() {\n  if (raw == 0) {\n    Serial.println(1);\n    return;\n  }\n  delay(1);\n}"],
    ["a helper function", "void setup() {}\nvoid loop() {}\nvoid check(int raw) {\n  if (raw == 0) {\n    Serial.println(1);\n    return;\n  }\n  delay(1);\n}"],
  ])("ends a return in its own final node, without a merge node, for %s", (_name, code) => {
    const { proposal, source } = valid(code, "(raw == 0)");
    expect(proposal.enclosing).toBeUndefined();
    const lines = source.split("\n");
    expect(lines[lines.findIndex((line) => line.startsWith(":return")) + 1]).toBe("stop");
    // An if, not a switch: a switch draws a merge node with a single incoming edge here.
    expect(lines).toContain("if () then ([raw <U+003D><U+003D> 0])");
    expect(lines).not.toContain("switch ()");
    expect(lines.slice(-4)).toEqual(["(A)", `note right: weiter nach Zeile ${proposal.scope.endLine}`, "detach", "@enduml"]);
  });

  it("lets an excerpt without a return leave through the connector, not a final node", () => {
    const { source } = valid(TEMPERATURE_CONTROLLER, "(temperature < TEMP_MIN)");
    expect(source.split("\n")).not.toContain("stop");
    expect(source).toContain("\n(A)\n");
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
      // The branch with its actions and its own return node now stands behind [sonst].
      expect([first.whenTrue.length, first.whenFalse.length]).toEqual([0, 2]);
      // On the way back as well: the swapped branch returns under [sonst].
      const checked = validateTutorUmlProposal(proposal, context(TEMPERATURE_CONTROLLER));
      if (!checked.ok || checked.proposal.status !== "diagram") throw new Error("valid excerpt expected");
      expect(exportTutorUml(checked.proposal)).toContain("repeat while () is ([sonst]) not ([raw <U+003D><U+003D> 0])");
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
