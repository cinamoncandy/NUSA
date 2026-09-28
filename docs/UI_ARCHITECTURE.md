# NUSA mobile UI architecture

The current mobile design ("field-v1") is an **interim** design. This guide describes the structure
that lets a future, fuller redesign replace the presentation without touching data, safety,
navigation or authority. It is a presentation guide only: it grants no LIVE, credential,
production-mutation or AI authority.

## Layers

| Layer | Where | Rule |
| --- | --- | --- |
| Canonical data | `personalPaperOperationsClient`, contracts in `packages/contracts` | Untrusted until validated at the trust boundary. |
| Screen models | `homeFieldInput.ts`, `intelligenceFieldModel.ts`, `fieldScreensModel.ts`, `homeDecisionSurface.ts`, `homeStatusRail.ts` | Pure, frozen, no React Native imports. Uncertainty must never read as healthy. Tested behaviourally. |
| Design tokens | `designSystem.ts` (`fieldPalette`, `fieldMotion`, theme), `fieldFonts.tsx` | The only place colours, motion timing and typography are defined. |
| Presenters | `homeView.tsx`, `paperShadowMonitorView.tsx`, `liveReadinessMonitorView.tsx`, `moreMenuView.tsx`, `tabTransition.tsx`, `intelligenceField.tsx`, `fieldHeader.tsx` | Render screen models with tokens. No derivation of safety state. |
| Presentation boundary | `presentation.tsx` | `App.tsx` imports every screen presenter from here only. |

## How to ship a redesign

1. Design the screens first (canvas prototype, owner approval).
2. Build new presenters that consume the **existing** screen models; add screen models for anything a
   presenter currently derives inline (follow `homeFieldInput.ts`).
3. Swap the exports in `presentation.tsx` (and bump `PRESENTATION.id`). `App.tsx`, data, navigation
   and safety wiring do not change.
4. Retune or replace `fieldMotion` / palette tokens rather than hard-coding timing or colours.
5. For a GPU particle field (the approved canvas prototype), evaluate a renderer such as React Native
   Skia behind the same `IntelligenceField` props; it is a new dependency and needs licence and
   APK-size review.
6. Validate on a physical device (HUMAN_ENVIRONMENT_ONLY) with owner screenshots.

## Test policy

- New UI tests assert **screen models and contracts** (see `tests/mobile-home-field-input.test.js`),
  not presenter source text.
- Source-text assertions are acceptable only for safety/authority wiring that has no runtime seam
  (for example "App imports presenters only via the boundary", "no LIVE action exists").
- When a redesign changes a presenter, migrate any source-pinning test it breaks to a behavioural
  test of the underlying screen model instead of re-pinning the new markup.

## Migration backlog

83 test files currently read presenter source text. They are the main cost of a redesign; migrate
them to screen-model tests as each screen is redesigned.

