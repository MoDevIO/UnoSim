const ENTRYPOINT_REGEX = /\bvoid\s+(setup|loop)\s*\(\s*\)/g;

export function detectSketchEntrypoints(code: string): {
  hasSetup: boolean;
  hasLoop: boolean;
} {
  let hasSetup = false;
  let hasLoop = false;

  for (const match of code.matchAll(ENTRYPOINT_REGEX)) {
    if (match[1] === "setup") {
      hasSetup = true;
    } else if (match[1] === "loop") {
      hasLoop = true;
    }

    if (hasSetup && hasLoop) {
      break;
    }
  }

  return { hasSetup, hasLoop };
}
