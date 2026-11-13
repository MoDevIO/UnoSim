import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TutorUmlPreview } from "@/components/simulator/tutor-uml-preview";
import { acceptTutorUmlImage, boundTutorUmlResponse, normalizeTutorUmlPayload } from "@/lib/tutor-uml-image";
import { activity } from "../server/services/tutor/uml/contract-fixtures";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900" viewBox="0 0 800 900"><text x="10" y="20" font-size="14">on();</text></svg>';
const image = { svg, width: 800, height: 900, bytes: new TextEncoder().encode(svg).length, rendererRevision: "test" };
const diagram = { version: 1 as const, profile: "uml1-classic-v1" as const, kind: "activity" as const, purpose: activity.purpose, proposal: activity, image };
beforeEach(() => { vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:uml"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("accepts only bounded image content and counts serialized metadata in the aggregate budget", () => {
  expect(acceptTutorUmlImage(image, 0)).toBe(true);
  expect(acceptTutorUmlImage(image, 4 * 1024 * 1024 - image.bytes)).toBe(false);
  expect(acceptTutorUmlImage({ ...image, bytes: 1 }, 0)).toBe(false);
  expect(acceptTutorUmlImage({ ...image, width: 2401 }, 0)).toBe(false);
});
it.each([
  '<script>alert(1)</script>', '<foreignObject/>', '<image href="https://example.com"/>', '<text onclick="alert(1)">a</text>', '<a href="javascript:alert(1)">link</a>', '<g style="fill:url(https://example.com)"/>', '<text font-size="8">small</text>', '<g transform="scale(0.1)"><text font-size="14">small</text></g>',
])("rejects active or unreadable SVG %s", (content) => {
  const source = svg.replace(/<text.*<\/text>/, content);
  expect(acceptTutorUmlImage({ ...image, svg: source, bytes: new TextEncoder().encode(source).length }, 0)).toBe(false);
});
it("strips only a rejected optional image and retains the question and validated proposal", () => {
  const value = { question: "Frage?", graphicStatus: "provided", diagram: { ...diagram, image: { ...image, height: 4001 } } };
  expect(normalizeTutorUmlPayload(value)).toEqual({ ...value, diagram: { ...diagram, image: undefined } });
});
it("uses one Blob image at natural size, shares it with zoom, returns focus on Escape and revokes on change/unmount", async () => {
  const subject = {};
  const view = render(<TutorUmlPreview diagram={diagram as Parameters<typeof TutorUmlPreview>[0]["diagram"]} subject={subject} />);
  const img = await screen.findByRole("img");
  expect(img).toHaveAttribute("src", "blob:uml");
  expect(img).toHaveAttribute("width", "800");
  expect(img.style.maxWidth).toBe("none");
  expect(view.container.querySelector("svg")).toBeNull();
  fireEvent.load(img);
  const trigger = screen.getByRole("button", { name: "UML-Grafik vergrößern" });
  const user = userEvent.setup();
  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "UML-Grafik zur aktuellen Frage" })).toBeInTheDocument();
  expect(screen.getAllByRole("img").every((node) => node.getAttribute("src") === "blob:uml")).toBe(true);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  view.rerender(<TutorUmlPreview diagram={diagram as Parameters<typeof TutorUmlPreview>[0]["diagram"]} subject={subject} />);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  view.rerender(<TutorUmlPreview diagram={diagram as Parameters<typeof TutorUmlPreview>[0]["diagram"]} subject={{}} />);
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1));
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it("shows the fixed display failure if the browser rejects the Blob image", async () => {
  render(<TutorUmlPreview diagram={diagram as Parameters<typeof TutorUmlPreview>[0]["diagram"]} subject={{}} />);
  fireEvent.error(await screen.findByRole("img"));
  expect(screen.getByText("Grafik konnte nicht dargestellt werden.")).toBeInTheDocument();
  expect(screen.queryByRole("img")).toBeNull();
});

it("rejects only the new optional image when retained image metadata exhausts the 4 MiB budget", () => {
  const response = { provider: "kiconnect", model: "m", question: "Neue Frage?", diagram } as Parameters<typeof boundTutorUmlResponse>[0];
  const retained = { ...response, question: "Vorige Frage?", diagram: { ...diagram, purpose: "x".repeat(4 * 1024 * 1024) } };
  const result = boundTutorUmlResponse(response, [retained]);
  expect(result.question).toBe("Neue Frage?"); expect(result.diagram?.image).toBeUndefined();
  expect(retained.diagram.image).toBe(image); expect(response.diagram?.image).toBe(image);
});

