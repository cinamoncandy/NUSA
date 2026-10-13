# NUSA verification Feature Map

Use this map to turn a screenshot or symptom into a bounded reproduction. Confirm the current source SHA; selectors below are existing contracts, not evidence of runtime success.

Initial coverage is the existing desktop/component browser harness and linked integration/device paths, not every product feature. Expand the map only after verifying a path and its selectors. Control Glass is not installed or implemented by this increment.

| Feature / symptom | Entry and stable locator | Canonical source | Reproduction / evidence scope |
| --- | --- | --- | --- |
| Desktop renderer PAPER identity | `/index.html`, `getByTestId("nusa-app-root")`, text `PAPER · 실거래 비활성` | `apps/desktop/renderer/index.html`, `app-runtime.js`, `app-adapter.js` | `pnpm test:e2e`: real Chromium, mocked test-only bridge; not broker/server/device proof |
| Navigation / order confirmation | `[data-simple-nav='orders']`, `[data-simple-page='orders']`, `[data-simple-order='BUY']`, dialog `Paper 주문 확인` | `apps/desktop/renderer/index.html` markup; `app-runtime.js` behavior | `tests/e2e/mobile-renderer.spec.js`; confirmation only, no real orders |
| Responsive navigation | `.v2-sidebar`, `.v2-app`; widths 390/768/1200 | `apps/desktop/renderer/index.html`, `apps/desktop/renderer/app.css` | Same renderer E2E; mobile viewport is not React Native or Galaxy acceptance |
| Dialog / drawer accessibility | `/component-preview.html`, buttons `Open dialog`, `Open drawer`, drawer `Component drawer` | `apps/desktop/renderer/component-preview.html`, `component-library.js` | `tests/e2e/component-library.spec.js`: click, Escape, visibility and overflow |
| Desktop authenticated PAPER boundary | HTTP session and PAPER contracts | `tests/desktop-cloud-session-http-e2e.test.js`, `tests/desktop-cloud-paper-production-e2e.test.js` | Build then run these Node integration tests; test fixtures are not deployed credentials |
| Cloud recovery / replay | canonical PAPER lifecycle | `tests/actual-paper-runtime-persisted-replay.test.js`, `tests/actual-paper-runtime-e2e-chaos-boundary.test.js` | SQLite/helper fixtures and source-boundary assertions, not actual application restart proof. Operational entry: `pnpm verify:paper-runtime`, `.github/workflows/wo-0059-actual-paper-runtime.yml`; external deployed proof remains separate |
| Android connection / background recovery | native app, canonical session and DeviceKey | `apps/mobile/App.tsx` | Repository/native tests plus HUMAN_ENVIRONMENT_ONLY physical-device evidence; do not infer from desktop Chromium |

## Evidence and escalation

The renderer E2E also performs twenty synthetic navigation transitions and records fixed numeric Chromium CDP observations (task duration, used/total JS heap, nodes and documents) as test annotations. Each transition checks visibility; missing or malformed metrics fail closed. Run `pnpm test:e2e`. Compare only matched source/environment/workloads; these measurements are not a CPU trace, heap snapshot, memory-leak verdict or production benchmark. No raw heap content is captured or uploaded.

- Browser runtime and console errors fail existing E2E; raw error values are not printed by the guard.
- Existing Playwright workers are bounded to one in CI and two locally. This is browser-test capacity, not AI-worker or financial authority.
- Failure screenshots and traces use only the local synthetic test harness. Do not reuse this capture setup with credentials or private customer data.
- Bind external evidence to exact head, base, environment, command, time and result. Redact structured sensitive fields; missing evidence stays missing.
- Performance changes need a bounded CPU/heap investigation and a reproducible before/after scenario. A heap snapshot is sensitive and is not uploaded by default.
- Repeated deterministic defects become a regression or lint/CI rule with negative tests. Do not ban a framework API solely because it can be misused.
- Increase parallel WIP only after disjoint ownership, provider/runner capacity, conflict/rework and verified output per cost are measured. Existing #903 remains owner; no new agent scheduler or merge authority.
- Independent Audit and canonical Release remain mandatory. Self-review, screenshots and CI green are not Release authority.
