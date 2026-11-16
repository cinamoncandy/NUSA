# C4 design: release through the controller (2026-11-16)

Status: DESIGN for review and owner decisions. Revised after the independent review of 2026-11-16 (REJECT: P0-1 state transitions, P0-2 crash recovery, P0-3 'main moved' outcome, P1 stop priority) and again on PR #3165 (REJECT: P0-1 gate cannot identify the release, P0-2 recovery table incomplete, P0-3 stop marker race, P1 outcome contract in the workflow); sections 3.1 to 3.5 answer each finding. Nothing here changes code, the host or the order switch. Safety is unchanged:
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

### 3.1 Authenticated start grant and the start gate (answers P0-1)

A held lock proves nothing about WHO holds it, so the gate does not trust the lock. Every start of the runtime units needs a single-use start grant that only the verb holding the lock can create.

- Identity: the release verb creates a random 128-bit `runId` and stores it in the intent `RELEASE {runId, from, to, phase, startedAt}`. `phase` is one of `PREPARED`, `UNITS_STOPPED`, `ACTIVATING` (the helper runs, 3.6), `SWAPPING`, `SWAPPED`, `STARTING_NEW`, `ROLLING_BACK`, `STARTING_OLD` (`SWAPPING` and `STARTING_NEW` are only read for intents of an older controller). Every phase change is one durable state write (write, fsync, rename, fsync the directory) BEFORE the step it announces.
- Grant: immediately before it asks systemd to start the runtime units, the verb writes `/run/nusa-control/start-grant` (root, 0600, `O_EXCL`, `/run` is tmpfs so a reboot erases it) with `{runId, phase, sha, pid, pidStartTime, expiresAt}`. `sha` is `to` for `STARTING_NEW` and `from` for `STARTING_OLD`; `expiresAt` is 60 s after creation (monotonic clock).
- The gate (`reconcile`, run by `Requires=`) permits a start only when ALL hold, and otherwise refuses with a named reason: state valid; `desired` allows a start; the intent (if any) has the same `runId` as the grant; the grant `phase` equals the intent phase and is `STARTING_NEW` or `STARTING_OLD`; `grant.sha` equals what `/opt/nusa/current` points at and equals `state.active`; the grant is not expired; the process `pid` still exists with the same start time (`/proc/<pid>/stat`), its command line is `nusa-control release`, and `/proc/locks` shows that pid holding the controller lock; no stop marker exists (3.4). The gate consumes (deletes) the grant when it permits, so one grant is one start; the verb writes a second grant of the same run and phase for the research timer, which has its own gate check. A start with no grant is permitted only in the plain case: `desired COLLECT_ONLY`, no intent, `active == current`, no stop marker (the normal boot and `Restart=` path).
- So an outside `collect`, `status`, a stray lock holder, a systemd restart or a boot cannot start the runtime during a release: they have no grant, and a RELEASE intent makes the plain case false.
- No re-entrancy and no deadlock: the release verb does not call the `collect` command as a subprocess (it would need the same lock). It calls the in-process start-and-verify function while it already holds the lock. The gate never takes or waits for the lock (it only reads `/proc/locks`), so the verb waiting on `systemctl start` cannot block on the gate.

| State | A start of the runtime units is permitted |
| --- | --- |
| `desired COLLECT_ONLY`, no intent, `active == current`, no marker | yes (normal, no grant needed) |
| intent `RELEASE` phase `STARTING_NEW` or `STARTING_OLD`, a valid grant as above | yes, once |
| intent `RELEASE` phase `ACTIVATING`, a valid grant with two uses, link already the new build, record still the old build | yes, twice (`nusa.service`, research timer) |
| any RELEASE intent without a valid grant, any other phase | no |
| `desired STOPPED`, or a stop marker exists | no |

### 3.2 Crash and failure recovery (answers P0-2)

Facts read by recovery: the intent phase, where `/opt/nusa/current` points, `state.active`, the unit states, the recorded proofs. The rule is: a recovery never moves forward. Whatever it finds, it converges to `STOPPED` on the previous build, or to `STOPPED` with a named reason; it starts nothing (starting is only done by a live verb with a grant). Only the live `release` process rolls back and restarts the old proven build.

Allowed combinations (any other combination is the last row):

| Phase | link | `state.active` | Recovery |
| --- | --- | --- | --- |
| `PREPARED`, `UNITS_STOPPED` | `from` | `from` | stop units (idempotent), clear intent, STOPPED |
| `SWAPPING`, `ACTIVATING` | `from` or `to` | `from` | stop units, set link to `from` if it is `to`, clear intent, STOPPED |
| `SWAPPED`, `STARTING_NEW`, `ROLLING_BACK` | `from` or `to` | `from` or `to` | stop units and confirm inactive, link to `from`, `active = from`, clear intent, STOPPED (the new build was never verified, so it is never continued; both values may be either build because a crash between the two writes of this very recovery leaves such a pair) |
| `STARTING_OLD` | `from` | `from` | stop units, clear intent, STOPPED (the live verb, not recovery, restarts the old build) |
| anything else (link is neither `from` nor `to`, `active` is neither, an unreadable intent, units that will not stop) | any | any | stop units; if they will not stop, report `STOPPED_UNCONFIRMED` and refuse further verbs except `stop`; else STOPPED with `active = null`, reason `RECOVERY_UNKNOWN` (in the command result and the journal; the record has no reason field), the link left untouched (no guess); the owner or the next `release` names a staged sha |