| Test file | Presenter sources read |
| --- | --- |
| `tests/live-readiness-observability.test.js` | `App.tsx` |
| `tests/mobile-ai-authority-copy.test.js` | `components.tsx` |
| `tests/mobile-app-update-continuity.test.js` | `App.tsx` |
| `tests/mobile-brand-concept1.test.js` | `App.tsx`, `components.tsx` |
| `tests/mobile-build-source-ui.test.js` | `homeView.tsx` |
| `tests/mobile-cash-allocation-uiux-v3.test.js` | `App.tsx`, `homeView.tsx`, `settingsView.tsx`, `portfolioView.tsx`, `tradingViewLegacy.tsx` |
| `tests/mobile-chart-ui.test.js` | `App.tsx`, `marketsView.tsx` |
| `tests/mobile-connection-failure-visibility.test.js` | `settingsView.tsx` |
| `tests/mobile-credential-failure-reason.test.js` | `settingsView.tsx` |
| `tests/mobile-design-system-v1.test.js` | `components.tsx` |
| `tests/mobile-design-system.test.js` | `components.tsx` |
| `tests/mobile-entry-screen-preset.test.js` | `App.tsx` |
| `tests/mobile-field-screens.test.js` | `App.tsx`, `homeView.tsx`, `paperLearningMonitorView.tsx` |
| `tests/mobile-frontend-input-connection-resilience.test.js` | `settingsView.tsx`, `components.tsx`, `tradingViewLegacy.tsx` |
| `tests/mobile-frontend-lifecycle-resilience.test.js` | `App.tsx` |
| `tests/mobile-frontend-premium-ux.test.js` | `components.tsx`, `tradingViewLegacy.tsx`, `marketsView.tsx`, `orderHistoryView.tsx` |
| `tests/mobile-frontend-system-primitives.test.js` | `components.tsx` |
| `tests/mobile-home-ai-surface.test.js` | `homeView.tsx`, `intelligenceOs.tsx` |
| `tests/mobile-home-capital-hierarchy.test.js` | `homeView.tsx`, `portfolioView.tsx` |
| `tests/mobile-home-master-shell.test.js` | `App.tsx`, `homeView.tsx`, `primaryNavigation.tsx`, `intelligenceOs.tsx` |
| `tests/mobile-home-paper-provenance.test.js` | `homeView.tsx` |
| `tests/mobile-home-public-market-fallback.test.js` | `App.tsx`, `homeView.tsx` |
| `tests/mobile-home-signal-density.test.js` | `homeView.tsx` |
| `tests/mobile-home-status-rail.test.js` | `homeView.tsx` |
| `tests/mobile-home-supervision-cta.test.js` | `homeView.tsx` |
| `tests/mobile-home-supervisor-risk-spine.test.js` | `homeView.tsx` |
| `tests/mobile-home-why-evidence-drill.test.js` | `homeView.tsx` |
| `tests/mobile-intelligence-field.test.js` | `homeView.tsx` |
| `tests/mobile-intelligence-os-v1.test.js` | `homeView.tsx`, `paperLearningMonitorView.tsx`, `portfolioView.tsx`, `marketsView.tsx`, `intelligenceOs.tsx` |
| `tests/mobile-local-paper-immediate.test.js` | `App.tsx`, `tradingViewLegacy.tsx` |
| `tests/mobile-local-paper-issue-772.test.js` | `App.tsx` |
| `tests/mobile-local-paper-ledger-issue-637.test.js` | `homeView.tsx`, `portfolioView.tsx`, `tradingViewLegacy.tsx` |
| `tests/mobile-markets-observation-first.test.js` | `marketsView.tsx` |
| `tests/mobile-markets-ui.test.js` | `App.tsx`, `homeView.tsx`, `marketsView.tsx` |
| `tests/mobile-native-structure.test.js` | `App.tsx`, `primaryNavigation.tsx` |
| `tests/mobile-notification-system.test.js` | `App.tsx`, `settingsView.tsx` |
| `tests/mobile-offline-wiring.test.js` | `App.tsx`, `tradingViewLegacy.tsx` |
| `tests/mobile-order-history.test.js` | `App.tsx`, `orderHistoryView.tsx`, `uxPrimitives.tsx` |
| `tests/mobile-owner-connection-settings-integration.test.js` | `settingsView.tsx` |
| `tests/mobile-pairing-source-contract.test.js` | `settingsView.tsx` |
| `tests/mobile-paper-ai-behavior-observatory.test.js` | `App.tsx`, `tradingViewLegacy.tsx` |
| `tests/mobile-paper-autoconnect.test.js` | `App.tsx` |
| `tests/mobile-paper-learning-data-source.test.js` | `App.tsx`, `paperLearningMonitorView.tsx` |
| `tests/mobile-paper-learning-outcome-clarity.test.js` | `paperLearningMonitorView.tsx` |
| `tests/mobile-paper-real-use-ui.test.js` | `App.tsx`, `homeView.tsx`, `settingsView.tsx`, `paperLearningMonitorView.tsx`, `portfolioView.tsx`, `tradingViewLegacy.tsx`, `marketsView.tsx` |
| `tests/mobile-paper-session-projection-invariant.test.js` | `App.tsx`, `homeView.tsx` |
| `tests/mobile-paper-session-single-owner.test.js` | `App.tsx` |
| `tests/mobile-porcelain-cobalt.test.js` | `homeView.tsx` |
| `tests/mobile-portfolio-supervision-first.test.js` | `portfolioView.tsx` |
| `tests/mobile-portfolio-supervision-hierarchy.test.js` | `portfolioView.tsx` |
| `tests/mobile-portfolio-ui.test.js` | `App.tsx`, `portfolioView.tsx` |
| `tests/mobile-presentation-boundary.test.js` | `App.tsx` |
| `tests/mobile-product-v5.test.js` | `App.tsx`, `homeView.tsx`, `settingsView.tsx`, `intelligenceOs.tsx` |
| `tests/mobile-settings-ui.test.js` | `App.tsx`, `settingsView.tsx` |
| `tests/mobile-settings-usage-telemetry-optin.test.js` | `settingsView.tsx` |
| `tests/mobile-supervision-navigation.test.js` | `App.tsx`, `primaryNavigation.tsx` |
| `tests/mobile-trade-public-chart-visibility.test.js` | `App.tsx`, `marketsView.tsx` |
| `tests/mobile-trading-readonly-state.test.js` | `tradingViewLegacy.tsx` |
| `tests/mobile-trading-ui.test.js` | `App.tsx`, `tradingViewLegacy.tsx` |
| `tests/mobile-ui-hotswap-contract.test.js` | `App.tsx`, `homeView.tsx` |
| `tests/mobile-uiux-final-residual.test.js` | `App.tsx`, `homeView.tsx` |
| `tests/mobile-uiux-min-path.test.js` | `homeView.tsx`, `components.tsx` |
| `tests/mobile-uiux-phase1-state-architecture.test.js` | `App.tsx`, `homeView.tsx`, `settingsView.tsx`, `paperLearningMonitorView.tsx`, `tradingViewLegacy.tsx` |
| `tests/mobile-uiux-readonly-authority.test.js` | `App.tsx`, `settingsView.tsx`, `components.tsx`, `tradingViewLegacy.tsx` |
| `tests/mobile-uiux-supervisor-progress.test.js` | `homeView.tsx` |
| `tests/mobile-uiux-v2.test.js` | `App.tsx`, `homeView.tsx`, `portfolioView.tsx`, `tradingViewLegacy.tsx`, `marketsView.tsx`, `uxPrimitives.tsx` |
| `tests/mobile-uiux-v3-canonical.test.js` | `App.tsx`, `homeView.tsx`, `settingsView.tsx`, `portfolioView.tsx`, `tradingViewLegacy.tsx`, `marketsView.tsx`, `orderHistoryView.tsx`, `primaryNavigation.tsx` |
| `tests/mobile-uiux-visual-redesign.test.js` | `App.tsx`, `homeView.tsx`, `components.tsx`, `primaryNavigation.tsx`, `uxPrimitives.tsx` |
| `tests/mobile-upbit-public-quotation.test.js` | `App.tsx` |
| `tests/mobile-upbit-readonly-bridge.test.js` | `App.tsx`, `settingsView.tsx`, `portfolioView.tsx` |
| `tests/mobile-upbit-settings-connection.test.js` | `App.tsx`, `settingsView.tsx`, `portfolioView.tsx` |
| `tests/mobile-watchlist.test.js` | `App.tsx`, `marketsView.tsx`, `uxPrimitives.tsx` |
| `tests/owner-device-mobile-source-contract.test.js` | `settingsView.tsx` |
| `tests/p8-private-readonly-runtime-session.test.js` | `App.tsx` |
| `tests/paper-connection-resume.test.js` | `App.tsx` |
| `tests/personal-paper-order-retry-identity.test.js` | `tradingViewLegacy.tsx` |
| `tests/uiux-002-final-p1-closeout.test.js` | `App.tsx`, `homeView.tsx`, `portfolioView.tsx`, `tradingViewLegacy.tsx`, `intelligenceOs.tsx`, `uxPrimitives.tsx` |
| `tests/uiux-002-phase1-ai-state.test.js` | `tradingViewLegacy.tsx`, `marketsView.tsx` |
| `tests/uiux-002-phase1-state-architecture.test.js` | `tradingViewLegacy.tsx`, `marketsView.tsx` |
| `tests/uiux-002-phase2-visual-foundation.test.js` | `components.tsx` |
| `tests/uiux-authority-hierarchy-closeout.test.js` | `tradingViewLegacy.tsx` |
| `tests/uiux-market-density-closeout.test.js` | `marketsView.tsx` |
| `tests/uiux-nav-chrome-closeout.test.js` | `App.tsx`, `primaryNavigation.tsx` |
