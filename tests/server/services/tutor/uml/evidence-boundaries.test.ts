import { expect, it } from "vitest";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";
import {
  activity,
  activityCode,
  classes,
  classCode,
  context,
  ref,
  sequence,
  sequenceCode,
} from "./contract-fixtures";
const check = (proposal: unknown, code: string) =>
  validateTutorUmlProposal(proposal, context(code));
it("preserves whitespace inside C++ string literals instead of inventing an equal-looking action", () => {
  const code = 'void run() {\n  emit("two  spaces");\n}';
  const proposal = {
    ...activity,
    scope: ref(1, 3),
    body: [{ type: "action", code: 'emit("two spaces");', ref: ref(2) }],
  };
  expect(check(proposal, code).ok).toBe(false);
});
it("does not mistake calls in comments or string literals for executable call statements", () => {
  for (const code of [
    "void run() {\n // on();\n}",
    'void run() {\n const char *s="on();";\n}',
  ]) {
    expect(
      check(
        {
          ...activity,
          scope: ref(1, 3),
          body: [{ type: "action", code: "on();", ref: ref(2) }],
        },
        code,
      ).ok,
    ).toBe(false);
  }
});
it("accepts exactly ten action nodes plus generated start/end at the twelve-node boundary", () => {
  const statements = Array.from(
    { length: 10 },
    (_, index) => `  call${index}();`,
  );
  const code = `void run() {\n${statements.join("\n")}\n}`;
  const proposal = {
    ...activity,
    scope: ref(1, 12),
    body: statements.map((code, index) => ({
      type: "action",
      code: code.trim(),
      ref: ref(index + 2),
    })),
  };
  expect(check(proposal, code).ok).toBe(true);
  expect(
    check(
      {
        ...proposal,
        scope: ref(1, 13),
        body: [
          ...proposal.body,
          { type: "action", code: "last();", ref: ref(12) },
        ],
      },
      code.replace("\n}", "\n  last();\n}"),
    ).ok,
  ).toBe(false);
});
it("accepts a supported while body and rejects early return/break and a for loop without its update", () => {
  const code = "void run() {\n while (ready) {\n  tick();\n }\n after();\n}";
  const proposal = {
    ...activity,
    scope: ref(1, 6),
    body: [
      {
        type: "loop",
        condition: "ready",
        ref: ref(2, 4),
        body: [{ type: "action", code: "tick();", ref: ref(3) }],
      },
      { type: "action", code: "after();", ref: ref(5) },
    ],
  };
  expect(check(proposal, code).ok).toBe(true);
  // Without init and update a for loop is this while loop.
  expect(check(proposal, code.replace("while (ready)", "for (;ready;)")).ok).toBe(true);
  for (const changed of [
    code.replace("tick();", "return;"),
    code.replace("tick();", "break;"),
    code.replace("while (ready)", "for (;ready;step())"),
  ])
    expect(check(proposal, changed).ok).toBe(false);
});
it("rejects separate Arduino callbacks rather than fabricating the setup/loop runtime cycle", () => {
  expect(
    check(
      {
        ...activity,
        scope: ref(1, 3),
        body: [{ type: "action", code: "on();", ref: ref(2) }],
      },
      "void setup() {\n on();\n}\nvoid loop(){}",
    ).ok,
  ).toBe(false);
});
it("uses exact sent header files, rejects unknown include files and does not read from disk", () => {
  const ctx = {
    ...context('#include "types.h"\nvoid setup() {}'),
    headers: { "types.h": classCode },
  };
  const proposal = {
    ...classes,
    scope: ref(1, 9, "types.h"),
    classes: classes.classes.map((c) => ({
      ...c,
      ref: { ...c.ref, file: "types.h" },
      members: c.members.map((m) => ({
        ...m,
        ref: { ...m.ref, file: "types.h" },
      })),
    })),
    relations: classes.relations.map((r) => ({
      ...r,
      ref: { ...r.ref, file: "types.h" },
    })),
  };
  expect(validateTutorUmlProposal(proposal, ctx).ok).toBe(true);
  expect(validateTutorUmlProposal(proposal, { ...ctx, headers: {} }).ok).toBe(
    false,
  );
});
it("rejects templated and namespace-qualified classes that a plain identifier cannot disambiguate", () => {
  expect(
    check(
      { ...classes, scope: ref(1, 9) },
      `namespace Hidden {\n${classCode}\n}`,
    ).ok,
  ).toBe(false);
});
it("rejects hidden control flow, overloaded callees, nested calls and absent method implementations", () => {
  for (const code of [
    sequenceCode.replace(
      "sensor.read();\n  sensor.read();",
      "if (ready) sensor.read();\n  sensor.read();",
    ),
    sequenceCode.replace("int read() { return 1; }", "int read();"),
    sequenceCode.replace(
      "int read() { return 1; }",
      "int read() { return 1; } int read(int x) { return x; }",
    ),
    sequenceCode.replace("sensor.read();", "sensor.read(other());"),
  ])
    expect(check(sequence, code).ok).toBe(false);
});
it("rejects an activity with omitted executable statements even when all remaining references are real", () => {
  expect(
    check({ ...activity, body: [activity.body[1]] }, activityCode).ok,
  ).toBe(false);
});
it("counts generated merges exactly once without phantom nested start/end symbols", () => {
  const code =
    "void run() {\n if (ready) {\n  a();\n  b();\n  c();\n } else {\n  d();\n  e();\n  f();\n }\n g();\n h();\n}";
  const actions = (names: string[], line: number) =>
    names.map((name, index) => ({
      type: "action",
      code: `${name}();`,
      ref: ref(line + index),
    }));
  const proposal = {
    ...activity,
    scope: ref(1, 13),
    body: [
      {
        type: "decision",
        condition: "ready",
        ref: ref(2, 10),
        whenTrue: actions(["a", "b", "c"], 3),
        whenFalse: actions(["d", "e", "f"], 7),
      },
      ...actions(["g", "h"], 11),
    ],
  };
  expect(check(proposal, code).ok).toBe(true);
});
it("does not hide unmodelled calls inside a return expression", () => {
  const code = sequenceCode.replace("return 1;", "return helper();");
  const proposal = {
    ...sequence,
    messages: sequence.messages.map((m) =>
      m.type === "return" ? { ...m, code: "return helper();" } : m,
    ),
  };
  expect(check(proposal, code).ok).toBe(false);
});
it("does not collapse a namespace-qualified class into an unrelated unqualified identifier", () => {
  const shift = (r: ReturnType<typeof ref>) => ({
    ...r,
    startLine: r.startLine + 1,
    endLine: r.endLine + 1,
  });
  const proposal = {
    ...classes,
    scope: ref(1, 11),
    classes: classes.classes.map((c) => ({
      ...c,
      ref: shift(c.ref),
      members: c.members.map((m) => ({ ...m, ref: shift(m.ref) })),
    })),
    relations: classes.relations.map((r) => ({ ...r, ref: shift(r.ref) })),
  };
  expect(check(proposal, `namespace Hidden {\n${classCode}\n}`).ok).toBe(false);
});
it("rejects a statically endless while rather than adding a reachable stop after it", () => {
  const code = "void run() {\n while (true) {\n  tick();\n }\n}";
  expect(
    check(
      {
        ...activity,
        scope: ref(1, 5),
        body: [
          {
            type: "loop",
            condition: "true",
            ref: ref(2, 4),
            body: [{ type: "action", code: "tick();", ref: ref(3) }],
          },
        ],
      },
      code,
    ).ok,
  ).toBe(false);
});
it("does not turn an evaluated topic name or string literal into a concrete activity action", () => {
  for (const statement of ["measured;", '"on();";', "42;"]) {
    const code = `void run() {\n ${statement}\n}`;
    expect(
      check(
        {
          ...activity,
          scope: ref(1, 3),
          body: [{ type: "action", code: statement, ref: ref(2) }],
        },
        code,
      ).ok,
    ).toBe(false);
  }
});
it("requires same-file class evidence to stay inside the selected scope", () => {
  expect(check({ ...classes, scope: ref(1, 5) }, classCode).ok).toBe(false);
});
it("accepts an association only as a declared attribute type, without inferring ownership", () => {
  expect(
    check(
      {
        ...classes,
        relations: [
          { kind: "association", from: "Child", to: "Base", ref: ref(8) },
        ],
      },
      classCode,
    ).ok,
  ).toBe(true);
  expect(
    check(
      {
        ...classes,
        relations: [
          { kind: "association", from: "Base", to: "Child", ref: ref(3) },
        ],
      },
      classCode,
    ).ok,
  ).toBe(false);
});
