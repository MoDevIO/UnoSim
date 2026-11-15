import { expect, it } from "vitest";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";
import { exportTutorUml } from "../../../../../server/services/tutor/uml/export";
import { TutorUmlRenderer } from "../../../../../server/services/tutor/uml/renderer";
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

it.each([
  [activity, activityCode],
  [classes, classCode],
  [sequence, sequenceCode],
])(
  "validates, exports and renders a real positive fixture %#",
  async (proposal, code) => {
    const valid = validateTutorUmlProposal(proposal, context(code as string));
    expect(valid.ok).toBe(true);
    if (!valid.ok || valid.proposal.status !== "diagram")
      throw new Error("Fixture rejected");
    const source = exportTutorUml(valid.proposal);
    const image = await new TutorUmlRenderer().render(
      source,
      valid.proposal.kind,
    );
    expect(image.width).toBeGreaterThan(30);
    expect(image.height).toBeGreaterThan(30);
    expect(image.svg).not.toContain("Syntax Error");
    expect(image.svg).not.toContain("SRC=");
    const fills = [...image.svg.matchAll(/(?:fill="|fill:)([^";]+)/g)].map(
      (match) => match[1],
    );
    const grayscale = (value: string): boolean => {
      if (["none", "black", "white", "transparent"].includes(value))
        return true;
      const hex = value.replace(/^#/, "");
      return hex.length === 3
        ? hex[0] === hex[1] && hex[1] === hex[2]
        : hex.length === 6 &&
            hex.slice(0, 2).toLowerCase() === hex.slice(2, 4).toLowerCase() &&
            hex.slice(2, 4).toLowerCase() === hex.slice(4, 6).toLowerCase();
    };
    expect(
      fills.filter((fill) => !grayscale(fill)),
      "only monochrome SVG fills",
    ).toEqual([]);
    if (valid.proposal.kind === "activity") {
      expect(image.svg).toContain("ready");
      expect(image.svg).toContain("[ja]");
      expect(image.svg).toContain("[nein]");
    }
    if (valid.proposal.kind === "class") {
      expect(image.svg).toContain("void go(int x)");
      expect(image.svg).toContain("Base");
      expect(image.svg).toContain("Child");
    }
    if (valid.proposal.kind === "sequence") {
      expect(image.svg).toContain("sensor.read()");
      expect(source).toContain("P1 --> P0");
      expect(source).toContain("P0 -> P1");
    }
  },
);
it("renders malicious C++ string text as data without PlantUML/Creole statements or resources", async () => {
  const attack = String.raw`!include /private/secret @enduml [[https://invalid.example]] <img:https://invalid.example/x> <script> __bold__ **x** \nclass Evil`;
  const action = `emit(${JSON.stringify(attack)});`;
  const code = `void run() {\n  ${action}\n}`;
  const proposal = {
    ...activity,
    scope: ref(1, 3),
    body: [{ type: "action", code: action, ref: ref(2) }],
  };
  const valid = validateTutorUmlProposal(proposal, context(code));
  expect(valid.ok).toBe(true);
  if (!valid.ok || valid.proposal.status !== "diagram")
    throw new Error("Attack fixture rejected before exporter");
  const source = exportTutorUml(valid.proposal);
  expect(
    source.split("\n").filter((line) => line.startsWith("@enduml")),
  ).toHaveLength(1);
  expect(source).not.toContain("!include");
  expect(source).not.toContain("[[https");
  expect(source).not.toContain("<img:");
  const image = await new TutorUmlRenderer().render(source, "activity");
  expect(image.svg).toContain("!include /private/secret @enduml");
  expect(image.svg).toContain("__bold__");
  expect(image.svg).not.toMatch(/(?:href=|<image|<script|foreignObject)/);
});
it("renders a proven loop back edge and a proven self call with the same closed templates", async () => {
  const loopCode =
    "void run() {\n while (ready) {\n  tick();\n }\n after();\n}";
  const loop = {
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
  const selfCode = sequenceCode.replace(
    "int read() { return 1; }",
    "void sample() {} int read() { sample(); return 1; }",
  );
  const self = {
    ...sequence,
    messages: [
      sequence.messages[0],
      {
        type: "call",
        from: "sensor",
        to: "sensor",
        code: "sample()",
        ref: ref(1),
      },
      sequence.messages[1],
      sequence.messages[2],
      {
        type: "call",
        from: "sensor",
        to: "sensor",
        code: "sample()",
        ref: ref(1),
      },
    ],
  };
  for (const [proposal, code] of [
    [loop, loopCode],
    [self, selfCode],
  ] as const) {
    const valid = validateTutorUmlProposal(proposal, context(code));
    expect(valid.ok).toBe(true);
    if (!valid.ok || valid.proposal.status !== "diagram")
      throw new Error("Positive loop/self fixture rejected");
    const source = exportTutorUml(valid.proposal);
    const image = await new TutorUmlRenderer().render(
      source,
      valid.proposal.kind,
    );
    if (valid.proposal.kind === "activity") {
      expect(source).toContain("endwhile ([nein])");
      expect(image.svg).toContain("tick();");
    } else {
      expect(source).toContain("P1 -> P1");
      expect(image.svg).toContain("sample()");
    }
  }
});
