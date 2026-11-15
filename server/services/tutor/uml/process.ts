import { spawn } from "node:child_process";
import type { TutorUmlRuntime } from "./runtime";
import { UmlRenderError } from "./limits";
import { TUTOR_UML_LIMITS } from "@shared/tutor-uml-profile";

/** Dedicated renderer port: no inherited environment or general-purpose command capability. */
export function executeTutorUml(
  runtime: TutorUmlRuntime,
  source: string,
  work: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
      runtime.java,
      [
        "-Xmx256m",
        "-Djava.awt.headless=true",
        `-Dsun.java2d.fontpath=${runtime.fonts}`,
        `-Djava.io.tmpdir=${work}`,
        "-DPLANTUML_SECURITY_PROFILE=SANDBOX",
        "-jar",
        runtime.jar,
        "-nometadata",
        "-charset",
        "UTF-8",
        "-pipe",
        "-tsvg",
      ],
      {
        cwd: work,
        detached: process.platform !== "win32",
        stdio: "pipe",
        shell: false,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "en_US.UTF-8",
          FONTCONFIG_FILE: runtime.fontConfig,
          GRAPHVIZ_DOT: "/nonexistent/unosim-no-external-layout",
        },
      },
    );
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderrBytes = 0;
    let failure: UmlRenderError | undefined;
    const kill = () => {
      try {
        if (child.pid && process.platform !== "win32")
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* It may already have exited. */
      }
    };
    const abort = () => kill();
    const timer = setTimeout(() => {
      failure = new UmlRenderError("renderer-timeout");
      kill();
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > TUTOR_UML_LIMITS.imageBytes) {
        failure = new UmlRenderError("render-output-invalid");
        kill();
      } else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 8192) {
        failure = new UmlRenderError("renderer-failed");
        kill();
      }
    });
    child.stdin.on("error", () => {
      /* The process close event owns the result. */
    });
    child.on("error", () => {
      failure = new UmlRenderError("renderer-unavailable");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject(new UmlRenderError("renderer-failed"));
        return;
      }
      try {
        resolve(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch {
        reject(new UmlRenderError("render-output-invalid"));
      }
    });
    child.stdin.end(source);
  });
}
