# Next Task

## Current baseline

### WO-0033 phase 3: verified Paper pilot promotion boundary

Shadow and Canary Pilot Evidence is now independently verified, hash-sealed, and
aggregated into `PAPER_PILOT_OPERATIONAL_EVIDENCE`. The promotion gate is evidence-only:
it never changes runtime mode. Current repository evidence contains no operational
Shadow or Canary sessions, so the only truthful result is `OBSERVATION_INCOMPLETE` and
D-010 cannot be STRONG. An independently sealed owner review is required after the
documented operational criteria are met. Live trading, private API access, credentials,
and automatic Extended Paper activation remain absent.

### WO-0034-A1: public ticker closed-candle adapter

The pure Upbit public ticker adapter now emits deterministic 1-minute UTC closed candles
and exposes gap, out-of-order, duplicate, disconnect, reconnect, and closed-candle
warm-up state. It is not wired to the desktop runtime, StrategyEngine, Shadow sessions,
or operational Evidence. Operational Shadow and Canary Evidence remain zero; A2 owns
the explicit runtime wiring and lifecycle boundary.

### WO-0034-A2: closed-candle runtime wiring and Shadow owner lifecycle

`apps/desktop/src/shadowOperationalRuntime.ts` wires the real public Upbit ticker stream
through `ClosedCandleAdapter` into the production `StrategyEngine` -- which is now called
from exactly one place in the codebase, once per closed candle, never per raw ticker --
and, separately and only while an owner-started Shadow session is `RUNNING`, into
`ShadowPilotRuntime` as a hypothetical fill. Real Automatic Paper trading and Shadow are
two independent dispatches from the same signal; Shadow calls neither `PaperBroker` nor
`RuntimeCommandService.manualOrder` (verified structurally: the compiled module contains
no reference to either). Shadow's risk decision reuses the real `PaperCommandRiskGate`
instance -- currently an unconditional `HALT` stub, so Shadow inherits that same honest,
unconfigured state rather than a separately fabricated `ALLOW`.

Owner-controlled `shadow:start/pause/resume/stop/status` IPC commands exist with an
exact-allowlist payload validator (`shadowIpcValidation.ts`) and a fail-closed lifecycle
(`IDLE -> PRECHECK -> READY -> RUNNING -> PAUSED -> COMPLETED`, with `HALTED`/`FAILED`
failure states); duplicate start, resume-when-not-paused, and stop-when-not-active all
throw rather than silently no-op. See `docs/operations/shadow-operational-runtime.md` and
`docs/operations/shadow-owner-lifecycle.md`.

**The current runtime composition is fail-closed but no longer a hard-coded unresolved
stub.** `main.ts` derives deployment integrity from the compiled runtime assets and
derives Paper reconciliation independently from the persisted Paper ledger and account
snapshot. A fresh, healthy Paper database with an empty ledger can therefore pass those
two checks. A persisted safety snapshot, recovery ambiguity, mutation counter, ledger
mismatch, or unavailable persistence keeps the gate blocked and requires the documented
reconciliation/owner-review path. The shared configured risk gate still refuses any
uncertain request, and `productionMutationAllowed` remains false.

Shadow's durable Evidence archive, completion verification, and reconnect diagnostics are
now present in the runtime composition. They do not turn a rehearsal into operational
Evidence: the repository still has no real operational sessions, and the promotion gate
must remain `OBSERVATION_INCOMPLETE` until the runbook's operator-collected criteria are
met. Canary remains untouched.

### Control Room UI (design system, first slice)

The desktop renderer now opens with system state instead of price:
`apps/desktop/renderer/control-room.{js,css}` mounts a status panel above the price hero and
the chart, and `tests/control-room.test.js` asserts that ordering so a later layout change
cannot quietly put the chart back on top. It surfaces the six status tiles, the mode banner
(mode + 실제 주문 가능 여부 + 자동 재개 허용 여부, always in words), a next-action line, and
the Shadow `start/pause/resume/stop/status` controls — closing the renderer gap disclosed in
WO-0034-A2. Risk Gateway reads `HALT` and reconciliation reads 확인 필요 because that is the
true current state, not a placeholder success. Brand assets live in
`apps/desktop/renderer/assets/`; `build/icon.png` is the packaged app icon via
electron-builder's default resource path, so `package.json` was not touched. Only the 관제실
layer is built — the other six sections of the design system are specified but not yet
implemented. See `docs/operations/control-room-ui.md`.

