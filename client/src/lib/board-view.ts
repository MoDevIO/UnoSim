import { type BoardId, DEFAULT_BOARD_ID } from "@shared/boards";

/**
 * The graphics of a board for the board view (plan P4.4): the board SVG, the overlay with the
 * interactive parts (ids `pin-<n>-click`, `pin-A<k>-…`, `led-l|on|tx|rx`, `reset-click`) and the
 * size of the drawing without its safe margin, which the view scales to the available space.
 */
export interface BoardView {
  readonly boardSvg: string;
  readonly overlaySvg: string;
  readonly width: number;
  readonly height: number;
  /** Native drawing viewport width relative to Uno, including labels and intrinsic margins. */
  readonly relativeWidth: number;
  /** TH Köln mark position in percent; Uno placement when absent, false for a bare chip. */
  readonly logo?: { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | false;
}

/** The mark's place on the Uno: on the lower right of the ATmega chip. */
export const DEFAULT_LOGO_PLACEMENT = { left: 70, top: 66, width: 24, height: 8 } as const;

const UNO_VIEW: BoardView = { boardSvg: "/ArduinoUno.svg", overlaySvg: "/ArduinoUno-overlay.svg", width: 285.2, height: 209, relativeWidth: 1 };
// Supplied Nano artwork: export margins removed, uniformly scaled to half its SVG units.
// The mark fits inside the unlabelled MCU body, clear of contacts, LEDs and reset.
const NANO_VIEW: BoardView = {
  boardSvg: "/ArduinoNano.svg", overlaySvg: "/ArduinoNano-overlay.svg", width: 185, height: 74, relativeWidth: 0.85,
  logo: { left: 39, top: 50, width: 10, height: 10 },
};

// The supplied Mega artwork, uniformly scaled to a quarter of its original SVG units.
// The mark sits between ICSP and the right header, clear of the LEDs and the Arduino logo.
const MEGA_VIEW: BoardView = {
  boardSvg: "/ArduinoMega.svg", overlaySvg: "/ArduinoMega-overlay.svg", width: 438.905, height: 213.765, relativeWidth: 1.25,
  logo: { left: 80, top: 45, width: 16, height: 9 },
};

// Bare DIP-8 package; contacts are the chip leads, without carrier, external LEDs or reset switch.
const ATTINY85_VIEW: BoardView = {
  boardSvg: "/ATtiny85.svg", overlaySvg: "/ATtiny85-overlay.svg", width: 168, height: 112, relativeWidth: 0.65,
  logo: false,
};

const VIEWS: Record<BoardId, BoardView> = { uno: UNO_VIEW, nano: NANO_VIEW, mega2560: MEGA_VIEW, attiny85: ATTINY85_VIEW };

/** The view of a board. */
export function boardView(board: BoardId = DEFAULT_BOARD_ID): BoardView {
  return VIEWS[board] ?? UNO_VIEW;
}

const PRESENTATIONS = Object.values(VIEWS);
const REFERENCE_WIDTH = Math.max(...PRESENTATIONS.map(view => view.relativeWidth));
const REFERENCE_HEIGHT = Math.max(...PRESENTATIONS.map(view => view.relativeWidth * view.height / view.width));

function compactRelativeWidth(view: BoardView, unoWidth: number): number {
  const contrast = 0.6 + 0.4 * Math.max(0, Math.min(1, (unoWidth - 160) / 120));
  return 1 + (view.relativeWidth - 1) * contrast;
}

/**
 * Fits a common envelope rather than maximising each board independently. Uno is the width unit;
 * the selected hierarchy applies exactly once that unit can be at least 280 CSS px wide.
 * Compact panels soften the contrast continuously, keeping the same order and reference for all boards.
 */
export function boardDisplayScale(board: BoardId, width: number, height: number, margin = 4): number {
  if (![width, height, margin].every(Number.isFinite)) return 0;
  const padding = Math.max(0, margin) * 2;
  const innerWidth = width - padding;
  const innerHeight = height - padding;
  if (innerWidth <= 0 || innerHeight <= 0) return 0;

  const fullUnit = Math.min(innerWidth / REFERENCE_WIDTH, innerHeight / REFERENCE_HEIGHT);
  const view = boardView(board);
  if (fullUnit >= 280) return fullUnit * view.relativeWidth / view.width;

  // Base contrast on the fitted Uno width itself. Using the full-contrast estimate
  // could strengthen contrast while height already limits the actual drawing,
  // making the smaller boards shrink when only panel width grows.
  let lower = 0;
  let upper = Math.min(innerWidth, innerHeight / (UNO_VIEW.height / UNO_VIEW.width));
  for (let iteration = 0; iteration < 32; iteration++) {
    const unit = lower + (upper - lower) / 2;
    const fits = PRESENTATIONS.every(candidate => {
      const candidateWidth = unit * compactRelativeWidth(candidate, unit);
      return candidateWidth <= innerWidth && candidateWidth * (candidate.height / candidate.width) <= innerHeight;
    });
    if (fits) lower = unit;
    else upper = unit;
  }
  return lower * compactRelativeWidth(view, lower) / view.width;
}
