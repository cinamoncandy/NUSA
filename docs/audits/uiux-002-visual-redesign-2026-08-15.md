# UIUX-002 visual redesign evidence

Base: `616d7a5737c49f79fcf4cba3e7d3fcad7b72fdb7`

This pass is an actual visual redesign of the shared mobile shell, not a copy-only cleanup. The implementation keeps the existing data, navigation, PAPER-only, and AI zero-authority contracts.

## Code-level before/after evidence

| Surface | Before | After | Evidence |
| --- | --- | --- | --- |
| Global theme | graphite background with equal-weight surfaces | deep navy/black background, two raised surface levels, restrained cyan/purple signal palette, stronger numeric scale | `apps/mobile/src/designSystem.ts` |
| Home | large number with separate flat signal trace | bordered hero composition with PAPER state, equity, PnL, and a bounded terrain/convergence signal | `apps/mobile/src/homeView.tsx`, `apps/mobile/src/components.tsx` |
| Markets | repeated bordered rows | card-free list rhythm with hairline separators, fixed numeric column, and secondary volume | `apps/mobile/src/watchlistView.tsx` |
| Chart | summary card and smaller plot | current-price lead, actual-candle signal cue, 300px plot, reduced status chrome | `apps/mobile/src/chartView.tsx` |
| Bottom navigation | pill-like active background and uniform indicator | dark nav surface, restrained active surface, cyan active rail, unchanged five route contracts | `apps/mobile/App.tsx` |

## Motion and accessibility

`MotionReveal` remains bounded and reduced-motion aware. `TerrainSignal` is static and derives its bounded strength from the current state or actual candle count; it has no looping timer or random data. The existing 48pt action targets and semantic tab/button roles remain covered by the UI regression suite.

## Validation

- `pnpm run typecheck`
- `pnpm run lint:mobile`
- `pnpm run build`
- focused visual and UI contract tests: 30 passed

Physical phone/tablet screenshots, Android rendering, orientation, and reduced-motion device verification remain HUMAN_ENVIRONMENT_ONLY.