Development continues on `agent/electron-upbit-paper-trading` in Draft PR #1.

Implemented and continuously validated:

- SQLite-backed Paper and Control persistence with default-off recovery;
- deterministic backtest, Walk-Forward, dataset provenance, Research Memory, and cost stress;
- PAPER/DRY_RUN Strategy Governance and Investment Committee controls;
- read-only AI CIO Electron dashboard with fail-closed source availability;
- Paper portfolio, bounded risk, and synthetic execution projections;
- runtime health, recovery, typed fault-drill evidence, and release-readiness contracts;
- operational completion policy with calendar and scenario-based Paper validation profiles.
- deterministic Rules Control Plane v0.1 with immutable published rule/policy versions, declarative fail-closed evaluation, replayable decision traces, and SQLite ledger snapshots; it remains recommendation-only and does not create execution authority.
- Multi-Agent Decision Governance v0.2 with role-bound Agent Registry, evidence/context integrity checks, independent risk veto, deterministic zero-authority aggregation, immutable incident containment recommendations, zero-authority certification, and replayable SQLite audit state; no agent runtime or provider access exists.

The consolidated lifecycle and explicit command boundaries are documented in `docs/operations/OPERATIONS_PLAYBOOK.md`.

### WO-0027: Walk-Forward request/result contract layer

`scripts/lib/walk-forward-runner.js` and `scripts/lib/walk-forward-verifier.js` add a
request/result contract (training+validation+test windows, an explicit SMA parameter
grid, `FIXED_PARAMETER_5_20`/buy-and-hold/cash benchmarks, deterministic hashing, and an
independent verifier) on top of the existing `walkForwardEngine.ts`/`backtestEngine.ts`/
`researchDataset.ts` lineage referenced above -- it does not replace that lineage, and it
does not introduce the `MarketCandle`/`HistoricalDatasetDescriptor` contracts that a
prior work-order draft assumed already existed (they do not; see
`docs/research/walk-forward-contract.md` for the full scope decision and disclosed
deviations, chiefly: same-candle-close fill rather than next-candle, and a single
dataset content hash rather than a source/normalized pair). Only synthetic fixtures have
been run so far (`tests/fixtures/walk-forward/basic-walk-forward.json`); no real
historical dataset has been executed through this layer, and no production SMA
parameter has changed as a result of this work. Owner review is still required before
any of this research feeds a Paper-promotion decision.

### WO-0028: SMA parameter-neighborhood robustness layer

`scripts/lib/parameter-robustness-runner.js` and `scripts/lib/parameter-robustness-verifier.js`
add a candidate-neighborhood/plateau-classification layer around a reference SMA
parameter (immediate-neighbor agreement, local smoothness, cost-stressed survival under
three fixed BASE/MODERATE/SEVERE conditions), reusing the same production Backtest
Engine and WO-0027's generic windowing/compounding helpers -- see
`docs/research/parameter-robustness-contract.md` for the full scope decision and
classification thresholds. Only a synthetic fixture has been run
(`tests/fixtures/parameter-robustness/basic-robustness.json`); no production SMA
parameter changed.

### WO-0029: market-regime performance analysis layer

`scripts/lib/regime-analysis-runner.js` and `scripts/lib/regime-analysis-verifier.js`
add segment building, one-trade-one-regime attribution, per-regime metrics under three
fixed cost conditions, transition analysis, a rare-regime sample gate, and fixed
assessment rules on top of the **existing, already tested** trailing-only classifier in
`apps/desktop/src/marketRegime.ts` — no second classifier was written. The independent
verifier deliberately re-implements the labeling rather than calling that classifier,
so a classifier bug cannot hide behind its own verifier. Threshold source is
`FIXED_ABSOLUTE` (training-quantile mode is not implemented and is rejected rather than
coerced); see `docs/research/market-regime-contract.md` for all disclosed deviations.
Only a synthetic fixture has been run (`tests/fixtures/regime-analysis/mixed-regimes.json`);
no production strategy setting changed, and no regime filter was added to the strategy.

