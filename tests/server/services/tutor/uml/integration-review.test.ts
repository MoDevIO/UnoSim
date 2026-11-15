import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { prepareTutorUml } from "../../../../../server/services/tutor/uml/service";
import {
  getTutorReview,
  withTutorDiagnostics,
} from "../../../../../server/services/tutor/tutor-diagnostics";
import type { LLMProvider } from "../../../../../server/services/tutor/llm-provider";

const context = {
  question: "Welche Rolle hat die Reihenfolge in arbeiten?",
  code: "void arbeiten() {\n x++;\n}",
  entryFile: "main.ino",
  board: "uno",
};
const proposal = {
  version: 1,
  profile: "uml1-classic-v1",
  status: "diagram",
  kind: "activity",
  purpose:
    "Ordnet access-secret die gezeigten Anweisungen für den Vergleich zu.",
  scope: { file: "main.ino", startLine: 1, endLine: 3 },
  body: [
    {
      type: "action",
      code: "x++;",
      ref: { file: "main.ino", startLine: 2, endLine: 2 },
    },
  ],
};
const noPrimary: LLMProvider = {
  listModels: async () => [],
  generateLearningQuestion: async () => {
    throw new Error("unexpected");
  },
};
async function reviewed(run: () => Promise<unknown>) {
  return withTutorDiagnostics(
    {
      traceId: randomUUID(),
      requestId: randomUUID(),
      operation: "question",
      credential: "access-secret",
    },
    async () => {
      const result = await run();
      return {
        result,
        review: getTutorReview({ id: "test", templateDigest: "a".repeat(64) })!,
      };
    },
  );
}
it("preserves the normalized validated proposal and evidence after a render failure without SVG or credentials", async () => {
  const { result, review } = await reviewed(() =>
    prepareTutorUml(noPrimary, context, {
      mode: "auto",
      proposal,
      model: "alias",
      credential: "access-secret",
      renderer: {
        available: async () => true,
        render: async () => {
          throw new Error("<svg>private renderer output</svg>");
        },
      },
    }),
  );
  expect(result).toMatchObject({ graphicStatus: "unavailable" });
  const terminal = review.entries.find(
    (entry) => entry.kind === "uml" && entry.state === "unavailable",
  );
  expect(terminal).toMatchObject({
    reason: "renderer-failed",
    proposalJson: expect.any(String),
  });
  const normalized =
    terminal?.kind === "uml" && JSON.parse(terminal.proposalJson!);
  expect(normalized).toMatchObject({
    kind: "activity",
    scope: { file: "main.ino", startLine: 1, endLine: 3 },
    body: [
      { type: "action", ref: { file: "main.ino", startLine: 2, endLine: 2 } },
    ],
  });
  expect(normalized.purpose).toContain("[REDACTED-CREDENTIAL]");
  expect(review.sanitized).toBeGreaterThan(0);
  expect(review.dropped).toBe(0);
  expect(JSON.stringify(review)).not.toContain("access-secret");
  expect(JSON.stringify(review)).not.toContain("<svg>");
  expect(JSON.stringify(review)).not.toContain("_diagramArtifact");
});
it("preserves the schema-valid normalized graphic-only candidate rejected for invalid evidence", async () => {
  const candidate = {
    ...proposal,
    body: [
      {
        type: "action",
        code: "x++;",
        ref: { file: "missing.h", startLine: 2, endLine: 2 },
      },
    ],
  };
  const provider: LLMProvider = {
    ...noPrimary,
    generateGraphic: async () => ({
      model: "m",
      result: { diagram: candidate },
    }),
  };
  const { result, review } = await reviewed(() =>
    prepareTutorUml(provider, context, {
      mode: "always",
      model: "alias",
      credential: "access-secret",
      renderer: {
        available: async () => true,
        render: async () => {
          throw new Error("should not render");
        },
      },
    }),
  );
  expect(result).toMatchObject({ graphicStatus: "unavailable" });
  const rejected = review.entries.find(
    (entry) => entry.kind === "uml" && entry.state === "rejected",
  );
  expect(rejected).toMatchObject({
    attempt: 1,
    reason: "invalid-evidence",
    proposalJson: expect.any(String),
  });
  expect(
    rejected?.kind === "uml" && JSON.parse(rejected.proposalJson!).body,
  ).toEqual(candidate.body);
  expect(review.dropped).toBe(0);
  expect(JSON.stringify(review)).not.toContain("access-secret");
});
it.each(["unknown-fields", "over-original-byte-limit"])(
  "does not retain raw %s candidate data",
  async (variant) => {
    const action = {
      type: "action",
      code: "x".repeat(320),
      ref: { file: "main.ino", startLine: 2, endLine: 2 },
    };
    const candidate =
      variant === "unknown-fields"
        ? {
            ...proposal,
            svg: "<svg>untrusted-model-data</svg>",
            rawUnknown: "private-unvalidated-field",
          }
        : {
            ...proposal,
            body: Array.from({ length: 12 }, () => ({
              type: "decision",
              condition: "x".repeat(320),
              ref: action.ref,
              whenTrue: Array.from({ length: 12 }, () => action),
              whenFalse: Array.from({ length: 12 }, () => action),
            })),
          };
    const provider: LLMProvider = {
      ...noPrimary,
      generateGraphic: async () => ({
        model: "m",
        result: { diagram: candidate },
      }),
    };
    const { review } = await reviewed(() =>
      prepareTutorUml(provider, context, {
        mode: "always",
        model: "alias",
        credential: "access-secret",
        renderer: {
          available: async () => true,
          render: async () => {
            throw new Error("should not render");
          },
        },
      }),
    );
    expect(
      review.entries.find(
        (entry) => entry.kind === "uml" && entry.state === "rejected",
      ),
    ).not.toHaveProperty("proposalJson");
    expect(JSON.stringify(review)).not.toContain("untrusted-model-data");
    expect(JSON.stringify(review)).not.toContain("private-unvalidated-field");
  },
);
