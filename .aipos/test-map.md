# NUSA Test Map

- Core/runtime: tests/core-runtime.test.js, runtime and lifecycle suites.
- Market data: tests/upbit-websocket.test.js, tests/market-connection-reconnect.test.js, tests/closed-candle-adapter.test.js.
- Paper execution/accounting: paper broker, fill, balance, position, PnL, and order suites.
- Recovery: tests/recovery-reconciliation.test.js, tests/crash-recovery-marker.test.js, tests/sqlite-recovery-drill.test.js.
- Risk: tests/global-risk-gateway.test.js, tests/risk-safety-drills.test.js, tests/independent-risk-gateway.test.js.
- Renderer contract: tests/electron-renderer-bootstrap.test.js, tests/electron-preload-renderer-contract.test.js, tests/simple-paper-ui.test.js.
- Browser: tests/e2e/component-library.spec.js, tests/e2e/mobile-renderer.spec.js.
- UI component suite: tests/*.vitest.js.