Order inside recovery: (1) stop the units and confirm `inactive`, (2) fix link and `state.active` with the two atomic operations (`ln -sfn` to a temp name then `rename`; state write as in 3.1), (3) clear the intent in the same write that records STOPPED. Each step re-reads the facts, so running recovery again after a crash inside recovery reaches the same end (idempotent). The proof record for a build is written only in the same state write that ends a verified `DEPLOYED` or confirms a verified old build; a rollback target must have a proof.

Recovery runs at the start of every command that takes the lock and, for `status` and the periodic `reconcile`, only reports (it does not change anything without the lock).

### 3.3 Outcome contract and the workflow (answers P1)

`release` ends in exactly one of: `DEPLOYED` (new build verified), `ROLLED_BACK` (the previous proven build verified), `STOPPED_SAFE` (nothing verified, everything stopped, intent cleared), `REFUSED` (a precondition failed, nothing changed), `SUPERSEDED` (decided by the workflow, never by the controller: protected main moved before the host was touched, nothing changed); the controller adds `STOPPED_UNCONFIRMED` when a unit would not stop (never a success). Only `DEPLOYED` is a deployment.

Workflow contract (a tested script, `scripts/release-verdict.js`, not shell logic scattered in YAML):

- The step that rechecks protected main after the backup emits `outcome=SUPERSEDED` when main moved, and the host jobs are then skipped. The `activate` job emits `outcome=<the controller's one-line result>`.
- A final job `verdict` always runs (`if: always()`). It reads the `outcome` outputs, then reads the host with `sudo nusa-control status` and the public `/health`. It reports a deployment only when `outcome == DEPLOYED` AND the host `active` sha equals the target sha AND `runtime.sourceCommitSha` equals the target sha AND `runtime.ok` is true. A missing outcome (job skipped, cancelled, no output) is treated as NOT DEPLOYED.
- Any other result fails the run with the text `NOT DEPLOYED: <outcome>` in the job summary; `SUPERSEDED` is a failing "not deployed" result, never `success`, and is excluded from any count of successful deployments. `deploymentResult` is set to `DEPLOYED` only by `verdict`.
- Until this change is merged: nobody (agent or owner) reports a release as done from the run conclusion alone (2026-11-16 19:38 KST: the run was `success` while stage and activate were skipped), only from `deploymentResult=DEPLOYED` plus the host's reported build; and no PR is merged while a release runs.

### 3.4 Emergency stop priority (answers P1 stop and P0-3)

The stop marker `/run/nusa-control/stop-requested` is checked at the ONE irreversible dangerous action, not only between steps: the gate (3.1) denies every start while the marker exists, even a start with a valid grant. So a race between the release's last marker check and its next action cannot start the runtime: the start is refused at the gate, atomically, by the file's existence. The release also checks the marker before each phase change and inside each wait and then takes the recovery path to STOPPED without a rollback start; that is only for speed.

- Create: `stop` creates the marker first with `O_EXCL` (root, 0600) containing `{stopId, pid, pidStartTime, createdAt}`; an existing marker is joined, not replaced.
- Wait and fallback: `stop` waits up to 90 s for the lock. If it still has no lock, it stops the runtime units directly (`systemctl stop` is idempotent and always safe), keeps the marker and reports `STOP_UNLOCKED`; the next command that takes the lock runs recovery (3.2) and records STOPPED. With the marker present nothing can restart the runtime in the meantime.
- Consume: only `stop` removes its own marker, and only after it holds the lock, the units are confirmed inactive, and the state write with `desired STOPPED` and no intent is done (state first, marker second: a crash between leaves a marker with a STOPPED state, which is harmless and fail-closed).
- Leftover marker (stop crashed, or no lock): it never expires by time and recovery never deletes it, because an unsafe auto-delete could re-open starts. It is removed only by (a) a later complete `stop`, or (b) an explicit `collect` run by the owner while no live process matches the marker's `pid` and start time and the state is `STOPPED`. A reboot clears `/run`, but the durable state (`desired STOPPED` or a RELEASE intent) still makes the gate refuse, so a reboot never reopens a start.
- Every wait inside `release` is at most one probe or one retry gap (about 13 s), so the lock is free inside the 90 s of `stop`.

### 3.5 Invariant enforcement and tests (answers the PAPER_ORDERS remark)

Before every phase change the verb re-checks: orders OFF from every source, the mode file says `COLLECT_ONLY`, no unit or drop-in sets `NUSA_PAPER_ORDER_PATH`. A failure stops the release (`STOPPED_SAFE`). `PAPER_ORDERS` is not representable in the state, the mode file writer or any phase. The tests in section 5 inject a failure at every phase, a stale lock, a tampered order switch between phases and a `stop` during every phase.

