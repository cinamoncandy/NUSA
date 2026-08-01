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

Current mission: EP06-007-mobile-security-complete. Mobile Security now covers native secure storage, biometric/PIN authentication, trusted-device verification and lifecycle, plus encrypted session persistence, refresh, expiry, revocation, and multi-device trust checks. Security tests pass 22/22; integration/recovery/Ledger/Offline/Risk tests pass 61/61; typecheck/build/lint/diff PASS. Native device identity and platform runtime verification remain outstanding.

Latest repository audit: `docs/audits/nusa-audit-report-2026-08-01.md`; current HEAD `ae969207f610de5c95ab893812efd969b981ebfd`; typecheck, lint, and full isolated tests PASS (280 files). Coverage, Electron smoke, installer, real Upbit runtime, and Shadow remain unverified or blocked.
