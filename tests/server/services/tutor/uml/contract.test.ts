import { describe, expect, it } from "vitest";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";
import { exportTutorUml } from "../../../../../server/services/tutor/uml/export";
import {
  activity,
  activityCode,
  classes,
  classCode,
  context,
  it086Code,
  it086Question,
  ref,
  sequence,
  sequenceCode,
} from "./contract-fixtures";
const validate = (proposal: unknown, code = activityCode, question?: string) =>
  validateTutorUmlProposal(proposal, context(code, question));
const change = <T>(value: T, update: (copy: T) => void): T => {
  const copy = structuredClone(value);
  update(copy);
  return copy;
};
describe("strict classic UML contract and conservative code evidence", () => {
  it.each([
    [activity, activityCode],
    [classes, classCode],
    [sequence, sequenceCode],
  ])(
    "accepts a supported %s from executable/declaration evidence",
    (proposal, code) => {
      const result = validate(proposal, code as string);
      expect(result.ok).toBe(true);
      if (result.ok && result.proposal.status === "diagram")
        expect(exportTutorUml(result.proposal)).toMatch(/^@startuml\n/);
    },
  );
  it("accepts not-useful independently of parseability", () => {
    expect(
      validate(
        {
          version: 1,
          profile: "uml1-classic-v1",
          status: "not-useful",
          reason: "answer-leak",
          explanation: "Die Grafik würde die gesuchte Begründung vorwegnehmen.",
        },
        "{{",
      ),
    ).toMatchObject({ ok: true, proposal: { status: "not-useful" } });
  });
  it("rejects raw syntax, provider image metadata, unknown fields and oversize input", () => {
    for (const proposal of [
      { ...activity, svg: "<svg/>" },
      { ...activity, image: {} },
      { ...activity, plantuml: "!include secret" },
      { ...activity, purpose: "x".repeat(16384) },
    ])
      expect(validate(proposal).ok).toBe(false);
  });
  it("rejects forged files and false line spans", () => {
    expect(validate({ ...activity, scope: ref(1, 8, "secret.h") }).ok).toBe(
      false,
    );
    expect(
      validate(
        change(activity, (p) => {
          p.body[1].ref = ref(3);
        }),
      ).ok,
    ).toBe(false);
  });
  it("rejects actions fabricated from comments, strings and empty Arduino bodies (screenshot 1)", () => {
    const fake = {
      ...activity,
      scope: ref(1, 4),
      body: [{ type: "action", code: "on();", ref: ref(2) }],
    };
    expect(
      validate(fake, "void setup() {\n // on();\n}\nvoid loop() {}").ok,
    ).toBe(false);
    expect(
      validate(
        { ...fake, scope: ref(1, 3) },
        'void run() {\n const char *s="on();";\n}',
      ).ok,
    ).toBe(false);
  });
  it("rejects invented Sketch classes and unrelated datatypes/plotter chain (controlled screenshot 2 substitute)", () => {
    expect(
      validate(
        classes,
        "int measured = 0;",
        "Welchen Datentyp hat die betrachtete Variable?",
      ).ok,
    ).toBe(false);
    expect(
      validate(
        activity,
        activityCode,
        "Welchen Datentyp hat die betrachtete Variable?",
      ).ok,
    ).toBe(false);
  });
  it("rejects a solved function-test chain without changing the exact IT08.6 question (screenshot 3)", () => {
    expect(
      validate(
        {
          ...activity,
          scope: ref(4, 6),
          body: [
            {
              type: "action",
              code: "Soll-Wert 6.0; Test erfolgreich wegen Ganzzahldivision",
              ref: ref(5),
            },
          ],
        },
        it086Code,
        it086Question,
      ).ok,
    ).toBe(false);
  });
  it("rejects reordered branch bodies, parser errors and preprocessor-dependent evidence", () => {
    expect(
      validate(
        change(activity, (p) => {
          p.body.reverse();
        }),
      ).ok,
    ).toBe(false);
    expect(
      validate(activity, activityCode.replace("after();", "after(;")).ok,
    ).toBe(false);
    expect(validate(activity, `#define on off\n${activityCode}`).ok).toBe(
      false,
    );
  });
  it("rejects false visibility, foreign members and unproved inheritance", () => {
    expect(
      validate(
        change(classes, (p) => {
          p.classes[0].members[0].visibility = "private";
        }),
        classCode,
      ).ok,
    ).toBe(false);
    expect(
      validate(
        change(classes, (p) => {
          p.classes[0].members[0].declaration = "int missing";
        }),
        classCode,
      ).ok,
    ).toBe(false);
    expect(
      validate(
        change(classes, (p) => {
          p.relations[0].from = "Base";
          p.relations[0].to = "Child";
        }),
        classCode,
      ).ok,
    ).toBe(false);
  });
  it("rejects reversed calls, forged returns and nonexistent objects", () => {
    expect(
      validate(
        change(sequence, (p) => {
          p.messages[0].ref = ref(5);
          p.messages[2].ref = ref(4);
        }),
        sequenceCode,
      ).ok,
    ).toBe(false);
    expect(
      validate(
        change(sequence, (p) => {
          p.messages[1].code = "return 2;";
        }),
        sequenceCode,
      ).ok,
    ).toBe(false);
    expect(
      validate(
        change(sequence, (p) => {
          p.participants[1].name = "missing";
        }),
        sequenceCode,
      ).ok,
    ).toBe(false);
  });
  it("rejects the element budget before rendering", () => {
    expect(
      validate({
        ...activity,
        body: Array.from({ length: 13 }, () => activity.body[1]),
      }).ok,
    ).toBe(false);
    expect(
      validate(
        {
          ...sequence,
          messages: Array.from({ length: 25 }, () => sequence.messages[0]),
        },
        sequenceCode,
      ).ok,
    ).toBe(false);
  });
});