### 3.6 Finding while wiring (2026-11-16): the helper's `activate` does more than swap and start

Reading `deploy/oracle/nusa-release-step.sh activate` shows what a release does today beyond the link swap and the runtime start: the replay-compatibility check, its own activation lock, `atomic-deploy.js` (link plus the previous-release record), binding the commit into the runtime environment file, installing the unit files of the release, `enable`, `restart` of `nusa.service`, the autopilot (not gated) and the research timer, `oracle-readiness-check.js`, the writer-lease recovery, the autopilot readiness, the post-activation soak, the proven marker and the schema check for a rollback. The `release` verb as implemented (link swap, mode file, grant, start, verify) is the state-machine core; it is NOT yet a replacement for all of that, and must not be wired into the workflow as one.

Decision (implemented in this PR, to be reviewed): the controller DELEGATES, it does not reimplement. New phase `ACTIVATING`: after `UNITS_STOPPED` the controller runs `nusa-release-step activate <sha>` as a child while it holds the lock. The helper does everything above; its two gated starts (`restart nusa.service`, `start nusa-research.timer`) ask the gate, which accepts a grant with `uses: 2` bound to the intent (run id, phase `ACTIVATING`, build `to`, link must already equal `to`, `state.active` still `from`, owner process alive and holding the lock); each accepted start decrements `uses`, a third is refused. The autopilot restart is not gated and stays the helper's concern. When the helper returns 0 the controller verifies on its own (`verifyRuntime`), writes `active = to`, the proof and `COLLECT_ONLY`. When it returns non-zero (its own safe stop, or a gate refusal) the controller confirms every unit stopped and takes the existing rollback path (`ROLLING_BACK`, `STARTING_OLD`, a fresh single grant for the previous proven build) or ends `STOPPED_SAFE`. Recovery for `ACTIVATING` is the `SWAPPING` row (link `from` or `to`, active `from`).

Sudo consequence: the runner no longer needs `activate` (only the controller, as root, calls it): its rule keeps `stage` and `preflight` of the helper and gains `nusa-control status|stop|collect|release <sha>`.

Bootstrap consequence: the installed controller (678085c2f) has no `release`. The first release that carries this verb cannot go through the controller, and the old helper path is refused by the gate. To avoid the three-session dance one last time, the installer gets an in-place mode (`--upgrade-controller`): with the runtime running and verified, it replaces only the controller files and the manifest from a staged release (units and drop-ins unchanged), then verifies; no restart. Workflow input `stage_only` lets a release stop after `stage` so the owner can run that upgrade.

## 4. What changes in the workflow and on the host

- `oracle-paper-release.yml`: build and backup stay; the `activate` job calls `sudo nusa-control release <sha>` and reads its one-line JSON.
  It still requires the exact protected-main SHA with successful exact-source CI, and the owner's per-release approval (environment reviewer).
- Host: the runner account gets one sudo rule for `nusa-control` with a fixed verb list (`status`, `stop`, `collect`, `release`) and no
  arguments beyond a hash. The old helper's sudo rule is revoked in the same terminal session (design v5 C3 hand-over; owner, evening).
  Until then the old path stays and nothing here is used.

## 5. Tests the review should demand

- A property test: a random crash or failure injected at every phase of `release` (including both halves of the SWAPPING step) ends in exactly one of the outcomes of 3.3; never a mixed state, never `PAPER_ORDERS`; a stale RELEASE intent is recovered by the next controller command.
- Gate tests: the table of 3.1 (a start is refused for every state not listed as permitted, and with no lock holder).
- A `stop` issued during every phase wins within the 90 s lock wait; a marker created right after the release's last check still blocks the start at the gate; `stop` without the lock stops the units directly and the marker survives; a leftover marker is never auto-deleted.
- Grant tests: a start with a missing, expired, reused, wrong-runId, wrong-phase, wrong-sha or dead-pid grant is refused; a stray process holding the lock gets no start; a release calling start does not deadlock with the gate.
- Recovery tests: every row of the 3.2 table, a crash inside recovery at every step followed by a second recovery (same end state), and the unknown-combination row ends STOPPED with the link untouched.
- Verdict tests (`scripts/release-verdict.js`): for every combination of outcome (five values, missing), host sha and health, only DEPLOYED with matching shas and `runtime.ok` is a deployment; SUPERSEDED and a missing outcome fail the run.
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

(a) `release` verb with its property test, no host change (state-machine core, PR 3167); (a2) delegation to the helper's `activate` with the `ACTIVATING` phase and the two-use grant; (a3) the installer's `--upgrade-controller` and the workflow's `stage_only`; (b) review; (c) the sudo hand-over and the workflow change in one reviewed PR and
one owner terminal session; (d) the first release through the controller (C4), with a deliberate failure drill on a copy first (C2 rehearsal).
