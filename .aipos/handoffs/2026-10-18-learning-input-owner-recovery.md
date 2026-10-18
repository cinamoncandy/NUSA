# Learning Loop recovery and convergence state

Fresh GitHub snapshot, 2026-10-18: protected `main` is `3659e45e011032b71e37896eed7c3aef2580c153`.

## Canonical stack

| PR | Base SHA | Head SHA | State | Exact-head CI |
|---|---|---|---|---|
| #2792 A2 | `3659e45e` | `139b4319` | OPEN/Draft | PASS, run `39128055923` |
| #2793 A1 | `139b4319` | `efbd298d` | OPEN/Draft | PASS, run `39128656554` |
| #2794 A4 | `efbd298d` | `3828be38` | OPEN/Draft | PASS, run `39129139123` |
| #2795 A3 | `1036b53b` | `8ed1941e` | OPEN/Draft | Remote base is stale; local merge onto `3828be38` is unpushed |

The #2795 repair worktree containing existing local changes is untouched. A separate clean worktree is reconverging its head onto #2794 `3828be38`; this is not yet pushed or validated. Audit/Release/merge have not run for this stack. Keep all PRs Draft until required checks and independent Audit pass.

## Production source findings

- Research decisions are durably recorded in `research_factory_decision_history`; its repository verifies the hash chain before read-back.
- Realized PAPER evidence is read from the canonical period ledger using persisted `periodEndAt`.
- The current A1 composition exposes the A2 evidence readers, but does not construct or append A2 input sets in the production caller graph.
- The canonical closed-window boundary exists as `periodEndAt`, but cutoff wiring and canonical policy identities are unresolved. Do not infer values from `Date.now`, maximum evidence timestamps, caller input, or test fixtures.
- A2 no longer fingerprints META partition membership; it rejects stale callers/receipts that still supply it. META assignment must follow A1 and use a canonical durable owner, not a caller-selected partition.
- The production A3 cycle-order/assignment owner and A3-to-A4 eligibility wiring are not verified.

## FIRST_BROKEN_TRANSITION

`canonical cutoff + policy owners → A2 build/append/read-back → A1 Decision → canonical durable META assignment/HOLDOUT → A4 eligibility/application`

Local checks for the current A2/A1/A4/A3 reconvergence: build, typecheck, `validate:full`, `security:gate`, lint, and 83 focused tests PASS. Lint has 26 existing warnings. Exact-head CI for A2, A1, and A4 passed. The A3 reconverged tree is not yet pushed or CI-verified. No independent Audit, Release, merge, or genuine end-to-end runtime/restart/replay evidence is established.

Next: complete and revalidate the #2795 reconvergence on `3828be38`; then resolve canonical cutoff/policy and META assignment owners before wiring production A2→A1→A3→A4. Do not promote guessed authority.

Preserve `PAPER_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`. `LEARNING_LOOP_VERIFIED=false`; `PERFORMANCE_IMPROVEMENT=UNPROVEN`; `AUTOPILOT_VERIFIED_COMPLETION_LOOP=false`.
