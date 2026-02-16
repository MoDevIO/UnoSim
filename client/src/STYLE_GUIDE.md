STYLE GUIDE — color tokens

Purpose
- Use the semantic CSS variables defined in `client/src/index.css` and the Tailwind mapping in `tailwind.config.ts`.
- Do NOT add raw hex literals in `client/src`—use token classes or CSS variables instead.

Common tokens (token name → hex value → suggested Tailwind mapping)

| Token (CSS var) | Hex | Tailwind token / class example |
|---|---:|---|
| --color-brand-primary | #0f7391 | `text-brand-primary` / `bg-brand-primary` |
| --color-ui-background | #121212 | `bg-ui-background` |
| --color-ui-foreground | #fafafa | `text-ui-foreground` |
| --color-ui-panel | #1c1c1c | `bg-ui-panel` |
| --color-ui-border | #262626 | `border-ui-border` |
| --color-status-success | #22c55e | `bg-status-success` / `border-status-success` |
| --color-status-error | #ef4444 | `bg-status-error` |
| --color-status-warning | #f97316 | `bg-status-warning` |
| --color-accent-cyan | #06b6d4 | `text-accent-cyan` |
| --color-accent-blue | #3b82f6 | `text-accent-blue` |

How to use
- Prefer Tailwind token classes (example: `className="bg-status-success"`).
- For inline styles that must use a color value, reference the CSS variable: `style={{ color: "var(--color-brand-primary)" }}`.

Why this rule exists
- Centralized tokens make theme changes (dark/light, brand updates) safe and testable.
- Visual baseline tests depend on consistent semantic tokens.

Where tokens are defined
- CSS variables: `client/src/index.css`
- Tailwind mapping: `tailwind.config.ts`

If you need a new semantic token
- Add the variable in `client/src/index.css`, map it in `tailwind.config.ts`, and update `STYLE_GUIDE.md` with an example.
