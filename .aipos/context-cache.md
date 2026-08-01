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

Current mission: AC-002-paper-ledger-projection. Added deterministic Paper ledger replay with sequence, duplicate, before/after-state, invalid-fill, and oversell validation; focused accounting tests 15/15 and CI-mode build pass. Broker mutation is still authoritative, so accounting ownership transfer remains. Release installer/Shadow remain environment-gated.
