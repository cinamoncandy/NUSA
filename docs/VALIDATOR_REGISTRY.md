# Validator Registry

`scripts/` contains ~40 `validate-*.js` guards. This registry maps every guard
to one of 3 tiers so contributors know what to run. The per-file scripts remain
the source of truth; `scripts/validate-tiers.js` is a convenience runner.
- `node scripts/validate-tiers.js --tier=safety` — fail-closed authority gates
- `node scripts/validate-tiers.js --tier=architecture` — module/topology Truth gates
- `node scripts/validate-tiers.js --tier=aipos` — continuity/provenance gates
- `node scripts/validate-tiers.js --tier=all` — all three, in order
- Append `--report-only` to collect failures without stopping at the first one.

## Tier: safety (authority can never drift)

| Script | Guards |
|--------|--------|
| `validate-safety-architecture.js` | `config/safety/architecture.json` shape + `evaluateSafetyAction()` |
| `validate-safety-invariants.js` | safety/shadow/restricted-live config coherence |
| `validate-ai-zero-authority.js` | cloud + desktop + autopilot AI surfaces: no execution imports (static + dynamic), no `BOUNDED_LIVE`, no mutation calls |
| `validate-hard-risk-killswitch.js` | hard-risk kill-switch latch |
| `validate-shadow-governance.js` | shadow governance envelope |
| `validate-restricted-live-governance.js` | restricted-LIVE stays `DISABLED`/governance-only |
| `validate-read-only-broker-credential-integration.js` | read-only credential integration (no `submitOrder`) |
| `validate-tiny-bounded-live-envelope.js` | tiny LIVE envelope stays `POLICY_VALIDATION_ONLY` |
| `check-safety-input-literals.js` | safety input literals |

## Tier: architecture (topology Truth)

| Script | Guards |
|--------|--------|
| `validate-architecture.js` | core architecture contracts |
| `validate-research-architecture.js` | research architecture contracts |
| `validate-architecture-surfaces.js` | surface allowlist |
| `validate-architecture-change-lifecycle.js` | change lifecycle |
| `validate-repository-truth.js` | repository Truth (`pnpm run architecture:truth`) |
| `validate-capability-registry.js` | capability registry |
| `validate-champion-challenger.js` | champion/challenger promotion gates |
| `validate-data-strategy-identity.js` | data/strategy identity |
| `validate-deployment-bundles.js` | deployment bundles |
| `validate-desktop-runtime.js` | desktop runtime boundary (requires `dist/` build output) |

## Tier: aipos (continuity)

| Script | Guards |
|--------|--------|
| `validate-aipos-drift.js` | AIPOS drift |
| `validate-aipos-cross-ai-conformance.js` | cross-AI conformance |
| `validate-aipos-evidence.js` | evidence packages |
| `validate-aipos-work-order-provenance.js` | work-order provenance |

## Ungrouped (run via their own package.json scripts)

Release, packaging, platform, and audit-replay guards are intentionally out of
the 3 tiers: `validate-package.js`, `validate-windows-package.js`,
`validate-release-process.js`, `validate-production-release-artifact-seal.js`,
`validate-android-release-contract.js`, `validate-repository-portability.js`,
`validate-firebase-config.js`, `validate-disaster-recovery-restore.js`,
`validate-audit-incident-replay.js`, `validate-live-governance-state.js`,
`validate-post-live-session-validation.js`,
`validate-external-readonly-environment-preflight.js`,
`validate-restricted-live-{activation-ceremony,capability-surface,environment-preflight}.js`,
`validate-controlled-scale-up-governance.js`,
`validate-constitutional-human-transition-review.js`,
`validate-read-only-operator-projection.js`, `validate-workflow-action-pins.js`.
`validate-runtime-diagnostics.js` is also ungrouped: it requires
`--input <absolute.json>` plus built artifacts
(`pnpm run runtime:diagnostics-validate`), so it is not a zero-arg tier gate.

## Coverage floors (enforced)

- `config/coverage/floors.json` holds unified-total floors (statements/lines/functions 85,
  branches 70), set ~8 points below the measured 2026-09-04 baseline
  (93.25/77.94/93.73/93.25). Raise only with a recorded decision.
- `node scripts/check-coverage-floor.js` (`pnpm coverage:floor`) fails closed on
  breach. It reads `coverage/unified-summary.json`, so it runs after the merge step.
- CI enforces it additively in the `coverage` job right after `Merge coverage baseline`.
  Existing coverage steps are untouched.
- Critical-path aggregate floors (`criticalFloors` in the same file) guard
  ledger/accounting/portfolio/recovery/risk/market/strategy/execution/order
  modules against targeted erosion that totals would hide.
- Pinned per-module floors (`moduleFloors`: 10 safety-critical modules,
  lines+branches ~5 points below measured) close the remaining hole: a single
  module collapsing while totals and the aggregate still pass. Each entry must
  match exactly one summary module; zero or ambiguous matches fail explicitly
  so renames force a floors update instead of silently passing.
- Renderer 0% triage (2026-09-04 baseline): the ten 0% renderer files
  (`app-*.js`, `brand-ui.js`, `component-library.js`, `components.stories.js`,
  `mobile-view-model.js`, `product-screens.js`, `renderer.js`, `theme-provider.js`)
  are all live (loaded via `index.html`, storybook glob, or package validation)
  and asserted on as source text. 0% is a measurement artifact: browser scripts
  execute outside V8 instrumentation and Chromium E2E JS is uninstrumented by
  design. `tests/theme-provider-execution.vitest.js` executes the theme provider
  under jsdom as the first behavioral renderer test; extending this pattern is
  tracked work, not a gate.
- `vitest.config.mjs` `coverage.thresholds` (lines/functions/statements 50,
  branches 40) apply only when coverage is explicitly enabled
  (`vitest run --coverage`); the default `pnpm test:ui` run is unaffected.

## Composition (why some checks run twice)

Validators compose; this is intentional, not duplication to delete:

- `validate-safety-invariants.js` internally requires `validate-safety-architecture`,
  `validate-shadow-governance`, `validate-restricted-live-governance`, and spawns
  `validate-ai-zero-authority.js`. Running `safety:invariants` alone covers the
  whole safety tier.
- `validate-aipos-cross-ai-conformance.js`, `validate-aipos-evidence.js`,
  `validate-aipos-work-order-provenance.js`, and `validate-repository-truth.js`
  all share `validate-aipos-drift.js` as a library (no double execution cost).
- Consequence: `pnpm run validate:full` runs the AI guard and the safety
  architecture check twice (once via `validate`, once inside `safety:invariants`).
  This is accepted: each gate stays meaningful standalone (the lightweight
  `pnpm run validate` path must not depend on the full suite), and every
  composed check completes in seconds. Do not "optimize" this away without a
  recorded architecture decision.
