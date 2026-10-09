import { afterEach, describe, expect, it } from "vitest";
import { ExamplesCache, toSourceCacheKey } from "../../../server/services/examples/examples-cache";
import { ExamplesLoadController } from "../../../server/services/examples/examples-load-controller";
import { SourceProvider, type RequestContext } from "../../../server/services/examples/source-provider";

// The operator's default Course must stay loadable while browser overrides,
// which any client can trigger with arbitrary repositories and refs, are spammed.

const DEFAULT_REPOSITORY = "course/default";
const DEFAULT_REF = "main";
const defaultContext: RequestContext = { identity: "default", requestId: "default", sourcePriority: "default" };
const overrideContext: RequestContext = { identity: "attacker", requestId: "attacker", sourcePriority: "override" };
const revision = (marker: string) => marker.repeat(40).slice(0, 40);
const gates: Array<() => void> = [];
let released = false;

function releaseGates(): void {
  released = true;
  for (const release of gates.splice(0)) release();
}

afterEach(() => {
  releaseGates();
  released = false;
});

function snapshot() {
  return {
    contentBytes: 10,
    examples: [{
      id: "blink", title: "Blink", category: "Basics", main: "main.ino", source: "external" as const,
      files: [{ name: "main.ino", path: "main.ino", content: "void setup(){} void loop(){}" }],
    }],
  };
}

function harness(
  resolveOverride: (repository: string, ref: string) => Promise<string>,
  options: { maxSources?: number } = {},
) {
  let now = 1_000_000;
  let defaultResolutions = 0;
  const cache = new ExamplesCache({
    maxSources: options.maxSources ?? 32,
    maxSnapshots: 64,
    maxSnapshotBytes: 1_048_576,
    now: () => now,
    protectedSourceKeys: [toSourceCacheKey(DEFAULT_REPOSITORY, DEFAULT_REF)],
  });
  const loads = new ExamplesLoadController({
    maxConcurrentLoads: 4, maxLoadQueue: 4, maxOutboundFetches: 8, globalLoadStartsPerMinute: 20, now: () => now,
  });
  const resolver = {
    async resolve(repository: string, ref: string) {
      if (repository === DEFAULT_REPOSITORY) {
        defaultResolutions++;
        return revision("d");
      }
      return resolveOverride(repository, ref);
    },
  };
  const provider = new SourceProvider(resolver, { load: async () => snapshot() }, cache, loads, {
    refreshMs: 300_000, refreshRetryMs: 30_000, now: () => now,
  });
  return {
    provider,
    cache,
    advance: (ms: number) => { now += ms; },
    defaultResolutions: () => defaultResolutions,
    loadDefault: (requireFresh = true) => provider.resolve(DEFAULT_REPOSITORY, DEFAULT_REF, defaultContext, requireFresh),
  };
}

function hanging(): Promise<string> {
  if (released) return Promise.reject(new Error("released"));
  return new Promise((_resolve, reject) => { gates.push(() => reject(new Error("released"))); });
}

describe("default Course protection against browser override spam", () => {
  it("loads the default fresh after overrides used up their load-start budget", async () => {
    const h = harness(async () => { throw new Error("404"); });
    await h.loadDefault();
    h.advance(301_000);

    // One client, one request after the other: each failing override starts a load.
    const codes: string[] = [];
    for (let index = 0; index < 30; index++) {
      await h.provider.resolve("attacker/repo", `x${index}`, overrideContext, false)
        .catch((error: { code?: string }) => codes.push(error.code ?? "error"));
    }
    expect(codes).toHaveLength(30);
    expect(codes).toContain("RATE_LIMITED");

    await expect(h.loadDefault()).resolves.toMatchObject({ revision: revision("d"), stale: false });
  });

  it("loads the default while overrides occupy every override load slot and queue position", async () => {
    const h = harness(() => hanging());
    const blocked = Array.from({ length: 8 }, (_, index) =>
      h.provider.resolve("attacker/repo", `slow${index}`, overrideContext, false).catch(() => undefined));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(h.provider.resolve("attacker/repo", "one-more", overrideContext, false))
      .rejects.toMatchObject({ code: "LOAD_CAPACITY_EXCEEDED" });

    await expect(h.loadDefault()).resolves.toMatchObject({ revision: revision("d") });

    releaseGates();
    await Promise.all(blocked);
  });

  it("keeps the default source when overrides fill the source cache", async () => {
    const h = harness(async (repository) => revision(repository.endsWith("a") ? "a" : "b"), { maxSources: 2 });
    await h.loadDefault();
    h.advance(1_000);

    for (const repository of ["other/a", "other/b", "other/a", "other/b"]) {
      h.advance(1_000);
      await h.provider.resolve(repository, "main", overrideContext, false);
    }

    expect(h.cache.getSource(toSourceCacheKey(DEFAULT_REPOSITORY, DEFAULT_REF))).toBeDefined();
    await expect(h.loadDefault()).resolves.toMatchObject({ status: "cache" });
    expect(h.defaultResolutions()).toBe(1);
  });
});

describe("outbound fetch reserve", () => {
  it("lets a default load fetch while override loads saturate their outbound share", async () => {
    const controller = new ExamplesLoadController({
      maxConcurrentLoads: 4, maxLoadQueue: 4, maxOutboundFetches: 4, globalLoadStartsPerMinute: 60,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let activeOverrideFetches = 0;
    let maximumOverrideFetches = 0;
    const override = controller.runLoad(async () => {
      await Promise.all(Array.from({ length: 8 }, () => controller.runOutbound(async () => {
        activeOverrideFetches++;
        maximumOverrideFetches = Math.max(maximumOverrideFetches, activeOverrideFetches);
        await gate;
        activeOverrideFetches--;
      })));
    }, undefined, "override");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const defaultFetch = controller.runLoad(() => controller.runOutbound(async () => "fetched"), undefined, "default");
    const outcome = await Promise.race([
      defaultFetch,
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 200)),
    ]);

    expect(outcome).toBe("fetched");
    expect(maximumOverrideFetches).toBeLessThan(4);
    release();
    await override;
  });
});
