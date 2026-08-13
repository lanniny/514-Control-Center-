# 514 Forge — v4.0 design system

Vanilla-CSS design layer for the control-center SPA. No build step, no CDN,
no new dependencies. Load order (after `styles.css` / `atelier.css`):

1. `forge/tokens.css` — OKLCH design tokens
2. `forge/motion.css` — durations, easings, keyframes, motion utilities
3. `forge/primitives.css` — restyle of existing generic controls + new primitives

Equal-specificity rule: forge CSS loads last, so redeclaring the same selector
wins the cascade. Avoid `!important` except inside utilities and the
`prefers-reduced-motion` blocks.

## Tokens (`tokens.css`)

Light lives on `:root`, dark overrides on `[data-theme="dark"]`.

- Core: `--background --foreground --card --card-foreground --muted --muted-foreground --border --input --ring`
- Primary (Claude humanist copper `#D97757`, OKLCH-derived): `--primary --primary-foreground --primary-hover --primary-soft`
- Semantic (+ `-soft` variant each): `--success --warning --danger --info`
- Agent brand: `--agent-claude --agent-codex --agent-grok --agent-kimi --agent-pi --agent-cursor`
- Radius: `--radius` (10px base), `--radius-sm/md/lg/xl/2xl/3xl/4xl` = 6/8/10/14/18/22/26px
- Elevation: `--shadow-sm/md/lg/xl/2xl`
- Type: `--text-xs/sm/base/lg/xl/2xl/3xl` = 11/12.5/14/16/20/24/30px;
  headings use `font-weight:600; letter-spacing:-0.02em` (see `.forge-h1/h2/h3`)
- z-index: `--z-base/raised/dropdown/sticky/overlay/drawer/modal/toast/palette/tooltip`

Utilities: `.num` (tabular-nums — use for every metric/timestamp/counter).

## Motion (`motion.css`)

- Durations `--dur-fast/med/slow/slower` = 100/150/240/300ms; easings `--ease-out`, `--ease-spring`.
- `.forge-enter` — fade + zoom-95 entrance, 100ms.
- `.forge-shimmer` — gradient text sweep (text only, uses `bg-clip:text`).
- `.forge-press` — 1px dip on `:active`.
- `.forge-pulse-dot` — status dot pulse.
- `.forge-conic-spin` — conic-gradient loader ring (`@property --forge-angle`; static fallback).
- `.forge-spin` — transform spinner (e.g. on the `loader-circle` icon).

Everything is disabled under `prefers-reduced-motion: reduce`. Any new
animation you add must honor that too.

## Primitives (`primitives.css`)

Restyles existing classes: `.button` (+`.primary/.secondary/.danger`),
`.icon-button`, `.text-button`, `.metric-card`, `.action-dialog`,
`.command-palette`, `textarea`/`input`/`select`, app scrollbars, `kbd`.

New primitives for forge views:

- `.forge-card` (+ `.forge-card-interactive` for hover-lift cards)
- `.forge-glass` — translucent blurred surface
- `.forge-badge` / `.forge-pill` (+ `-primary/-success/-warning/-danger/-info`)

## Icons (`../lucide.js` + `../lucide-sprite.svg`)

UI copy must contain **zero emojis** — use Lucide icons only.

```js
import { lucideIcon } from "./lucide.js";

lucideIcon("search");                        // default "icon lucide" classes
lucideIcon("sparkles", "icon icon-lg");      // custom classes
lucideIcon("loader-circle", "icon forge-spin", 14); // explicit size
```

Allowed names = whatever is listed in `../lucide-icons.json` (`icons` array).
Do not reference icon names that are not in the manifest. To add one, extend
`scripts/vendor-lucide.mjs` and regenerate the sprite (offline, from the
vendored `lucide` package — never hotlink a CDN; server CSP is
`script-src 'self'`). Legacy `#icon-*` sprite ids keep working via
`remapLegacyIconUses()`; `stop-circle` was renamed upstream to `circle-stop`.

## Hard rules

- No emojis in any UI string. Icons via `lucideIcon()` only.
- No external CDN/network fetches; no new dependencies; no build step.
- UI copy stays 简体中文.
- Honor `prefers-reduced-motion` for new animations.
- Null-guard mount points — containers may not exist yet.
