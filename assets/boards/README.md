# Board artwork sources

## Relative display sizes

All four views use one reference envelope, rather than maximising every
drawing independently. `BoardView.relativeWidth` defines the chosen visual
widths: Mega `1.25`, Uno `1`, Nano `0.85`, ATtiny `0.65`. These are presentation
choices, not physical dimensions. SVG coordinate units remain independent.
Widths refer to each drawing's native viewport, including its labels and
intrinsic margins, as in the approved comparison preview.

`boardDisplayScale` fits the maximum relative width and relative height into
the panel's safe margin. Background, overlay and logo share the same transform
and centre. A layout effect and ResizeObserver recalculate it on board changes
and resizing; there is no minimum zoom that can force an overflowing drawing.

Compact panels continuously soften the contrast. If the fitted Uno viewport
is at most 160 CSS px wide, 60 % of the chosen contrast is used
(Mega 115 %, Nano 91 %, ATtiny 79 %). Between 160 and 280 px it interpolates;
at 280 px and above the selected desktop widths apply exactly. Both panel
dimensions contribute, and the rule is identical for all boards. The compact
fit solves for that Uno width, so increasing either panel dimension cannot
make a board smaller.

## PWM pin markings

The generated Mega, Nano and ATtiny drawings mark PWM-capable pins with `~`,
matching the Uno convention. Each generator reads the emulator's hardware
profile: Mega D2–D13 and D44–D46, Nano D3/D5/D6/D9/D10/D11, ATtiny PB0/PB1/PB4.
Mega and Nano retain the supplied outline lettering and add wave paths beside
the labels; the ATtiny adds the symbol directly to its pin labels. The source
artwork, contact geometry, overlay and click targets remain unchanged when
regenerating. Run the corresponding `generate:*-svg` command with the project's
pinned Node 24 version.

## Reset buttons and chip labels

Mega and Nano use the Uno reset cap colours: `#852725` on the face and
`#641d1c` on the edge. The generators preserve the supplied contact and
button geometry. The bare ATtiny has no reset button. Its pin subtitles
use 5.5 SVG units (the same font size as the main pin labels), a separate
baseline and a lighter fill for readability within the shared board scale.

## Mega

`ArduinoMega.source.svg` is the user-supplied Mega illustration
(`arduino_mega.svg`, supplied on 2026-10-25). Keep this source unchanged.

Run `npm run generate:mega-svg` to regenerate `client/public/ArduinoMega.svg`
and `ArduinoMega-overlay.svg`. The generator reads the drawn socket, LED
and reset geometry. Both layers use a uniform quarter scale, with viewBox
`0 0 438.905 213.765`; `client/src/lib/board-view.ts` uses that same size.

The generated background namespaces classes and IDs, hides the two static
LED glows, and normalizes the PCB fill to the application's configurable
board colour. Paths, embedded artwork and proportions otherwise come from
the supplied source. The original export has duplicate LED IDs; generated
IDs are unique.

There are 70 logical signal pins and 72 signal sockets: the two extra
top-left contacts are SCL (D21) and SDA (D20). Their overlay parts reuse
the canonical D21/D20 state, frame and click availability with SVG `use`.
Power and ground sockets remain non-interactive. The four LEDs are L, ON,
TX and RX; reset targets the drawn pushbutton.

When changing the source, verify pin order against the drawn labels,
regenerate both outputs, and run the geometry tests and Mega browser tests:

```sh
npm run test:unit:app -- tests/client/components/mega-artwork-alignment.test.tsx tests/client/components/arduino-board-views.test.tsx
npm run test:e2e -- e2e/mega-artwork.spec.ts e2e/mega.spec.ts
```

The alignment tests cover every signal socket, every LED and reset,
including scaling in the browser. The browser suite also runs a real Mega
sketch and checks input through both SDA/SCL contacts, serial input, the
L/ON LEDs and reset.

## Nano

`ArduinoNano.source.svg` is the user-supplied `arduino_nano.svg` (supplied on
2026-10-26), retained unchanged. `npm run generate:nano-svg` rebuilds the
Nano background and overlay in `client/public/` from its actual contours.

The illustration's pads and LED lenses are compound paths. The generator
separates their closed circle/rectangle contours without changing their
appearance, then derives all 22 signal targets, TX/RX/ON/L and reset.
Unlike the old schematic, the upper row runs D12 toward TX1 from left to
right; the lower row starts with D13, 3V3, REF and A0. A6/A7 keep their
analog-only behaviour. Power, ground and ICSP contacts remain non-interactive.

The unused export canvas is cropped to `40 27 370 148`, with a margin around
the artwork, then uniformly scaled by one half. The resulting background,
overlay and board view all use `0 0 185 74`. Source IDs are namespaced and
the PCB fill still follows the application setting. The TH Köln mark sits
inside the unlabelled MCU body, clear of contacts and controls.
Editor namespace aliases are omitted from the generated root so it remains
a real SVG when the application inserts it into HTML.

The generator deliberately accepts only the source's closed circular and
axis-aligned rectangular contours. If a future source changes those shapes
or header counts, it fails so the geometry and pin order can be reviewed.

```sh
npm run test:unit:app -- tests/client/components/nano-artwork-alignment.test.tsx tests/client/components/arduino-board-views.test.tsx
npm run test:e2e -- e2e/nano-artwork.spec.ts e2e/nano.spec.ts
```

The browser checks every target while resizing, then runs a real Nano
sketch to exercise D2, both A6/A7 inputs, serial input, LEDs and reset.

## ATtiny85

`npm run generate:attiny85-svg` draws a bare DIP-8 package and its pin
overlay (`ATtiny85.svg`, `ATtiny85-overlay.svg`). The viewBox and board
view are `0 0 168 112`. The dark moulded body has bevels, a top notch,
pin-1 mark and etched lettering; all eight leads have metallic shading.
There is no carrier PCB, external LED, reset pushbutton or board logo.
The chip keeps its dark package colour independently of PCB colour settings.

Physical pins 1–4 run down the left, 8–5 down the right. The five usable
ATTinyCore pins PB0–PB4 have targets directly on their metal lead faces.
Physical pin 1 (PB5/RESET), VCC and GND remain passive as before. Analog
aliases, PWM and the software UART are unchanged; `LED_BUILTIN` still
names PB1 in the core, but the bare chip has no physical LED.

Inactive overlay markers are transparent so the metal stays visible;
active states and input frames retain the existing pin colour semantics.
The shared renderer tolerates absent LED/reset elements, and
`BoardView.logo: false` suppresses the external mark for this chip only.

```sh
npm run test:unit:app -- tests/client/components/attiny-chip-artwork.test.tsx
npm run test:e2e -- e2e/attiny-chip-artwork.spec.ts e2e/attiny85.spec.ts
```
