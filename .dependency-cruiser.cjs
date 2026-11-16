// Architecture gate: every source module must be reachable from a runtime entry
// point, or be listed below as offline tooling. Tests never count as a user.
// Run with `npm run check:reachability`.

/** Entry points of what actually ships: client, emulator worker, server, compile worker. */
const RUNTIME_ENTRIES = [
  "^client/src/main\\.tsx$",
  // Started with `new Worker(new URL(...))`, which is not an import edge.
  "^client/src/lib/runtime/emulator\\.worker\\.ts$",
  "^server/index\\.ts$",
  "^server/services/workers/compile-worker\\.ts$",
];

/**
 * Offline tooling that lives next to runtime code and is started only from
 * `scripts/`. Add a path here only for tooling, never to silence a finding
 * about runtime code.
 */
const OFFLINE_TOOLING = [
  "^server/services/tutor/evaluation/",
  "^server/services/course-content/(inline-focus-validator|tutor-quality-directory-validator|tutor-quality-schema|tutor-quality-validator)\\.ts$",
  "^packages/avr-emulator/src/headless/",
  // Package root barrel: consumed by scripts/emulate.ts only; the app imports the subpaths.
  "^packages/avr-emulator/src/index\\.ts$",
];

const SOURCE = "^(client/src|server|shared|packages/avr-emulator/src)/";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "runtime-reachable",
      comment:
        "This module is not reachable from any runtime entry point. Wire it in, delete it, or - if it is offline tooling - list it under OFFLINE_TOOLING.",
      severity: "error",
      from: { path: RUNTIME_ENTRIES },
      to: {
        path: SOURCE,
        pathNot: [...RUNTIME_ENTRIES, ...OFFLINE_TOOLING, "\\.d\\.ts$"],
        reachable: false,
      },
    },
    {
      name: "no-tooling-in-runtime",
      comment:
        "Runtime code must not depend on offline tooling, scripts or tests.",
      severity: "error",
      from: { path: SOURCE, pathNot: OFFLINE_TOOLING },
      // Data files under scripts/ (e.g. the UML runtime lock) are fine; code is not.
      to: {
        path: [
          ...OFFLINE_TOOLING,
          "^scripts/.+\\.(ts|mjs|cjs|js)$",
          "^tests/",
          "^e2e/",
          "^packages/avr-emulator/tests/",
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)node_modules/" },
    // Count type-only imports as edges, so type modules are reachable too.
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
