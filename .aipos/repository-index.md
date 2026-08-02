# NUSA Repository Index

Audited: 2026-08-01

- Product: NUSA Upbit spot Paper Trading desktop application.
- Runtime: TypeScript, Node.js 24+, pnpm 11+, Electron.
- Core runtime: packages/core/src.
- Desktop renderer: apps/desktop/renderer.
- Desktop main/preload: apps/desktop/src.
- Paper and execution domain: apps/execution/src.
- Contracts: packages/contracts/src.
- Durable storage: packages/storage/src.
- AIPOS source of truth: .aipos/.
- Build: pnpm run build.
- Isolated suite: pnpm test.
- UI suite: pnpm run test:ui.
- Browser suite: pnpm run test:e2e.
- Windows config validation: pnpm run package:validate.

Safety boundaries:

- Paper Trading is the only executable trading mode.
- Live/private exchange mutation and credentials remain disabled.
- Renderer uses the existing preload bridge.
- Uncertainty remains fail-closed.
