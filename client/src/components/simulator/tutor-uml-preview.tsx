import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { TutorUmlDiagram } from "@shared/tutor-uml";
import { TUTOR_GRAPHIC_RENDER_FAILED } from "@shared/tutor-graphics";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { acceptTutorUmlImage } from "@/lib/tutor-uml-image";
import { reportTutorGraphic } from "@/lib/tutor-diagnostics";

const DIAGRAM_LABELS = { activity: "Aktivitätsdiagramm", class: "Klassendiagramm", sequence: "Sequenzdiagramm" } as const;
const SCROLL_STEPS = new Map<string, ScrollToOptions>([
  ["ArrowLeft", { left: -40, top: 0 }], ["ArrowRight", { left: 40, top: 0 }],
  ["ArrowUp", { left: 0, top: -40 }], ["ArrowDown", { left: 0, top: 40 }],
]);

/** Native control keys move the associated image; Escape remains owned by the dialog. */
function scrollImage(event: KeyboardEvent<HTMLElement>, viewport: HTMLElement | null): void {
  if (!viewport) return;
  const step = SCROLL_STEPS.get(event.key);
  if (step) {
    event.preventDefault();
    viewport.scrollBy(step);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const end = event.key === "End";
    viewport.scrollLeft = end ? viewport.scrollWidth - viewport.clientWidth : 0;
    viewport.scrollTop = end ? viewport.scrollHeight - viewport.clientHeight : 0;
  }
}

/** The same short-lived image is used in the question and in its keyboard-accessible zoom. */
export function TutorUmlPreview({ diagram, subject }: { readonly diagram: TutorUmlDiagram; readonly subject: object }) {
  const [resource, setResource] = useState<{ url: string; subject: object; image: TutorUmlDiagram["image"] } | null>(null);
  const [failed, setFailed] = useState<object | null>(null);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const reported = useRef<object | null>(null);
  const image = diagram.image;
  const imageViewport = useRef<HTMLElement>(null);
  const zoomViewport = useRef<HTMLElement>(null);
  const viewportId = useId();
  const keyboardHelpId = useId();
  useEffect(() => {
    setOpen(false);
    setFailed(null);
    if (!acceptTutorUmlImage(image, 0)) {
      setResource(null);
      setFailed(subject);
      reportTutorGraphic(subject, { graphicsProfile: diagram.profile, umlKind: diagram.kind, stage: "renderer", outcome: "rejected", reason: "renderer-failed" });
      return;
    }
    let url: string;
    try { url = URL.createObjectURL(new Blob([image.svg], { type: "image/svg+xml" })); }
    catch {
      setFailed(subject);
      reportTutorGraphic(subject, { graphicsProfile: diagram.profile, umlKind: diagram.kind, stage: "renderer", outcome: "failed", reason: "renderer-failed" });
      return;
    }
    setResource({ url, subject, image });
    return () => URL.revokeObjectURL(url);
  }, [image, subject]);
  if (failed === subject) return <output className="mt-2 block text-ui-sm text-muted-foreground">{TUTOR_GRAPHIC_RENDER_FAILED}</output>;
  if (resource?.subject !== subject || resource?.image !== image || !image) return null;
  const description = `${DIAGRAM_LABELS[diagram.kind]}: ${diagram.purpose}`;
  const picture = (zoom: boolean) => <section ref={zoom ? zoomViewport : imageViewport} id={zoom ? undefined : viewportId} aria-label={zoom ? "Vergrößerte UML-Grafik, scrollbar" : "UML-Grafik, scrollbar"} aria-describedby={keyboardHelpId} tabIndex={-1} className={`${zoom ? "max-h-[70vh]" : "max-h-96"} min-w-0 overflow-auto rounded border bg-white`}>
    <img src={resource.url} alt={description} width={image.width} height={image.height} style={{ width: `calc(${image.width}px * max(1, var(--ui-font-scale, 1)))`, height: "auto", maxWidth: "none" }}
      onLoad={() => { if (reported.current !== resource) { reported.current = resource; reportTutorGraphic(subject, { graphicsProfile: diagram.profile, umlKind: diagram.kind, stage: "renderer", outcome: "rendered", bytes: image.bytes, width: image.width, height: image.height }); } }}
      onError={() => { setFailed(subject); setOpen(false); reportTutorGraphic(subject, { graphicsProfile: diagram.profile, umlKind: diagram.kind, stage: "renderer", outcome: "failed", reason: "renderer-failed" }); }} />
  </section>;
  return <div className="mt-4 min-w-0" data-testid="tutor-uml">
    {picture(false)}
    <span id={keyboardHelpId} className="sr-only">Mit den Pfeiltasten die Grafik verschieben; Pos1 zum Anfang, Ende zum Ende.</span>
    <Button ref={trigger} aria-controls={viewportId} aria-describedby={keyboardHelpId} onKeyDown={(event) => scrollImage(event, imageViewport.current)} type="button" variant="outline" className="mt-2 h-auto whitespace-normal py-1" onClick={() => setOpen(true)}>UML-Grafik vergrößern</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); zoomViewport.current?.focus(); }} onKeyDown={(event) => scrollImage(event, zoomViewport.current)} className="max-h-[95dvh] w-[calc(100%-2rem)] max-w-[95vw] min-w-0" onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogTitle>UML-Grafik zur aktuellen Frage</DialogTitle>
        <DialogDescription>{diagram.purpose}</DialogDescription>
        {picture(true)}
      </DialogContent>
    </Dialog>
  </div>;
}
