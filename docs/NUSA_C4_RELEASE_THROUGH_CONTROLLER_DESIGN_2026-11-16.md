# C4 design: release through the controller (2026-11-16)

Status: DESIGN for review and owner decisions. Revised after the independent review of 2026-11-16 (REJECT: P0-1 state transitions, P0-2 crash recovery, P0-3 'main moved' outcome, P1 stop priority); sections 3.1 to 3.5 answer each finding. Nothing here changes code, the host or the order switch. Safety is unchanged:
PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, orders OFF, Release=HOLD.

## 1. The problem, from 2026-11-16

With the controller installed, the start gate (`Requires=nusa-control-reconcile.service` on `nusa.service`) refuses a start unless the host
state file permits it. The release helper (`deploy/oracle/nusa-release-step.sh activate`) swaps `/opt/nusa/current` and then restarts
`nusa.service`. With state `STOPPED`, or with `state.active` different from the new build, the gate refuses that start and the activation
fails into its safe stop. So today a release needs three owner terminal sessions: roll the controller back, release, install it again. That is
the opposite of the goal (fewer terminal steps) and the controller has a `release` verb that answers "not available in this version".

## 2. Goal

One path: the protected release workflow asks the controller to release; the controller is the only thing that changes the build, the unit
state and the state file together. No rollback or reinstall around a release. No new authority: a release never grants orders.

## 3. Design

New controller verb `release <sha>` (root, under the same lock as every verb; `stop` still wins: it waits up to 90 s for the lock).

