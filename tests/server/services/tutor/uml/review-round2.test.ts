import { expect, it } from "vitest";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";
import { arduinoCycle, context, ref } from "./contract-fixtures";

const callbackFixture = (
  setupCode: string[],
  loopCode = ["tick();"],
  prefix: string[] = [],
) => {
  const setupStart = prefix.length + 1,
    setupEnd = setupStart + setupCode.length + 1;
  const loopStart = setupEnd + 1,
    loopEnd = loopStart + loopCode.length + 1;
  const code = [
    ...prefix,
    "void setup() {",
    ...setupCode,
    "}",
    "void loop() {",
    ...loopCode,
    "}",
  ].join("\n");
  const body = (statements: string[], start: number) =>
    statements.map((code, index) => ({
      type: "action",
      code,
      ref: ref(start + index + 1),
    }));
  const proposal = {
    ...arduinoCycle,
    scope: ref(setupStart, loopEnd),
    setup: {
      ref: ref(setupStart, setupEnd),
      body: body(setupCode, setupStart),
    },
    loop: { ref: ref(loopStart, loopEnd), body: body(loopCode, loopStart) },
  };
  return { code, proposal };
};
const targets = ["setup", "loop"].flatMap((target) => [
  `(${target})();`,
  `(( ${target} ))();`,
  `(*${target})();`,
  `(&${target})();`,
  `::${target}();`,
  `(static_cast<void(*)()>(${target}))();`,
]);
it.each(targets)(
  "rejects a wrapped/indirect callback target in setup: %s",
  (call) => {
    const { code, proposal } = callbackFixture([call]);
    expect(validateTutorUmlProposal(proposal, context(code))).toEqual({
      ok: false,
      reason: "invalid-evidence",
    });
  },
);
it.each(targets)(
  "rejects a wrapped/indirect callback target in loop: %s",
  (call) => {
    const { code, proposal } = callbackFixture(["pinMode(13, 1);"], [call]);
    expect(validateTutorUmlProposal(proposal, context(code))).toEqual({
      ok: false,
      reason: "invalid-evidence",
    });
  },
);
it.each([
  { setup: ["auto again = setup;", "again();"], prefix: [] },
  { setup: ["auto again = loop;", "(again)();"], prefix: [] },
  { setup: ["again();"], prefix: ["void setup();", "auto again = setup;"] },
  { setup: ["again();"], prefix: ["extern void (*again)();"] },
  { setup: ["dispatch(setup);"], prefix: [] },
  { setup: ["callbacks[0]();"], prefix: [] },
  { setup: ["(*again)();"], prefix: [] },
  { setup: ["callback.invoke();"], prefix: [] },
  {
    setup: ["helper();"],
    prefix: ["void setup();", "void helper() { (setup)(); }"],
  },
])(
  "rejects unsupported callback alias/indirect dispatch %#",
  ({ setup, prefix }) => {
    const { code, proposal } = callbackFixture(setup, undefined, prefix);
    expect(validateTutorUmlProposal(proposal, context(code))).toEqual({
      ok: false,
      reason: "invalid-evidence",
    });
  },
);
it("retains safe parenthesized free calls and treats callback strings/comments as data", () => {
  const { code, proposal } = callbackFixture(
    ['emit("(setup)(); loop");', "(tick)();"],
    ["tick();"],
    ["void tick();", "// (setup)(); loop();"],
  );
  expect(validateTutorUmlProposal(proposal, context(code)).ok).toBe(true);
});
