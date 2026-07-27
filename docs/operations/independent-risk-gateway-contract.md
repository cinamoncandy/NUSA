# Independent Paper Risk Gateway and Deployment Safety Gate (WO-0032)

## Purpose

Two pure decision functions that stand between a Paper trading intent and its execution:

- `evaluatePreTradeRisk` — may this one order proceed, right now, under these conditions?
- `evaluateDeploymentSafety` — may this build run Paper automation at all?

Both are read-only. They never mutate the request, the account, or any execution state,
never place an order, and never grant authority: `productionMutationAllowed` is `false` on
every decision either of them can produce. Neither is Live Trading capability, and neither
creates one.

## Two properties that carry the whole design

### 1. Every declared reason code is enforced

The contract in `packages/contracts/src/riskGateway.ts` declares 40 pre-trade reason codes
and 10 deployment reason codes. **Every one of them is reachable.**

This was the main defect corrected while completing WO-0032. The first implementation
declared 41 pre-trade codes but could only ever emit 28: order rate limits, same-side burst,
daily buy/sell notional caps, symbol and portfolio exposure caps, daily loss, consecutive
loss, session drawdown, and price deviation were all declared and never checked, and
`DEPLOYMENT_INTEGRITY_FAILED` had no input that could set it. A gateway that advertises a
limit it never enforces reads as coverage that does not exist — which is worse than not
declaring the limit, because a reviewer sees the code name and assumes the check.

`tests/independent-risk-gateway-coverage.test.js` holds this in place two ways: it parses
the contract's own type union and asserts it equals the evaluator's `RISK_REASON_ORDER`,
and it crafts one request per code and asserts each code is actually produced. Adding a
code to the contract without wiring it fails the suite.

### 2. Fail closed

Missing, malformed, or non-finite state is `INVALID_REQUEST` and **halts**. It is not a
skipped check. A check that cannot read its input is indistinguishable from a check that
passed, so the gateway refuses rather than proceeding on partial state — including when the
caller omits an entire state block such as `sessionState` or `deploymentState`, and
including a `null` request, which returns a decision rather than throwing.

## Severity: HALT vs REJECT

`RISK_REASON_ORDER` is both the report order and the severity order. Every code at or before
`OPEN_P0_ALERT` produces `HALT`; everything after produces `REJECT`.

The distinction is deliberate. `REJECT` means *this order* was not acceptable — too large,
duplicate, out of cash. `HALT` means the *operating envelope itself* is broken: a live
trading capability was detected, the deployment does not match what was reviewed, the kill
switch is on, approval is missing or expired, persistence or reconciliation is unhealthy, or
a P0 alert is open. Those are not conditions a smaller order would fix.

Halting codes, in order: `INVALID_REQUEST`, `LIVE_CAPABILITY_DETECTED`,
`PRIVATE_API_CAPABILITY_DETECTED`, `DEPLOYMENT_INTEGRITY_FAILED`, `KILL_SWITCH_ACTIVE`, the
four fingerprint mismatches, the three approval codes, `PERSISTENCE_UNHEALTHY`,
`RECONCILIATION_FAILED`, `OPEN_P0_ALERT`.

## What is checked

| Group | Codes |
| --- | --- |
| Safety envelope | live capability, private-API capability, deployment integrity, kill switch |
| Identity | strategy, config, runtime, and risk-policy fingerprint mismatches |
| Authorization | approval missing, expired, out of symbol scope |
| Infrastructure | persistence unhealthy, reconciliation failed, open P0 alert |
| Market data | stale, reconnecting, warming up, gap, out of order, invalid, price deviation |
| Idempotency | duplicate signal, command, client order id |
| Rate | orders per second, orders per minute, same-side streak, open order count |
| Size and exposure | order notional, position notional, symbol exposure, portfolio exposure, daily buy notional, daily sell notional |
| Sufficiency | insufficient cash, insufficient position |
| Circuit breakers | daily loss, consecutive losses, session drawdown |

Fingerprint checks exist because an order produced by a build that changed underneath the
gateway is not an order the gateway was configured to guard. Price deviation exists because
a feed can report itself `HEALTHY` while the caller prices off something stale.

## Deployment safety gate

Evaluated before Paper automation is allowed to start. Every reason code halts — there is no
degraded-but-allowed deployment.

`LIVE_TRADING_CAPABILITY_PRESENT`, `PRIVATE_API_CAPABILITY_PRESENT`,
`CREDENTIAL_STORAGE_PRESENT`, `RISK_GATEWAY_ABSENT`, `KILL_SWITCH_UNREACHABLE`,
`AUTO_TRADE_DEFAULT_ON`, `ARTIFACT_HASH_MISMATCH`, `SOURCE_COMMIT_MISMATCH`,
`PERSISTENCE_SCHEMA_MISMATCH`, `INVALID_DESCRIPTOR`.

`AUTO_TRADE_DEFAULT_ON` is treated as a deployment defect rather than a preference: after an
install or an upgrade, nobody chose it for that deployment.

## Independent verification

`scripts/lib/paper-risk-gateway-verifier.js` deliberately does **not** import the evaluator
or its compiled output. It re-implements the rules from the contract and compares status,
reason codes, canonical ordering, and both hashes. A verifier that asked the evaluator for
the answer would confirm a buggy evaluator rather than catch it — the same principle applied
in WO-0029's regime verifier and WO-0031's promotion gate.