1. Preconditions, all read-only and fail closed: the release directory exists and is staged; `<sha>` is a full lowercase hash; the state file is
   valid; no intent is pending; orders are OFF from every source (the installer's `orders_off_everywhere` check, moved into the controller);
   the runtime was verified (`COLLECT_ONLY_VERIFIED`) a moment ago, or is STOPPED on purpose.
2. Write an intent `RELEASE {from, to, startedAt}` into the state file (the same durable-intent pattern as `collect`). A crash at any point leaves
   the intent; `reconcile` then treats a stale intent as "stop everything" (existing behaviour for collect).
3. Stop the runtime units (the controller already can), run the existing helper verbs `backup`, `stage` is already done by the workflow,
   `activate` is NOT used: the controller calls `atomic-deploy` itself to swap the symlink, then sets `state.active = <sha>` and
   `desired = COLLECT_ONLY` in one write.
4. Start through the normal `collect` path (start gate permits, `verifyRuntime` identifies the sender and checks build and mode). The start
   ceiling and the "no answer" retries already exist.
5. Success: clear the intent, record `proven` for `<sha>`. Failure at any step after the symlink swap: swap the symlink back to the previous
   proven build, set `state.active` back, start through `collect`; if that fails too, end STOPPED with the intent cleared and the reason
   recorded. A failed release never leaves a half state and never starts anything that was not verified.
6. The controller never sets `PAPER_ORDERS`; `grant-orders` stays "not available". A release changes the build only.

### 3.1 State machine and the start gate (answers P0-1)

The state file gets one intent kind next to `collect`: `RELEASE {from, to, phase, startedAt}` with `phase` in `PREPARED`, `UNITS_STOPPED`, `SWAPPING`, `SWAPPED`, `STARTING_NEW`, `ROLLING_BACK`, `STARTING_OLD`. Every phase change is one durable state write (write, fsync, rename, fsync the directory) BEFORE the step it announces.

The start gate (`reconcile`, run by `Requires=` on the runtime units) permits a start only in exactly these cases and denies everything else:

| State | The gate permits a start of the runtime units |
| --- | --- |
| `desired COLLECT_ONLY`, no intent, `active == current` | yes (normal) |
| intent `RELEASE`, phase `STARTING_NEW`, `current == to` | yes, only while the release verb holds the lock |
| intent `RELEASE`, phase `STARTING_OLD`, `current == from`, `from` is proven | yes, only while the release verb holds the lock |
| any other RELEASE phase, or a RELEASE intent whose lock holder is gone | no (external or boot-time starts are refused) |
| `desired STOPPED` | no |

"Holds the lock" is checked, not assumed: the gate runs `flock -n` on the controller lock and a start is permitted for a RELEASE intent only when the lock is held by another process (the release verb). With no lock holder the intent is stale and recovery (3.2) runs instead of a start.

### 3.2 Crash and failure recovery (answers P0-2)

The symlink swap, `state.active` and the unit start are not one atomic operation, so the order makes every crash point decidable by comparing three facts: the intent phase, where `/opt/nusa/current` points, and `state.active`.

| Phase when the process died | Recovery |
| --- | --- |
| `PREPARED`, `UNITS_STOPPED` | nothing was swapped: clear the intent, end STOPPED (or start the old build through `collect` if the owner runs it) |
| `SWAPPING` (the link may or may not have moved) | read the link: if it equals `from`, as `PREPARED`; if it equals `to`, continue as `SWAPPED` |
| `SWAPPED`, `STARTING_NEW` | the new build was never verified: move the link back to `from`, set `active = from`, phase `ROLLING_BACK`, then `STARTING_OLD` |
| `ROLLING_BACK`, `STARTING_OLD` | finish the rollback to `from` if `from` is proven (a recorded proof from a verified start); otherwise end STOPPED |

Recovery runs at the start of every controller command that takes the lock (so the next `release`, `collect`, `stop` or the periodic `reconcile` finishes or abandons a half release before anything else) and never starts anything that is not verified. If the link points at neither `from` nor `to`, or a proof is missing, the end state is STOPPED with the reason recorded; no step guesses. The rollback target must be a build with a recorded proof.

### 3.3 Outcome contract (answers P0-3)

`release` ends in exactly one of: `DEPLOYED` (new build verified), `ROLLED_BACK` (the previous proven build verified), `STOPPED_SAFE` (nothing verified, everything stopped, intent cleared), `REFUSED` (a precondition failed, nothing changed), `SUPERSEDED` (protected main moved before the host was touched, nothing changed). Only `DEPLOYED` is a release. The workflow's final step must read this one-line result: any other result is a visible non-DEPLOYED outcome (the job summary names it and the run is not reported as a deployment). Today's `oracle-paper-release.yml` ends its run with a SUCCESS conclusion when main moved (`deploymentResult=SKIPPED_MAIN_MOVED`, 2026-11-16 19:38 KST: stage and activate were skipped); the follow-up change makes that result a failing conclusion with the text "NOT DEPLOYED: protected main moved". Until then: nobody (agent or owner) reports a release as done from the run conclusion alone, only from `deploymentResult=DEPLOYED` and the host's reported build; and no PR is merged while a release runs.

### 3.4 Emergency stop priority (answers P1)

`stop` first creates the marker file `/run/nusa-control/stop-requested` (atomic, root only) and only then waits for the lock (90 s). The release verb checks the marker before every phase change, between probes and inside every wait; on the marker it takes the recovery path to STOPPED at once (no rollback start). Every wait inside `release` is at most one probe or one retry gap (about 13 s), so the lock is released well inside the 90 s of `stop`. The marker is removed by `stop` after the units are stopped and by recovery.

### 3.5 Invariant enforcement and tests (answers the PAPER_ORDERS remark)

Before every phase change the verb re-checks: orders OFF from every source, the mode file says `COLLECT_ONLY`, no unit or drop-in sets `NUSA_PAPER_ORDER_PATH`. A failure stops the release (`STOPPED_SAFE`). `PAPER_ORDERS` is not representable in the state, the mode file writer or any phase. The tests in section 5 inject a failure at every phase, a stale lock, a tampered order switch between phases and a `stop` during every phase.

## 4. What changes in the workflow and on the host

- `oracle-paper-release.yml`: build and backup stay; the `activate` job calls `sudo nusa-control release <sha>` and reads its one-line JSON.
  It still requires the exact protected-main SHA with successful exact-source CI, and the owner's per-release approval (environment reviewer).
- Host: the runner account gets one sudo rule for `nusa-control` with a fixed verb list (`status`, `stop`, `collect`, `release`) and no
  arguments beyond a hash. The old helper's sudo rule is revoked in the same terminal session (design v5 C3 hand-over; owner, evening).
  Until then the old path stays and nothing here is used.

## 5. Tests the review should demand

- A property test: a random crash or failure injected at every phase of `release` (including both halves of the SWAPPING step) ends in exactly one of the outcomes of 3.3; never a mixed state, never `PAPER_ORDERS`; a stale RELEASE intent is recovered by the next controller command.
- Gate tests: the table of 3.1 (a start is refused for every state not listed as permitted, and with no lock holder).
- A `stop` issued during every phase wins within the 90 s lock wait.
- A test for the outcome line the workflow reads (one JSON line, one of the five results).
- The real `/health` of the cloud runtime (the new test of PR #3163) for the post-swap verification.
- A test that `release` refuses with orders not OFF, with a pending intent, with an unstaged or malformed hash, and with the lock busy.
- A rollback target test: only a build with a recorded proof is restored.

## 6. Owner decisions needed

1. Approve the sudo hand-over (one terminal session, evening): revoke the helper's rule, add the controller's rule with the fixed verb list.
2. Per-release approval stays with the owner: through the workflow's environment reviewer (the phone), not by a terminal step.
3. Whether the release workflow may also call `stop` and `collect` for the phone buttons (C5) from the same sudo rule (recommended: yes, same fixed list).

## 7. What this does not solve

- A single host (hardware or disk loss). The research job that blocks the runtime for about 14 s every hour (collector and research share a
  process): the controller now tolerates it, a separate research process is a different, larger change.
- Strategy: no researched strategy has passed a holdout (C7).

## 8. Order of work

(a) `release` verb with its property test, no host change; (b) review; (c) the sudo hand-over and the workflow change in one reviewed PR and
one owner terminal session; (d) the first release through the controller (C4), with a deliberate failure drill on a copy first (C2 rehearsal).
