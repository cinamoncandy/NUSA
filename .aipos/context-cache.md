# NUSA Context Cache

Current branch: agent/mobile-first-ui-v1
Draft PR: https://github.com/cinamoncandy/NUSA/pull/45

Current work:

- Functional mobile-first renderer shell.
- Five shared primary navigation tabs.
- Paper status and connection state.
- Shared view-model for truthful zero/unavailable formatting.
- Paper order confirmation before the existing IPC mutation command.
- Mobile/tablet/desktop responsive behavior through shared DOM and CSS.
- Advanced operations remain reachable through the existing legacy panels.

Deferred:

- Colors, branding, icons, animation, typography, decorative charts, and pixel-level design.

Latest verified commands:

- pnpm run preflight
- pnpm run typecheck
- pnpm run build
- pnpm run lint
- pnpm test (277 isolated test files)
- pnpm run test:ui (2 files, 4 tests)
- pnpm run test:e2e (4 tests)
- pnpm run package:validate
- git diff --check
- pnpm run release:check with CI=true

Current mission: PERF-001-sma-rolling-allocation completed a measured allocation reduction in StrategyEngine. Benchmark: 143.5161ms -> 57.2973ms for 200k ticks; signals remain deterministic. Next is event-bus queue/listener measurement.
