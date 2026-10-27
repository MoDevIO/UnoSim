# Board size hierarchy

Status: approved design, 2026-10-26. Non-normative implementation reference.

The user selected the comparison preview's **Vorschlag**: display widths
relative to the Uno are Mega **125 %**, Uno **100 %**, Nano **85 %** and
ATtiny **65 %**. This is a visual hierarchy, not a physical scale.
Widths refer to the native drawing viewports including labels and intrinsic
margins, matching the approved preview rather than cropped PCB contours.

Use one reference envelope for all four drawings. Normalize each drawing
by its width, apply its relative width, then fit the maximum resulting
width and height into the available panel. The active board uses that
same scale unit. Independent fitting followed by a zoom factor cannot
guarantee the selected width order across different aspect ratios.

Keep the drawing centred. Background, overlay and logo retain one shared
transform; source SVG geometry and pin semantics stay unchanged.

For compact panels reduce the contrast continuously towards equal widths
without reversing their order. Implementation choice: when the fitted
Uno viewport is at most 160 CSS px wide, use 60 % of the
selected contrast; from 160 to 280 px interpolate to full contrast.
At 280 px and above the selected ratios apply exactly. This uses both
available width and height and applies identically to all boards.
Solve for the fitted Uno width itself, so increasing either panel dimension
cannot make any board smaller.

Fit within the safe margin, including extremely small or temporarily
hidden panels. Zero/invalid available space returns scale zero, and a
fixed minimum zoom must not force overflow. Board changes and resizing
must recalculate the scale before paint. The implementation must keep
native drawing dimensions stable even inside a narrow flex container.

Acceptance: exact desktop ratios, preserved compact ordering, no clipping,
fixed centre, smooth resizing, aligned overlays and working pin input on
the actual application. No new sizing controls or dependencies are needed.

Initial delivery: tested changes copied back to the user's workspace without
committing. On 2026-10-27 the user additionally authorized pushing the assembled
board work, merging it into `feature/browser-emulation` and cleaning up its
working branch after verification.
