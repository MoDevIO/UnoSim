import { readFile, readdir } from "node:fs/promises";
import { TutorUmlRenderer } from "../server/services/tutor/uml/renderer";
import type { TutorUmlKind } from "../shared/tutor-uml-profile";

/** Installation-only smoke test. Never calls a provider or downloads at request time. */
const renderer = new TutorUmlRenderer();
if (!await renderer.available()) throw new Error("Pinned Tutor UML runtime unavailable");
let peakRssKiB = 0;
async function processTreeRss(pid: number): Promise<number> {
  try {
    const children = await readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
    const childRss = await Promise.all(children.trim().split(/\s+/).filter(Boolean).map(async (id) => {
      const status = await readFile(`/proc/${id}/status`, "utf8");
      return Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) + await processTreeRss(Number(id));
    }));
    return childRss.reduce((sum, value) => sum + value, 0);
  } catch { return 0; }
}
const poll = process.platform === "linux" ? setInterval(() => {
  void processTreeRss(process.pid).then((rss) => { peakRssKiB = Math.max(peakRssKiB, rss); });
}, 50) : undefined;
const results: { kind: TutorUmlKind; width: number; height: number; bytes: number; durationMs: number }[] = [];
try {
  // Class and activity concurrently exercise the two-process admission limit.
  const render = async (kind: TutorUmlKind) => {
    const source = await readFile(`docs/examples/tutor-uml/${kind}.puml`, "utf8");
    const start = Date.now(); const image = await renderer.render(source, kind);
    if (image.svg.includes("SRC=") || /<script|href=|<image/i.test(image.svg)) throw new Error("Unexpected renderer resource/metadata");
    results.push({ kind, width: image.width, height: image.height, bytes: image.bytes, durationMs: Date.now() - start });
  };
  await Promise.all([render("activity"), render("class")]);
  await render("sequence");
  // Verify the installation check leaves no queued or running renderer.
  const active = renderer.activity;
  if (active.active || active.queued) throw new Error("Renderer work remained active");
  const fonts = await readdir("cache/tutor-uml/fonts/ttf");
  console.log(JSON.stringify({ platform: `${process.platform}-${process.arch}`, results, peakProcessTreeRssKiB: process.platform === "linux" ? peakRssKiB : "not-measured-here", fontFiles: fonts.length, active }, null, 2));
} finally { if (poll) clearInterval(poll); }