### WO-0030: cross-market / cross-period validation layer

`scripts/lib/cross-market-validation-runner.js` and
`scripts/lib/cross-market-validation-verifier.js` evaluate one frozen strategy over a
market x period cell matrix under three fixed cost conditions, with `CASH`,
`BUY_AND_HOLD`, and `FIXED_SMA_5_20` benchmarks, separate `fullAvailablePeriod` and
`commonPeriod` cohorts, market/period summaries, concentration analysis, and a fixed
generalization assessment. See `docs/research/cross-market-validation-contract.md`.

Two findings from dogfooding are baked in. First, a fixed order quantity across markets
at different price levels buys wildly different notional exposure, so an early run
reported "100% of profit concentrated in KRW-BTC" when that was purely an artifact of
BTC's price level; concentration is now reported `NOT_COMPARABLE` and withheld when the
notional spread exceeds tolerance. Second, `dataProvenance` gates the verdict: with
`SYNTHETIC_FIXTURE` data the `researchAssessment` is forced to `INCONCLUSIVE` no matter
what the numbers say, and the computed pattern is surfaced only as
`syntheticPatternObserved`. Only synthetic fixtures have been run; no production
strategy or symbol changed.

### WO-0031: Strategy Research Scorecard

`scripts/lib/strategy-research-scorecard.js` binds the WO-0025--WO-0030 evidence classes through immutable linkage tuples and canonical payload hashes. It is read-only and zero-authority: it does not rerun research, modify strategies, place orders, or allow production mutation.

### WO-0031: strategy research promotion gate (parallel second layer)

**Two WO-0031 layers now exist on this branch and neither has been removed.** The
evidence-seal layer above and the promotion gate described here were written in parallel,
use different request shapes, and do not import each other. Consolidating onto one is an
open owner decision.

`scripts/lib/strategy-research-evidence-manifest.js`,
`scripts/lib/strategy-research-promotion-gate-runner.js`,
`scripts/lib/strategy-research-promotion-gate-verifier.js`, and
`scripts/run-strategy-research-promotion-gate.js` consolidate the same eight evidence
classes into ten scored dimensions and one gate decision. It **reads declared evidence and
never recomputes or rewrites any research result**. Three rules are enforced in code
rather than left as caveats: there is no single numeric total score (a weighted total would
let a data-integrity failure be averaged away), `executionStatus` and `researchDecision`
are separate fields, and synthetic evidence can never promote. D-008/D-009 have no evidence
entry of their own and inherit the worst trust of the analyses they read, which closed a
hole where a synthetic benchmark comparison escaped the synthetic downgrade. A D-010
failure — a discovered live-trading capability, a failing kill switch, or non-atomic
persistence — is a hard stop that forces `INVALID`, not a hold. The verifier does not call
the runner's dimension evaluators or its decision helper; it re-derives the gate outcome,
so recomputing a hash over tampered content does not get past it. See
`docs/research/strategy-research-promotion-gate-contract.md`.

**Applied to this repository's actual state, the decision is `INSUFFICIENT_EVIDENCE`**
(`docs/research/strategy-research-decision.md`): every research result here was produced
from synthetic fixtures, `COST_STRESS` evidence is absent, and D-010 cannot exceed
`INCONCLUSIVE` without an independent risk gateway and real Paper acceptance evidence.
D-002 (backtest integrity) is legitimately `STRONG` because that is a property of the code;
no market-performance claim follows from it. No production strategy parameter or symbol
changed.

### WO-0032: independent Paper risk gateway and deployment safety gate

