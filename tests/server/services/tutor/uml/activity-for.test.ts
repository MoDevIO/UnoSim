import { expect, it } from "vitest";
import { exportTutorUml } from "../../../../../server/services/tutor/uml/export";
import { validateTutorUmlProposal } from "../../../../../server/services/tutor/uml/validate";
import { activity, context, ref } from "./contract-fixtures";

// The nested loops of IT11.4 (review5), where the Tutor had to do without a graphic.
const code = `void transposeMatrix(const double mat[M][N], double ergebnis[N][M]) {
  for (byte i = 0; i < M; i++) {
    for (byte k = 0; k < N; k++) {
      ergebnis[k][i] = mat[i][k];
    }
  }
}`;
type Step = Record<string, unknown>;
const inner = (body: Step[] = [{ type: "action", code: "ergebnis[k][i] = mat[i][k];", ref: ref(4) }, { type: "action", code: "k++;", ref: ref(3) }]): Step[] => [
  { type: "action", code: "byte k = 0;", ref: ref(3) },
  { type: "loop", condition: "k < N", ref: ref(3, 5), body },
];
const transpose = (body: Step[] = [
  { type: "action", code: "byte i = 0;", ref: ref(2) },
  { type: "loop", condition: "i < M", ref: ref(2, 6), body: [...inner(), { type: "action", code: "i++;", ref: ref(2) }] },
]) => ({ ...activity, purpose: "Zeigt, wie die beiden Schleifen jedes Element einmal umkopieren.", scope: ref(1, 7), body });
const check = (proposal: unknown, source = code) => validateTutorUmlProposal(proposal, context(source, "Welche Elemente vertauscht die innere Schleife?"));

it("accepts nested for loops shown as init, loop over the condition and the update at the end of the body", () => {
  const result = check(transpose());
  expect(result.ok).toBe(true);
  if (result.ok && result.proposal.status === "diagram") {
    const uml = exportTutorUml(result.proposal);
    expect(uml.match(/^while \(\) is/gm)).toHaveLength(2);
    // The update runs at the end of each pass, inside its loop.
    const lines = uml.split("\n");
    const update = lines.indexOf(":k<U+002B><U+002B><U+003B>;");
    expect(update).toBeGreaterThan(lines.findLastIndex((line) => line.startsWith("while () is")));
    expect(lines[update + 1]).toBe("endwhile ([sonst])");
  }
});

it("accepts a for loop whose init or update is empty", () => {
  const source = "void run() {\n  int i = 0;\n  for (; i < 3;) {\n    i++;\n  }\n}";
  expect(check({
    ...activity, scope: ref(1, 6), body: [
      { type: "action", code: "int i = 0;", ref: ref(2) },
      { type: "loop", condition: "i < 3", ref: ref(3, 5), body: [{ type: "action", code: "i++;", ref: ref(4) }] },
    ],
  }, source).ok).toBe(true);
});

it("refers init and update to the head of a for loop that spans several lines", () => {
  const source = "void run() {\n  for (int i = 0;\n       i < 3;\n       i++) {\n    tick();\n  }\n}";
  const head = ref(2, 4);
  const body = (update = head) => [
    { type: "action", code: "int i = 0;", ref: head },
    { type: "loop", condition: "i < 3", ref: ref(2, 6), body: [{ type: "action", code: "tick();", ref: ref(5) }, { type: "action", code: "i++;", ref: update }] },
  ];
  expect(check({ ...activity, scope: ref(1, 7), body: body() }, source).ok).toBe(true);
  expect(check({ ...activity, scope: ref(1, 7), body: body(ref(4)) }, source).ok).toBe(false);
});

const outer = (steps: Step[], update: Step[] = [{ type: "action", code: "i++;", ref: ref(2) }]) =>
  transpose([{ type: "action", code: "byte i = 0;", ref: ref(2) }, { type: "loop", condition: "i < M", ref: ref(2, 6), body: [...steps, ...update] }]);

it.each([
  ["the init left out", transpose(transpose().body.slice(1))],
  ["the update left out", outer(inner(), [])],
  ["the update at the start of the body", outer([{ type: "action", code: "i++;", ref: ref(2) }, ...inner()], [])],
  ["the inner update left out", outer(inner([{ type: "action", code: "ergebnis[k][i] = mat[i][k];", ref: ref(4) }]))],
  ["a changed condition", transpose([transpose().body[0], { ...transpose().body[1], condition: "i <= M" }])],
  ["the init without its semicolon", transpose([{ type: "action", code: "byte i = 0", ref: ref(2) }, transpose().body[1]])],
  ["the loop as a plain action", transpose([{ type: "action", code: "byte i = 0;", ref: ref(2) }, { type: "action", code: "ergebnis[k][i] = mat[i][k];", ref: ref(4) }])],
])("rejects %s", (_name, proposal) => {
  expect(check(proposal).ok).toBe(false);
});

it.each([
  ["a for loop without braces", code.replace("for (byte k = 0; k < N; k++) {", "for (byte k = 0; k < N; k++)").replace("    }\n  }", "  }")],
  ["an endless for loop", code.replace("i < M", "")],
  ["a break in the body", code.replace("ergebnis[k][i] = mat[i][k];", "break;")],
])("rejects %s", (_name, source) => {
  expect(check(transpose(), source).ok).toBe(false);
});
