import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { reportTutorGraphic } from "@/lib/tutor-diagnostics";

/** Loads only for a supplied graphic; reports success after its SVG reaches the current DOM. */
export function MermaidPreview({ source, subject }: { readonly source: string; readonly subject: object }) {
  const renderId = useId().replaceAll(":", "");
  const [rendered, setRendered] = useState<{ source: string; svg: string } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const reported = useRef<object | null>(null);
  useEffect(() => {
    let current = true;
    void import("@/lib/tutor-mermaid").then(({ renderMermaidDiagram }) => {
      if (!current) return;
      try {
        const result = renderMermaidDiagram(source, `tutor-diagram-${renderId}`);
        if (result.status === "rejected") {
          setRendered(null);
          reportTutorGraphic(subject, { stage: "renderer", outcome: "rejected", reason: result.reason });
        } else setRendered({ source, svg: result.svg });
      } catch {
        setRendered(null);
        reportTutorGraphic(subject, { stage: "renderer", outcome: "failed", reason: "renderer-failed" });
      }
    }).catch(() => {
      if (!current) return;
      setRendered(null);
      reportTutorGraphic(subject, { stage: "renderer", outcome: "failed", reason: "renderer-load-failed" });
    });
    return () => { current = false; };
  }, [source, subject, renderId]);
  useLayoutEffect(() => {
    if (rendered?.source === source && reported.current !== rendered && root.current?.querySelector("svg")) {
      reported.current = rendered;
      reportTutorGraphic(subject, { stage: "renderer", outcome: "rendered" });
    }
  }, [rendered, source, subject]);
  if (rendered?.source !== source) return null;
  return <div ref={root} className="mt-4 overflow-x-auto text-muted-foreground" data-testid="tutor-mermaid" dangerouslySetInnerHTML={{ __html: rendered.svg }} />;
}