`apps/desktop/src/independentRiskGateway.ts` provides two pure decision functions —
`evaluatePreTradeRisk` (may this order proceed now?) and `evaluateDeploymentSafety` (may
this build run Paper automation at all?) — over the contract in
`packages/contracts/src/riskGateway.ts`. Both are read-only and zero-authority:
`productionMutationAllowed` is `false` on every decision either can produce. See
`docs/operations/independent-risk-gateway-contract.md`.

The main defect corrected while completing this work: the contract declared 41 pre-trade
reason codes but the evaluator could only ever emit 28. Order rate limits, same-side burst,
daily buy/sell notional caps, symbol and portfolio exposure caps, daily loss, consecutive
loss, session drawdown, and price deviation were declared and never checked, and
`DEPLOYMENT_INTEGRITY_FAILED` had no input that could set it. A gateway that advertises a
limit it never enforces reads as coverage that does not exist. All 40 pre-trade codes and
all 10 deployment codes are now enforced, and
`tests/independent-risk-gateway-coverage.test.js` parses the contract's own type union and
asserts every code is reachable, so adding a code without wiring it fails the suite. Missing
or malformed state now fails closed as `INVALID_REQUEST` and halts, instead of silently
skipping the checks that would have read it.
`scripts/lib/paper-risk-gateway-verifier.js` re-implements the rules from the contract
without importing the evaluator, so a buggy evaluator is caught rather than confirmed.

Two of the four state sources the gateway consumes now exist.
`apps/desktop/src/runtimeFingerprint.ts` derives the strategy, config, runtime, and
risk-policy fingerprints; it enumerates each input's fields explicitly and **throws on an
unknown key** rather than ignoring it, because a fingerprint that silently fails to cover a
new field leaves the gateway allowing orders from a build it was never configured for.
`RISK_POLICY_FINGERPRINT_KEYS` is asserted to equal `IndependentRiskLimits`'s key set, so a
limit added to the gateway and not to the fingerprint fails the suite instead of becoming a
limit that can be relaxed invisibly. `scripts/build-deployment-descriptor.js` produces a
real deployment descriptor — deterministic tree hash of the build output, git commit, and a
capability scan — and records in the artifact itself that a scan proves presence and never
absence, and that an unsupplied `--expected-*` value makes the corresponding gate comparison
vacuous.

`apps/desktop/src/paperSafetyGates.ts` supplies the remaining primitives — `verifyApproval`
(expiry, symbol scope, fingerprint agreement), `reconcilePaperLedger` (duplicate/orphan/
invalid fills with recomputed cash, position, and PnL), and `verifyDeployment`.

**Production wiring is fail-closed and now uses a composed read-only gate.**
`RuntimeCommandService` now requires a `PaperCommandRiskGate` and calls it before every
manual and strategy order, throwing before `PaperBroker` is reached on any non-`ALLOW`
decision. In `apps/desktop/src/main.ts` — the only production construction — the injected
gate returns `HALT` unconditionally with `RISK_GATE_NOT_CONFIGURED`, so **the shipped
Electron app refuses every Paper order, manual and automatic alike.** That is the right
default and should stay: injecting a permissive gate to keep the app trading would put a
control in the architecture that always says yes. But it must not be discovered by surprise.

Composing a real gate still requires building a `PreTradeRiskRequest` at the call site from
the four fingerprints, a live approval record, a ledger reconciliation result, a deployment
descriptor, and per-session rate/exposure/session counters that are not currently tracked.
Until then WO-0031's D-010 stays `INCONCLUSIVE`: a gate that halts everything proves the
call site is guarded, not that a working risk policy is in force.

Current runtime wiring has since been composed in `main.ts`: deployment asset verification,
independent Paper ledger reconciliation, persisted safety controls, market state, runtime
fingerprints, and declared exposure/session limits feed the shared gate. The gate rejects
missing or uncertain inputs and `productionMutationAllowed` remains false. The older
description above is retained as historical context; current readiness still requires real
Paper evidence and owner review of the matching evidence bundle.

### WO-0033/WO-0034 status: BLOCKED

