import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { type TutorUmlKind } from "@shared/tutor-uml-profile";
import { UML_RENDER_LIMITS, UmlRenderError } from "./limits";
import { UmlRenderQueue } from "./queue";
import { tutorUmlRuntime } from "./runtime";
import { executeTutorUml } from "./process";
import { validateTutorUmlSvg, type RenderedUmlImage } from "./svg";

interface RendererOptions {
  readonly timeoutMs?: number;
  readonly active?: number;
  readonly queued?: number;
  readonly runtimeDirectory?: string;
}
export class TutorUmlRenderer {
  private readonly queue: UmlRenderQueue;
  private readonly timeout: number;
  constructor(private readonly options: RendererOptions = {}) {
    this.queue = new UmlRenderQueue(
      Math.max(
        1,
        Math.min(
          options.active ?? UML_RENDER_LIMITS.active,
          UML_RENDER_LIMITS.active,
        ),
      ),
      Math.max(
        0,
        Math.min(
          options.queued ?? UML_RENDER_LIMITS.queued,
          UML_RENDER_LIMITS.queued,
        ),
      ),
    );
    this.timeout = Math.max(
      1,
      Math.min(
        options.timeoutMs ?? UML_RENDER_LIMITS.timeoutMs,
        UML_RENDER_LIMITS.timeoutMs,
      ),
    );
  }
  get activity() {
    return this.queue.activity;
  }
  async available(): Promise<boolean> {
    return (await tutorUmlRuntime(this.options.runtimeDirectory)) !== null;
  }
  async render(
    source: string,
    kind: TutorUmlKind,
    signal?: AbortSignal,
  ): Promise<RenderedUmlImage> {
    if (Buffer.byteLength(source) > 64 * 1024)
      throw new UmlRenderError("render-output-invalid");
    return this.queue.run(async () => {
      const runtime = await tutorUmlRuntime(this.options.runtimeDirectory);
      signal?.throwIfAborted();
      if (!runtime) throw new UmlRenderError("renderer-unavailable");
      await mkdir(path.join(runtime.directory, "work"), { recursive: true });
      const work = await mkdtemp(
        path.join(runtime.directory, "work", "render-"),
      );
      try {
        const svg = await executeTutorUml(
          runtime,
          source,
          work,
          this.timeout,
          signal,
        );
        signal?.throwIfAborted();
        return validateTutorUmlSvg(svg, kind);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    }, signal);
  }
}
