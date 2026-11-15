import { expect, it } from "vitest";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";
import { exportTutorUml } from "../../../../../server/services/tutor/uml/export";
import { TutorUmlRenderer } from "../../../../../server/services/tutor/uml/renderer";
import {
  activity,
  arduinoCode,
  arduinoCycle,
  context,
  ref,
  sequence,
  sequenceCode,
} from "./contract-fixtures";

it.each([
  [
    "void run() {\n if (ready) {\n  on();\n } else off();\n}",
    {
      ref: ref(2, 4),
      whenTrue: [{ type: "action", code: "on();", ref: ref(3) }],
      whenFalse: [],
    },
  ],
  [
    "void run() {\n if (ready) on(); else {\n  off();\n }\n}",
    {
      ref: ref(2, 4),
      whenTrue: [{ type: "action", code: "off();", ref: ref(3) }],
      whenFalse: [],
    },
  ],
  [
    "void run() {\n if (ready) {\n  on();\n } else if (other) {\n  off();\n }\n}",
    {
      ref: ref(2, 6),
      whenTrue: [{ type: "action", code: "on();", ref: ref(3) }],
      whenFalse: [],
    },
  ],
])(
  "rejects unsupported mixed-braced and else-if branch omission %#",
  (code, decision) => {
    const proposal = {
      ...activity,
      scope: ref(1, code.split("\n").length),
      body: [{ type: "decision", condition: "ready", ...decision }],
    };
    expect(validateTutorUmlProposal(proposal, context(code)).ok).toBe(false);
  },
);
it("rejects a global-object participant shadowed by a by-value parameter", () => {
  expect(
    validateTutorUmlProposal(
      sequence,
      context(sequenceCode.replace("void run()", "void run(Sensor sensor)")),
    ).ok,
  ).toBe(false);
});
it("rejects a global-object participant shadowed by a method parameter", () => {
  const code = sequenceCode.replace(
    "int read() { return 1; }",
    "int read(Sensor sensor) { return 1; }",
  );
  expect(validateTutorUmlProposal(sequence, context(code)).ok).toBe(false);
});
it("accepts an app-catalog-bound Arduino runtime while refusing provider-owned facts and unknown boards", () => {
  expect(validateTutorUmlProposal(arduinoCycle, context(arduinoCode)).ok).toBe(
    true,
  );
  expect(
    validateTutorUmlProposal(arduinoCycle, {
      ...context(arduinoCode),
      board: "unknown",
    }).ok,
  ).toBe(false);
  for (const extra of [
    { facts: { setupCalls: 2 } },
    { board: "uno" },
    { profile: "injected" },
  ]) {
    expect(
      validateTutorUmlProposal(
        { ...arduinoCycle, ...extra },
        context(arduinoCode),
      ).ok,
    ).toBe(false);
  }
});
it("rejects missing, swapped or omitted callback bodies and unsupported callback signatures", () => {
  for (const proposal of [
    { ...arduinoCycle, setup: arduinoCycle.loop, loop: arduinoCycle.setup },
    { ...arduinoCycle, loop: { ...arduinoCycle.loop, body: [] } },
    { ...arduinoCycle, scope: ref(1, 3) },
  ])
    expect(validateTutorUmlProposal(proposal, context(arduinoCode)).ok).toBe(
      false,
    );
  for (const code of [
    arduinoCode.replace("void loop()", "void work()"),
    arduinoCode.replace("void setup()", "void setup(int value)"),
    arduinoCode + "\nvoid main() {}",
    arduinoCode + "\nvoid serialEvent() {}",
  ])
    expect(validateTutorUmlProposal(arduinoCycle, context(code)).ok).toBe(
      false,
    );
});
it("counts all five app-generated callback and cycle nodes at the twelve-node boundary", () => {
  const proposalWith = (count: number) => {
    const names = Array.from({ length: count }, (_, i) => `call${i}();`);
    const code = `void setup() {\n ${names.join("\n ")}\n}\nvoid loop() {}`;
    const proposal = {
      ...arduinoCycle,
      scope: ref(1, count + 3),
      setup: {
        ref: ref(1, count + 2),
        body: names.map((code, i) => ({
          type: "action",
          code,
          ref: ref(i + 2),
        })),
      },
      loop: { ref: ref(count + 3), body: [] },
    };
    return validateTutorUmlProposal(proposal, context(code));
  };
  expect(proposalWith(7).ok).toBe(true);
  expect(proposalWith(8)).toEqual({ ok: false, reason: "element-limit" });
});
it("renders setup once and an actual repeated loop back edge with no end symbol", async () => {
  const valid = validateTutorUmlProposal(arduinoCycle, context(arduinoCode));
  expect(valid.ok).toBe(true);
  if (!valid.ok || valid.proposal.status !== "diagram")
    throw new Error("Arduino fixture rejected");
  const source = exportTutorUml(valid.proposal);
  expect(
    source.split("\n").filter((line) => line === "stop" || line === "end"),
  ).toEqual([]);
  const image = await new TutorUmlRenderer().render(source, "activity");
  expect(image.svg).toContain("setup()");
  expect(image.svg).toContain("loop()");
  expect(image.svg).toContain("pinMode(13, 1);");
  expect(image.svg).toContain("digitalWrite(13, 1);");
  expect(image.svg.match(/>setup\(\)<\/text>/g)).toHaveLength(1);
  expect(image.svg.match(/>loop\(\)<\/text>/g)).toHaveLength(1);
  // One filled start circle, no classic bullseye or false exit for the app-owned unconditional cycle.
  expect(image.svg.match(/<ellipse\b/g)).toHaveLength(1);
  expect(image.svg).not.toContain("[nein]");
  // A real side route must go upward and rejoin below setup and above loop.
  // The renderer once drew label/goto through the actions without such an arrow.
  const attribute = (element: string, name: string) =>
    Number(new RegExp(` ${name}="([^"]+)"`).exec(element)?.[1]);
  const boxes = [...image.svg.matchAll(/<rect\b[^>]*>/g)].map(([tag]) => ({
    x: attribute(tag, "x"),
    y: attribute(tag, "y"),
    width: attribute(tag, "width"),
    height: attribute(tag, "height"),
  }));
  const lines = [...image.svg.matchAll(/<line\b[^>]*>/g)].map(([tag]) => ({
    x1: attribute(tag, "x1"),
    y1: attribute(tag, "y1"),
    x2: attribute(tag, "x2"),
    y2: attribute(tag, "y2"),
  }));
  const rightEdge = Math.max(...boxes.map((box) => box.x + box.width));
  const back = lines.find(
    (line) =>
      line.x1 === line.x2 &&
      line.x1 > rightEdge &&
      Math.abs(line.y1 - line.y2) > 50,
  );
  expect(back, "a visible back edge outside the actions").toBeDefined();
  if (!back) throw new Error("No actual back edge");
  const upper = Math.min(back.y1, back.y2),
    lower = Math.max(back.y1, back.y2);
  expect(upper).toBeGreaterThan(boxes[1].y + boxes[1].height);
  expect(upper).toBeLessThan(boxes[2].y);
  expect(
    lines.some(
      (line) =>
        line.x1 === back.x1 &&
        line.x2 < rightEdge &&
        line.y1 === upper &&
        line.y2 === upper,
    ),
  ).toBe(true);
  const arrows = [...image.svg.matchAll(/<polygon points="([^"]+)"/g)].map(
    ([, points]) => points.split(",").map(Number),
  );
  expect(
    arrows.some(
      (points) =>
        points.length === 8 &&
        points[2] === back.x1 &&
        points[3] > upper &&
        points[3] < lower &&
        points[1] > points[3] &&
        points[5] > points[3],
    ),
  ).toBe(true);
});
it("rejects a global receiver identity shadowed by a class member while keeping unshadowed calls valid", () => {
  const code =
    "class Sensor { public: int read() { return 1; } };\nSensor sensor;\nclass Driver { public: void execute() { sensor.read(); } };\nDriver driver;\nvoid run() { driver.execute(); }";
  const proposal = {
    ...sequence,
    scope: ref(5),
    participants: [
      { kind: "context", name: "run", ref: ref(5) },
      { kind: "object", name: "sensor", className: "Sensor", ref: ref(2) },
      { kind: "object", name: "driver", className: "Driver", ref: ref(4) },
    ],
    messages: [
      {
        type: "call",
        from: "run",
        to: "driver",
        code: "driver.execute()",
        ref: ref(5),
      },
      {
        type: "call",
        from: "driver",
        to: "sensor",
        code: "sensor.read()",
        ref: ref(3),
      },
      {
        type: "return",
        from: "sensor",
        to: "driver",
        code: "return 1;",
        ref: ref(1),
      },
    ],
  };
  expect(validateTutorUmlProposal(proposal, context(code)).ok).toBe(true);
  expect(
    validateTutorUmlProposal(
      proposal,
      context(
        code.replace(
          "class Driver { public:",
          "class Driver { public: Sensor sensor;",
        ),
      ),
    ).ok,
  ).toBe(false);
});
it("binds runtime facts to each pinned Arduino AVR board and rejects a different core", () => {
  for (const board of ["uno", "nano", "mega2560"])
    expect(
      validateTutorUmlProposal(arduinoCycle, { ...context(arduinoCode), board })
        .ok,
    ).toBe(true);
  expect(
    validateTutorUmlProposal(arduinoCycle, {
      ...context(arduinoCode),
      board: "attiny85",
    }).ok,
  ).toBe(false);
});
it("retains supported code decisions inside the app-owned repeated callback cycle", async () => {
  const code =
    "void setup() {\n pinMode(13, 1);\n}\nvoid loop() {\n if (ready) {\n  on();\n } else {\n  off();\n }\n}";
  const proposal = {
    ...arduinoCycle,
    scope: ref(1, 10),
    loop: {
      ref: ref(4, 10),
      body: [
        {
          type: "decision",
          condition: "ready",
          ref: ref(5, 9),
          whenTrue: [{ type: "action", code: "on();", ref: ref(6) }],
          whenFalse: [{ type: "action", code: "off();", ref: ref(8) }],
        },
      ],
    },
  };
  const valid = validateTutorUmlProposal(proposal, context(code));
  expect(valid.ok).toBe(true);
  if (!valid.ok || valid.proposal.status !== "diagram")
    throw new Error("Arduino branch rejected");
  const source = exportTutorUml(valid.proposal);
  const image = await new TutorUmlRenderer().render(source, "activity");
  expect(image.svg).toContain("ready");
  expect(image.svg).toContain("[ja]");
  expect(image.svg).toContain("[nein]");
  expect(image.svg).toContain("[immer]");
  expect(image.svg.match(/<ellipse\b/g)).toHaveLength(1);
});
