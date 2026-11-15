# Stage B (orders), the steps after the controller install, and the later phases

Date: 2026-11-16. Status: PLAN, not an approval. Nothing here starts, releases or changes anything on the host.
Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, Release=HOLD.
Server work (terminal, release, restart) only on weekday evenings after 19:00 KST for two weeks from 2026-11-15 (owner constraint); weekends are free.

## 1. Stage B: what is really blocking orders

Stage B (the order path ON) needs, in this order: the permit fix (#3108) merged and released, a known Release HOLD/WIP evidence source, and a fresh written owner approval (`docs/PAPER_RESTART_RUNBOOK_2026-11-14.md`, B.1 to B.3). The controller install does not change this; it only makes starting and stopping safe.

### 1.1 The defect, read from `main` (apps/cloud/src/cloudPaperExecutionBoundary.ts)

Two calls reach the simulator after the canonical Risk gate says `ALLOW`, and neither checks a canonical trade permission:

| Path | Call | Where |
| --- | --- | --- |
| Continue an already working strategy order | `loop.advanceStrategyWorkingOrder(working.id, tick)` | after `riskGate.evaluate({ path: "STRATEGY", ...continue })` |
| Create a new strategy order | `loop.processTick({ ...tick, quantity, executionIntent })` | after `riskGate.evaluate({ path: "STRATEGY", ...})` |

The engine and its contract exist (`apps/cloud/src/tradePermissionEngine.ts`, `evaluateTradePermission`, decisions `PERMIT` | `REJECT`); nothing in the boundary calls them. Manual fill and cancel paths are risk-gated and already carry an approver. Risk-reducing cancels (superseded binding, sub-minimum BUY) are not new exposure and stay allowed.

### 1.2 The fix, in one sentence

Before either call above, require a latest, unexpired `PERMIT` from the canonical engine bound to the same decision, strategy (candidate), market, policy version and probability-model version; anything else (absent, REJECT, stale, mismatched, UNKNOWN, replayed) returns `BLOCKED` with a stable reason code and has no side effect (no order, fill, ledger write or progression). No synthetic permit; no change to risk budgets, fill accounting or authority limits.

### 1.3 Tests the fix must come with (from the #3108 acceptance list)

1. For each of the two calls: no PERMIT, REJECT, expired, and each mismatch (decision, strategy, market, policy, model) never reaches the loop; assert the loop call count is 0 and the state is unchanged.
2. Restart/replay/restore: a restored working order with an old permit is blocked; a duplicate with the same identity is not applied twice.
3. Risk `ALLOW` alone does not pass; a daily-risk reset does not pass.
4. Positive path: a matching unexpired PERMIT reaches the existing path and the result equals today's result.
5. Through the production entry (child process, as `production-entry-boot-modes.test.js` does), not only the unit.
6. Mutation checks: removing the permit check, checking only one of the two calls, or comparing only some bound fields must fail tests.

### 1.4 What blocks starting this work (needs the owner)

Issue #3108 says: with the Coordinator WIP/Lease `UNKNOWN`, no implementation code, claim, dispatch, new PR or rollout. That is the owner's own rule, so no agent session starts the code until the owner decides one of:

| Option | Meaning |
| --- | --- |
| A. Lift for #3108 now | The owner records that the Coordinator evidence source is gone (Cloudflare removal is planned) and the permit fix may proceed as one draft PR with the normal review, exact-head CI, Audit and release. |
| B. Wait for S1 | Keep #3108 blocked until the replacement WIP/Release-HOLD source (phase S1) exists. Orders stay OFF meanwhile. |

Recommendation: A, because the fix only makes the system stricter (it adds a refusal), it cannot cause an order, and every later gate stays. Orders remain OFF until B.3 either way.

## 2. After `--apply` of the controller (all read-only unless stated)

| Check | How | Pass |
| --- | --- | --- |
| Install result | the script's final `status` output | `DONE controller installed`, runtime verified in COLLECT_ONLY |
| Mode and build | `/health` runtime fields | `runMode=COLLECT_ONLY`, `sourceCommitSha` equals the staged build, `orderPathReady` reported but no approval |
| Orders | host diagnose + env file | no order, no fill since the restart; order switch still OFF |
| Gate | a reboot-free test is NOT done; the verify timer's first run | timer ran, reports no mismatch |
| Rollback ready | `install.sh <sha> --rollback` exists and refuses on any altered file | documented, not run |
| Records | an evidence PR with the outputs (no tokens) | merged |

Rollback rule: if `--apply` fails at any step it prints the rollback command; the units end stopped and nothing orders. The owner decides whether to roll back (it restarts the old way) or to stay stopped.

## 3. Later phases (design only, each a separate PR and approval)

| Phase | What | Needs the server? |
| --- | --- | --- |
| C5 phone | One workflow from protected main with the owner as required reviewer; buttons `stop` and `collect` only; no `grant-orders` until #3108 is merged and independently verified. Alerts: GitHub mobile notifications first; a read-only watch every 15 minutes failing on mode mismatch, wrong unit state, stale events, any order while not granted. | Install of a sudoers rule (owner, evening) |
| S1 to S5 Cloudflare removal | Replace the WIP/Release-HOLD evidence source, then remove the worker, coordinator and its merge gate. | No, until the last step |
| C6 cleanup | Delete the superseded release-decision logic after the controller's first successful release; move shared code (rate limiter, replay) out of apps that are deleted. | No |
| C7 strategy review | Review of the strategies that feed the order path before any Stage B. | No |

## 4. Order of work

1. Tonight (after 19:00 KST): run the re-checked preflight with the merged `install.sh`, send its output.
2. If it shows `0 failure(s)`: `--apply`, then the section 2 checks.
3. Owner decision on 1.4 (A or B).
4. If A: the permit fix as one draft PR with independent review.
5. Only after that and a fresh owner approval: Stage B per the runbook.