WO-0033 (Shadow/Canary Paper Pilot) and WO-0034 (Extended Paper + release readiness)
were requested but remain BLOCKED. Their stated prerequisites -- WO-0029 (Regime
Analysis), WO-0030 (Cross-Market Validation), WO-0031 (Strategy Research Scorecard), and
WO-0032 (Independent Risk Gateway) -- did not exist when WO-0033/0034 were first
requested and have since been implemented; that removes the first reason but not the
second, which is decisive on its own: both work orders' actual deliverable is real
multi-week Windows
GUI evidence, a real extended public-market connection, real installer/upgrade/rollback
drills, and real owner sign-off -- none of which a sandboxed session can produce.
Building synthetic "pilot" evidence and labeling it as satisfying WO-0033/0034 would be
exactly the kind of unverified claim those work orders themselves prohibit (see their
own "SNS External Claim Policy" section), so this was refused rather than fabricated.

## Current verified GitHub state

At the last repository inspection:

- PR #1 was open, Draft, and mergeable;
- branch HEAD before the playbook documentation commits was `7b2b486c2710753395c29f235217ce7d04632306`;
- Windows CI run #1196 passed for that HEAD;
- no unresolved inline review threads were present;
- release readiness remained blocked pending real Paper evidence and owner review.

These values become stale after any new commit. Re-query GitHub and require CI for the latest HEAD before changing PR state.

## Active validation profile

The owner does not plan to wait for a 30-day Paper calendar period. Use `SCENARIO_BASED` explicitly.

Required evidence:

- 20 observed Paper sessions;
- 50 completed Paper orders;
- 3 represented market regimes;
- 3 restart-recovery passes;
- 10 duplicate-order checks;
- persistence failure, WebSocket disconnect, partial-write, duplicate-signal, and Kill Switch scenarios;
- Walk-Forward, deterministic Monte Carlo, cost-stress, and Integrity PASS.

This replaces only elapsed calendar duration. It does not replace CI, recovery, source coverage, security review, provenance, checksums, or owner approval.

## Remaining Codex work

1. Keep the latest branch HEAD green in Windows CI.
2. Connect actual Opportunity, Committee, and Strategy analytics sources to the read-only dashboard only under an explicitly approved scope.
3. The Research section now reads persisted manifest/report pairs with checksum matching. It requires deterministic Monte Carlo, Walk-Forward, Cost Stress, and Integrity reports; keep every other unavailable source explicit and the completion gate blocked until they are connected.
4. Improve operator tooling only when it generates typed, immutable, independently verifiable Paper evidence.
5. Resolve new Critical/High findings or record an explicit owner decision.
6. Keep LIVE trading, private APIs, credentials, withdrawal actions, automatic promotion, and automatic release disabled.
7. Keep PR #1 Draft and unmerged until latest-HEAD CI, real evidence, and owner review are complete.
8. Before distribution, provide an application icon, an owner-approved code-signing certificate, a portable-artifact decision, and real Windows GUI measurements for startup time, memory, scaling, keyboard-only, and screen-reader checks. The current unsigned NSIS build is technical packaging evidence only.
9. Extend Rules Control Plane v0.1 only through separately reviewed increments: formula registry, policy composition, explicit simulation/shadow reporting, query projections, CLI/dashboard, and certification workflows. Do not introduce dynamic code execution or authority creation.
10. Extend Multi-Agent Governance only through reviewed zero-authority increments: governed fixtures, calibration history, read-only projections, and operator-reviewed remediation. Do not add prompt/provider secrets, an order path, majority override, or automatic authority expansion.

## Remaining operator and owner work

1. Run the Electron application in the intended Windows environment.
2. Collect real scenario-based Paper sessions and completed orders.
3. Run supported SQLite recovery, WebSocket reconnect, duplicate-signal, Kill Switch, persistence-failure, and partial-write drills.
4. Export and verify the current evidence bundle without manual database manipulation.
5. Review reports, checksums, limitations, and remaining risks.
6. Explicitly decide whether PR #1 may move from Draft to Ready.

## Validation commands

```text
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm test
pnpm run release:check
pnpm package:win
```

Windows CI is the authoritative clean-checkout result. Never claim completion while required CI is failing, pending, stale, or scenario evidence is incomplete.
