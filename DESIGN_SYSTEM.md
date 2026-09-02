# NUSA Design System

## Purpose

NUSA is a calm, evidence-first operating console. The design system provides a dark-first visual foundation for desktop workflows without changing market, strategy, risk, execution, or persistence behavior.

`apps/desktop/renderer/tokens.css` is the only source of visual token values. Application CSS and future components consume semantic tokens, never palette values or literal colors.

## Themes

The renderer starts in `dark` mode. `contrast` strengthens text and borders for high-contrast use. `theme-provider.js` exposes `window.NUSATheme.setTheme("dark" | "contrast")` and persists the selected theme when browser storage is available. It is a renderer-only presentation helper and has no Node.js, Electron IPC, or trading-domain access.

The operating-system `prefers-reduced-motion` setting sets all motion durations to zero.

## Token usage

Use `--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, and status tokens such as `--color-success` or `--color-danger`. Do not use `--palette-*` outside `tokens.css`.

Typography roles are `display`, `heading`, `title`, `body`, `caption`, and `mono`. Use `--font-size-display`, `--font-size-heading`, `--font-size-title`, `--font-size-body`, `--font-size-caption`, and `--font-mono`.

Spacing follows a 4px base and the approved scale: `4`, `8`, `12`, `16`, `24`, `32`, `48`, `64`, `80`, and `96`. Use only `--space-*` values.

Available radius values are `sm`, `md`, `lg`, `xl`, and `full`. Available elevations are `xs`, `sm`, `md`, and `lg`. Motion uses `fast`, `normal`, and `slow`; reduced motion is automatic.

`--z-base`, `--z-raised`, `--z-dropdown`, `--z-sticky`, `--z-modal`, and `--z-toast` establish the allowed layers. Opacity and breakpoint contracts are also defined in the token file. Tailwind mirrors the same breakpoint values as static `screens`, because CSS custom properties are not valid media-query values.

## Tailwind and shadcn

`tailwind.config.cjs` maps semantic colors, typography, spacing, radius, shadows, and motion tokens to Tailwind’s theme. `components.json` tells shadcn-compatible tooling to use the same CSS variable file. Neither Tailwind nor shadcn is required by the current plain Electron renderer at runtime.

`pnpm run lint` validates renderer JavaScript without reaching into trading code. `pnpm run test:ui` runs the Vitest design-system contract. The full Node regression suite remains `pnpm test`.

## Best practices

- Use semantic intent, not visual appearance: `--color-danger`, not a red literal.
- Preserve compact, desktop-first layouts and calm surfaces.
- Keep keyboard focus visible with `--shadow-focus`.
- Do not use animation to communicate critical execution, risk, or account state.
- Do not alter product logic in UI primitives.

## Component library

`apps/desktop/renderer/components.css` provides the framework-neutral component library: Button, Card, Badge, Input, Select, Dialog, Drawer, Tooltip, Timeline, Decision Card, Evidence Row, Metric Card, Status Badge, Skeleton, Empty State, and Error State.

Use semantic HTML first. Dialogs use native `<dialog>`; drawers use `<aside>` with an accessible name; button, form, and tooltip states keep visible keyboard focus. `component-library.js` only manages dialog and drawer visibility. It must never call the trading bridge or contain domain decisions.

Run `pnpm storybook` for the interactive catalogue, `pnpm run test:ui` for Vitest contracts, and `pnpm run test:e2e` for Playwright keyboard and responsive checks.

## AI Trading Cockpit extension

The canonical product surface follows the detailed contract in `docs/NUSA_AI_TRADING_COCKPIT_DESIGN.md`.

### Hierarchy

Every primary trading surface uses this priority order:

1. execution mode, connectivity, and freshness;
2. account outcome and capital exposure;
3. NUSA/market decision context;
4. positions, Paper actions, and risk evidence;
5. analytics, history, and diagnostics.

Large financial values and safety state receive stronger visual weight than descriptive copy. Status labels remain short and task-oriented.

### Density

Cockpit density is achieved through grid alignment, compact captions, tabular numerics, sticky table headers, and aligned panel edges. Minimum touch/focus target sizes remain unchanged. Dense layout must never require tiny text to fit more information.

### Surfaces

`app.css` supplies canonical baseline behavior and responsive accessibility. `cockpit.css` may change layout, spacing, hierarchy, and visual composition only. It must not disable focus treatment, override a runtime-disabled control into an enabled state, create runtime subscriptions, or own trading decisions.

### State presentation

PAPER/live-disabled, disconnected, loading, error, blocked, empty, and unavailable states are meanings, not colors. Text or structure must communicate each state even without color perception.

Unavailable advanced risk, AI, or analytics evidence is shown as unavailable. Presentation must never invent values simply to complete a card or visual balance.

### Responsive semantics

Desktop may expose denser evidence in parallel columns. Mobile prioritizes essential financial fields, uses the five canonical primary destinations, keeps Settings separate, and converts the Paper confirmation surface to a bottom sheet. Hiding a secondary field must not change its data ownership or semantic meaning.
