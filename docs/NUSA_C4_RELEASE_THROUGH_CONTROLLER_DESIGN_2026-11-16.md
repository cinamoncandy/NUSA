# C4 design: release through the controller (2026-11-16)

Status: DESIGN for review and owner decisions. Nothing here changes code, the host or the order switch. Safety is unchanged:
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

## 4. What changes in the workflow and on the host

- `oracle-paper-release.yml`: build and backup stay; the `activate` job calls `sudo nusa-control release <sha>` and reads its one-line JSON.
  It still requires the exact protected-main SHA with successful exact-source CI, and the owner's per-release approval (environment reviewer).
- Host: the runner account gets one sudo rule for `nusa-control` with a fixed verb list (`status`, `stop`, `collect`, `release`) and no
  arguments beyond a hash. The old helper's sudo rule is revoked in the same terminal session (design v5 C3 hand-over; owner, evening).
  Until then the old path stays and nothing here is used.

## 5. Tests the review should demand

- A property test: a random crash or failure injected at every step of `release` ends in exactly one of: new build verified, previous build
  verified, or STOPPED with the intent cleared; never a mixed state, never `PAPER_ORDERS`.
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