If the two ever disagree, that disagreement is the finding; neither side is authoritative
alone. The verifier additionally enforces one rule unconditionally: **any finding at all
forbids `ALLOW`.**

## Determinism

Both functions are pure. Identical inputs produce identical decisions and identical hashes;
there is no wall-clock read anywhere — `evaluatedAt` is copied from the request. Decisions
are frozen, as are their reason-code arrays.

## Input sources

The gateway consumes state it does not itself produce. Two of the four required sources now
exist; two do not.

### Fingerprints — `apps/desktop/src/runtimeFingerprint.ts`

`deriveStrategyFingerprint`, `deriveConfigFingerprint`, `deriveRuntimeFingerprint`, and
`deriveRiskPolicyFingerprint` produce the four identities the gateway's mismatch checks
compare against. Pure, deterministic, key-order independent, domain-prefixed.

The design point is which failure mode was chosen. A fingerprint over a hand-picked subset
of fields goes stale silently: a field added later is not covered, so the digest stays
identical while behaviour changes, and the gateway allows orders from a build it was never
configured for. A fingerprint over "whatever object was passed" is noisy instead: key order
and stray properties leak in, mismatches become routine, and operators learn to ignore them.

This module takes the subset approach and makes its failure **loud** — each input has an
explicitly enumerated field set and an unknown key is a thrown `FingerprintInputError`, not
an ignored one. Adding a field to a config type forces a decision here instead of silently
widening a blind spot. `RISK_POLICY_FINGERPRINT_KEYS` is asserted in tests to equal
`IndependentRiskLimits`'s own key set, so a limit added to the gateway and not to the
fingerprint fails the suite rather than becoming a limit that can be relaxed invisibly.

### Deployment descriptor — `scripts/build-deployment-descriptor.js`

Produces a `DeploymentSafetyDescriptor` from the repository as it actually is:
`artifactSha256` is a real deterministic tree hash (sorted relative paths plus per-file
digests, so a pure rename changes it), `sourceCommitSha` comes from git, and the capability
flags come from a source scan.

Two honesty constraints are built into the output rather than left to a reader:

- **A scan proves presence, never absence.** `liveTradingCapabilityPresent: false` means no
  known pattern matched — not that the build provably cannot trade live. The artifact records
  `capabilityEvidence.method: "STATIC_SOURCE_SCAN"` and `provesAbsence: false` so the flag
  cannot later be read as a proof. `killSwitchEvidence.provesRuntimeReachability` is `false`
  for the same reason: locating the entry point is not a drill.
- **An unsupplied expectation is a vacuous check.** When `--expected-artifact` or
  `--expected-commit` is omitted, the expected value is set equal to the observed one, which
  makes `ARTIFACT_HASH_MISMATCH` and `SOURCE_COMMIT_MISMATCH` unreachable for that
  descriptor. `provenance.expectationsSupplied` lists which comparisons are real, and the
  CLI says so on stdout.

### Approval and reconciliation primitives — `apps/desktop/src/paperSafetyGates.ts`

`verifyApproval` (expiry, symbol scope, fingerprint agreement) and `reconcilePaperLedger`
(duplicate fills, orphan sells, invalid fills, recomputed cash/position/PnL) supply the
`approvalState` and `reconciliationState` inputs. `verifyDeployment` compares an expected
deployment manifest against an observed one.

These are primitives, not a wired pipeline: nothing yet composes them, the fingerprint
derivations, and the deployment descriptor into a `PreTradeRiskRequest`.

## Current production wiring: fail closed

`RuntimeCommandService` now requires a `PaperCommandRiskGate` and calls it before every
manual and strategy order; a non-`ALLOW` decision throws before `PaperBroker` is reached, so
a rejected order cannot fill.

**In `apps/desktop/src/main.ts` — the only production construction — the injected gate
returns `HALT` unconditionally with `RISK_GATE_NOT_CONFIGURED`.** The practical consequence
is that the shipped Electron app currently refuses *every* Paper order, manual and
automatic alike.

That is the correct default and it should stay until a real gate is composed. The
alternative — injecting a permissive gate so the app keeps trading — would put a control in
the architecture that always says yes, which is exactly the failure this contract exists to
prevent. But it is a real behavioural change and must not be discovered by surprise: anyone
running the desktop app will see every order rejected until the composition below exists.

## What is NOT done, and why

Composing a real gate still requires: building a `PreTradeRiskRequest` at the call site from
the four fingerprints, a live approval record, a ledger reconciliation result, a deployment
descriptor, and the rate/exposure/session counters — none of which are currently tracked
per session — and then calling `evaluatePreTradeRisk` instead of the stub.

Until that exists, WO-0031's D-010 stays `INCONCLUSIVE`: a gate that halts everything proves
that the call site is guarded, not that a working risk policy is in force.

## Known limitations

- Rate, exposure, and session state are **supplied by the caller and trusted**. The gateway
  verifies internal consistency and finiteness, not that the caller counted correctly.
- Limits are configuration. This module enforces them; it does not decide whether they are
  the right numbers.
- Deployment integrity is asserted by a descriptor, not measured by this module. Producing
  a trustworthy descriptor (real artifact hashing at build time) is separate work.
- Paper fills differ from real exchange fills; nothing here is Live Trading evidence.
- The production strategy, symbol, fee/PnL formulas, and existing risk limits are unchanged.
  This work only adds checks — it relaxes none.