it("records actual image load once with bounded metadata and no SVG in browser diagnostics", async () => {
  localStorage.setItem("unoDebugMode", "1");
  const { tutorResponseSchema } = await import("@shared/tutor");
  const { bindTutorDiagnosticResponse, tutorDiagnosticFetch } = await import("@/lib/tutor-diagnostics");
  const events: Array<Record<string, unknown>> = [];
  const listener = (event: Event) => events.push((event as CustomEvent).detail);
  document.addEventListener("tutor-diagnostic", listener);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ provider: "kiconnect", model: "m", question: "Wie verzweigt run?", diagram, graphicStatus: "provided" })));
  try {
    const payload = await (await tutorDiagnosticFetch("/api/tutor/question", {})).json();
    const subject = tutorResponseSchema.parse(payload); bindTutorDiagnosticResponse(payload, subject);
    render(<TutorUmlPreview diagram={subject.diagram!} subject={subject} />);
    const img = await screen.findByRole("img");
    expect(events.some((event) => event.outcome === "rendered")).toBe(false);
    fireEvent.load(img); fireEvent.load(img);
    expect(events.filter((event) => event.stage === "renderer" && event.outcome === "rendered")).toEqual([expect.objectContaining({ graphicsProfile: "uml1-classic-v1", umlKind: "activity", bytes: image.bytes, width: 800, height: 900 })]);
    expect(JSON.stringify(events)).not.toContain("<svg");
  } finally { document.removeEventListener("tutor-diagnostic", listener); localStorage.clear(); }
});

it("keeps both image axes keyboard accessible from the native zoom button and in the dialog", async () => {
  render(<TutorUmlPreview diagram={diagram as Parameters<typeof TutorUmlPreview>[0]["diagram"]} subject={{}} />);
  await screen.findByRole("img");
  const viewport = screen.getByRole("region", { name: "UML-Grafik, scrollbar" });
  const scrollBy = vi.fn(({ left, top }: ScrollToOptions) => { viewport.scrollLeft += Number(left); viewport.scrollTop += Number(top); });
  viewport.scrollBy = scrollBy;
  const trigger = screen.getByRole("button", { name: "UML-Grafik vergrößern" });
  fireEvent.keyDown(trigger, { key: "ArrowRight" }); fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(viewport.scrollLeft).toBe(40); expect(viewport.scrollTop).toBe(40);
  fireEvent.keyDown(trigger, { key: "ArrowLeft" }); fireEvent.keyDown(trigger, { key: "ArrowUp" });
  expect(viewport.scrollLeft).toBe(0); expect(viewport.scrollTop).toBe(0);
  Object.defineProperties(viewport, { scrollWidth: { value: 800 }, scrollHeight: { value: 900 }, clientWidth: { value: 320 }, clientHeight: { value: 384 } });
  fireEvent.keyDown(trigger, { key: "End" }); expect(viewport.scrollLeft).toBe(480); expect(viewport.scrollTop).toBe(516);
  fireEvent.keyDown(trigger, { key: "Home" }); expect(viewport.scrollLeft).toBe(0); expect(viewport.scrollTop).toBe(0);
  const user = userEvent.setup(); await user.click(trigger);
  const zoom = screen.getByRole("region", { name: "Vergrößerte UML-Grafik, scrollbar" });
  expect(zoom).toHaveFocus();
  zoom.scrollBy = vi.fn(({ left, top }: ScrollToOptions) => { zoom.scrollLeft += Number(left); zoom.scrollTop += Number(top); });
  fireEvent.keyDown(zoom, { key: "ArrowRight" }); fireEvent.keyDown(zoom, { key: "ArrowDown" });
  expect(zoom.scrollLeft).toBe(40); expect(zoom.scrollTop).toBe(40);
  await user.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus());
});

it.each(["bogus", "NaN", "14%"])("rejects invalid font dimension %s while refactoring numeric guards", (fontSize) => {
  const source = svg.replace('font-size="14"', `font-size="${fontSize}"`);
  expect(acceptTutorUmlImage({ ...image, svg: source, bytes: new TextEncoder().encode(source).length }, 0)).toBe(false);
});
