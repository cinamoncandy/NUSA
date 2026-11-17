# C4 maintenance window: a release backup must not be mistaken for a dead runtime (design)

Date: 2026-11-17. Status: DESIGN for review, not an approval; nothing here changes code, the host or the order switch.
Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, orders OFF, Release=HOLD.

## 1. What happened (2026-11-17, evidence from the host journal and the workflow)

- Release run 44015995512 (`stage_only`): the host backup step ran 04:17 to 04:53Z. At 04:35:13Z the (old) controller's periodic verify answered `VERIFY_STOPPED:SENDER_UNKNOWN` and stopped the collector; `/health` was 502 until the owner ran `collect` (about 09:55Z).
- Release run 44071734417 (controller activation): the backup step started 11:12:27Z. The NEW controller (5-minute patience) answered `VERIFY_STOPPED:SENDER_UNKNOWN` at 11:19:33Z, so the runtime gave no usable answer from about 11:14:30Z. The backup finished 11:46:10Z; the controller's `release` then refused within 0.08 s (the reason was lost: the workflow step ran under `bash -e`, fixed in #3180). The most likely reason is that the verify stop had already left the state not COLLECT_ONLY-verified. This is an inference.
- An earlier stop (2026-11-16 17:15Z) did NOT overlap a backup (hourly research job). So the backup is a strong suspect for two of three incidents, not a proven cause. The runtime's own journal shows nothing for 11:10 to 11:30Z (it does not log in that window), so the cause of the silence is NOT established.
- The backup is `VACUUM INTO` over the live DB (`scripts/sqlite-backup.js`), I/O capped at 1 MiB/s and niced, about 35 minutes.

## 2. Principle

Fix the part that is certain, do not wait for the unproven cause: a verify that cannot tell "maintenance in progress" from "runtime dead" will stop a healthy collector whenever a long maintenance step makes `/health` slow. The controller must be told, by the same trusted path that starts the maintenance, that a bounded window is open. Nothing about "wrong answers" is relaxed.

## 3. Design

- New controller verbs `maintenance begin <sha>` and `maintenance end` (root, through the existing sudo allow-list; the runner may call exactly these two forms in addition to `status`, `stop`, `collect`, `release <sha>`).
- State: one root-owned file `/run/nusa-control/maintenance` (0600, in the existing 0700 root directory, tmpfs: gone at reboot) holding `{runId, sha, bootId, beginsAtMs, expiresAtMs}` with a HARD maximum of 60 minutes. Written atomically (same helper as the stop marker).
- `begin` is refused unless: no stop marker, the state is COLLECT_ONLY with no pending intent, the runtime verifies right now (the same read-only check as `status`), no unexpired window of another run exists, `sha` is a 40-hex string. It never starts, stops or restarts anything.
- `end` removes the file only when its `runId` matches the caller's run; an expired or foreign window is removed by the next `verify` or `end` without error. A stop request (`stop` marker) removes the window at once and wins.
- Periodic `verify` while a VALID window is open (right boot, not expired): it still checks everything it checks today, but ONLY the "no answer yet" reasons (`HEALTH_UNAVAILABLE`, `SENDER_UNKNOWN`) are tolerated, returning `{ok:true, code:"MAINTENANCE_WINDOW", verified:false}` instead of stopping. Any wrong answer (`BUILD_MISMATCH`, `MODE_MISMATCH`, `FOREIGN_SENDER`), orders not OFF everywhere, a state-file problem, an unexpected unit state, a stop marker, or `RUNTIME_NOT_ACTIVE` still stops at once exactly as today.
- No window, an expired window, a different boot id, or an unreadable file means the window does not exist: today's behaviour.
- The window is bounded in time and tied to one run; a crashed workflow cannot keep it open past 60 minutes, and a reboot clears it.

## 4. Workflow

- `begin` as the first step of the host backup job (before the backup), with the 40-hex source sha; if `begin` is refused the run stops there with the controller's answer printed (nothing was changed).
- `end` as an `if: always()` step at the end of the host release job (and in the cancel path it is covered by expiry). The release job's own `release <sha>` still verifies the runtime itself before changing anything.
- The default `activation=helper` path is closed since the hand-over; the new steps run only for `activation=controller`.

## 5. Authority and sudo

The window cannot start, stop, restart or reconfigure anything and cannot enable orders. The runner already may call `release <sha>` and `stop`; a compromised runner could at most delay the stop of a runtime that gives NO answer for up to 60 minutes (a runtime that answers wrongly is still stopped at once). `sudo-handover.sh` gets two more exact allow-list entries (`maintenance begin [0-9a-f]x40`, `maintenance end`); the host rule must be re-applied by the owner once (one pasted block), and `--check-exclusive` must still say COMPLETE.

## 6. Tests required

begin refusals (no state, intent pending, stop marker, runtime not verified, another window); window tolerates no-answer but stops at once on each wrong answer, orders ON, state problem, stop marker, runtime inactive; expiry and boot id; end by a foreign runId; crash injection around the atomic write; `verify` under `flock -n` unchanged; the sudo allow-list test (bypass cases) updated; the workflow tests pin begin before the backup and end under `always()`.

## 7. Not done / not claimed

No code yet. The cause of the `/health` silence is not established; this design does not claim to remove it, only to stop the controller from killing a healthy collector during a bounded, announced maintenance step. The measurement the owner wants (phase timings of the manifest build) still needs a release that now has a chance to succeed.
