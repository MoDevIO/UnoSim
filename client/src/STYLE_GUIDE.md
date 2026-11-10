# Style guide: color contract

This is the binding color contract of the UnoSim GUI. The Button SSOT
(`ssot/ssot_function_definition_Buttons.md`) and the feature SSOTs refer to it.
It covers the dark theme, which is the only theme the application ships.

## 1. Scope

The contract governs **controls, status displays and normal GUI badges**:
buttons, menus, toolbar icons, toggles, tabs, telemetry, notices and toasts.

**Content colors** are outside its role rules and documented here only so that
they are not mistaken for status:

| Content color | Where | Why it may use any hue, red included |
| --- | --- | --- |
| Physical board and part colors | board SVGs, LEDs, wires | they show the real hardware |
| Board color presets | Settings → board color | the learner chooses them; stored values stay valid |
| Syntax colors | Monaco (`vs-dark`) | editor theme |
| Plot series colors | Serial Plotter (`--plot-1` … `--plot-8`) | data series; the learner can change each |

Content colors never carry a status meaning, and a status never borrows a
content color.

## 2. Roles and tokens

Use the token, never a raw palette value. Values are the current dark-theme
values in `client/src/index.css`; contrast is against `--background`
(`#121212`) unless stated otherwise (WCAG 2.2 relative luminance, sRGB).

| Role | Token(s) | Value | Use | Contrast |
| --- | --- | --- | --- | --- |
| Text | `--foreground` | `#fafafa` | normal text | 18.0:1 |
| Secondary text, inactive | `--muted-foreground` | `#a1a1a1` | labels, hints, idle status | 7.3:1 |
| Surfaces | `--background`, `--card`, `--popover`, `--muted` | grays | panels, menus | – |
| Borders | `--border`, `--input` | `#262626` | outlines, separators | decorative |
| **Primary action / selection** | `--primary`, `--primary-hover`, `--primary-foreground` | `#15803d`, `#166534`, `#fafafa` | the one main action of a view (Start, Senden, Weiter, Übernehmen, Done), selected panel in the mobile navigation | 4.8:1 and 6.8:1 for the text on it |
| Hover surface, focus ring | `--accent`, `--ring` | green `hsl(142 86% 28%)` | hover of outline/ghost controls, focus ring | 4.6:1 for text on it; ring 4.0:1 |
| **Neutral action** | `outline`, `ghost`, `secondary` button variants | – | every other action, **including delete and clear** | as text |
| Toolbar icon hover | `--muted` | `hsl(0 0% 15%)` | hover surface of `ToolbarIconButton`, so the icon keeps its state color (active, inactive, error) on hover | state colors ≥ 4.5:1 on it |
| Run state | `--color-run-stop`, `--color-run-stop-hover` | `#c2410c`, `#9a3412` | the Stop button while a simulation runs | 5.0:1 and 7.0:1 for white |
| **Success** | `--color-status-success` | `#22c55e` | success, "in use" checkmarks, Tutor ready | 8.2:1 |
| **Warning** | `--color-status-warning` | `#f97316` | warnings, dropped serial bytes, legacy engine | 6.7:1 |
| **Error** | `--color-status-error` (text), `--destructive` (surface) | `#ff6b6b`, `hsl(0 63% 31%)` | error text, error borders, error toasts | 6.8:1; toast text 9.5:1 on its surface |
| **Information / busy** | `--color-accent-cyan` | `#06b6d4` | info, busy, telemetry values | 7.7:1 |
| Rating | `--color-rating` | `#f59e0b` | Tutor stars | 8.7:1 |
| Data: serial direction | `--color-data-rx`, `--color-data-tx` | `#60a5fa`, `#a78bfa` | RX/TX badges | 7.4:1, 6.9:1 |
| Data: active pin | `--color-data-pin-active` | `#fbbf24` | synthetic HIGH/PWM indicator on the board, mixed with black by brightness | – |
| Data categories | `client/src/lib/data-colors.ts` | Tailwind 300/400 tones | I/O modes, debug senders and protocols, file types | ≥ 4.5:1 |
| Disabled | `opacity-50` | – | disabled controls (exempt from contrast, WCAG 1.4.3) | – |

`client/src/lib/status-semantics.ts` maps application states (success, error,
warning, info, busy, idle) to these tokens; status components use it.

## 3. Rules

1. **Red means error.** In controls, status displays and badges red is
   reserved for errors. Deleting, clearing and resetting are neutral actions:
   neutral at rest, on hover and on focus. Their label, tooltip, keyboard
   access and any confirmation stay; the confirmation's action is neutral too.
2. **Roles stay apart.** Error surfaces (`--destructive`) are for error toasts
   and messages only; a button never uses them. Data categories never reuse a
   status token, and a status never uses a category color. The serial TX
   direction, a HIGH pin and a plot series are data, not errors.
3. **Never by color alone.** A status also has text or a symbol: an error
   message says what failed, a check mark is a ✓, a warning value is labeled.
4. **Contrast.** Normal text and icons with text meaning: at least 4.5:1;
   large text (≥ 18.66 px bold or ≥ 24 px) at least 3:1; boundaries and focus
   indicators of controls at least 3:1. Each state counts: rest, hover, focus,
   pressed. Disabled controls are exempt.
5. **Tokens only.** No raw hex literals and no raw Tailwind red/rose palette
   utilities in `client/src`. Add a role token instead (CSS variable in
   `index.css`, mapping in `tailwind.config.ts`, a row in this table). Dynamic
   variables that Tailwind or Radix set at runtime (for example
   `--radix-dropdown-menu-content-transform-origin`, Tailwind's own
   `--color-gray-*`) are not ours to define and must not be removed.
6. **Technical adapters.** Where an API needs a concrete value (the native
   color input of the Serial Plotter needs hex, Monaco needs theme colors), read
   it from the token at runtime instead of copying it; Monaco keeps `vs-dark`.

## 4. Gates

- `npm run check:raw-hex` — no new raw hex literals in changed files.
- `tests/client/color-contract.test.ts` — every color token that
  `tailwind.config.ts` maps is defined; the contrast pairs of section 2 meet
  their targets; no raw red/rose palette utilities; error surfaces only in the
  error role.
- `e2e/color-contrast.spec.ts` — computed colors in the browser: Start, the
  primary actions of the Tutor and the settings, the delete menu entry and its
  confirmation, clear actions, the active and inactive workspace toggles on
  hover (icon against the opaque hover surface), at rest and on hover, and that
  none of the neutral actions is red.

## 5. Visual checklist

Before a change to colors, check in the browser at normal size and at XXL:

- [ ] Start, Stop and the busy state of the simulate button: readable, Stop not red.
- [ ] Tutor: Tutor einrichten, Frage starten, Senden, Weiter, Übernehmen; error notice red with text.
- [ ] Settings dialog: Done at rest and on hover; board color presets unchanged.
- [ ] Sketch tabs: ⋯ → Delete File and its confirmation neutral, label and confirmation kept.
- [ ] Serial monitor, compiler and debug output: clear actions neutral at rest, hover and focus.
- [ ] Toolbar icons (workspace toggles, output toolbars): active, inactive and error colors readable on hover.
- [ ] Serial monitor: RX/TX badges, telemetry labels and values, dropped bytes in warning color.
- [ ] I/O Registry: green check for use, gray dash for no use, conflict marked with error color and text.
- [ ] Board: active pins amber, not red; physical parts unchanged.
- [ ] Mobile navigation: one selection color, inactive buttons gray.
- [ ] Toasts: errors red with title and text; others neutral.
