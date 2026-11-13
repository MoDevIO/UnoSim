import { TUTOR_GRAPHIC_RENDER_FAILED } from "@shared/tutor-graphics";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { reportTutorGraphic } from "@/lib/tutor-diagnostics";

/** Loads only for a supplied graphic; reports success after its SVG reaches the current DOM. */
export function MermaidPreview({ source, subject, showFailure = false }: { readonly source: string; readonly subject: object; readonly showFailure?: boolean }) {
  const renderId = useId().replaceAll(":", "");
  const [rendered, setRendered] = useState<{ source: string; svg: string } | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const reported = useRef<object | null>(null);
  useEffect(() => {
    let current = true;
    setFailedSource(null);
    void import("@/lib/tutor-mermaid").then(({ renderMermaidDiagram }) => {
      if (!current) return;
      try {
        const result = renderMermaidDiagram(source, `tutor-diagram-${renderId}`);
        if (result.status === "rejected") {
          setRendered(null);
          setFailedSource(source);
          reportTutorGraphic(subject, { stage: "renderer", outcome: "rejected", reason: result.reason });
        } else setRendered({ source, svg: result.svg });
      } catch {
        setRendered(null);
        setFailedSource(source);
        reportTutorGraphic(subject, { stage: "renderer", outcome: "failed", reason: "renderer-failed" });
      }
    }).catch(() => {
      if (!current) return;
      setRendered(null);
      setFailedSource(source);
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
  if (rendered?.source !== source) return showFailure && failedSource === source
    ? <output className="mt-2 block text-ui-sm text-muted-foreground">{TUTOR_GRAPHIC_RENDER_FAILED}</output> : null;
  return <div ref={root} className="mt-4 overflow-x-auto text-muted-foreground" data-testid="tutor-mermaid" dangerouslySetInnerHTML={{ __html: rendered.svg }} />;
}
