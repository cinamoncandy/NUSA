# CORE handoff — host controller install attempts, permit enforcement, release in flight (2026-11-16)

Observed: `2026-11-16` (Asia/Seoul), about 14:10 KST (05:10 UTC). Everything below is what the records claim; re-verify on GitHub and with the read-only host diagnose before acting. It supersedes `2026-11-14-main-handoff.md` for the host state and the next safe actions.

## Canonical state

- Protected `main`: `dfb75c16e` (merge of #3156). Main CI for it was green at 13:54 KST.
- Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, orders OFF everywhere (`NUSA_PAPER_ORDER_PATH=OFF`), Release=HOLD. Stage B (orders ON) is blocked: it needs a permit producer with a durable store, a qualified candidate strategy, a release and a fresh written owner approval.
- Host: `nusa.service` runs in `COLLECT_ONLY` (old start behaviour, restored by the owner-approved rollback at about 13:57 KST). The release of `66cffaea3` is the current build until the release of `dfb75c16e` (run 43807184375, dispatched 13:57 KST, about 40 minutes) finishes. The controller files, the install manifest and the state file are kept at `/opt/nusa-control` and `/var/lib/nusa-control` (state `STOPPED`); the controller units, drop-ins and mode file are removed.

## What happened

- Installer (`deploy/control/install.sh`, #3147/#3148) ran on the real host with the owner's approvals: preflight 0 failures, `--apply`, the first `collect` failed with `SENDER_UNKNOWN` (code-reading cause: unaccepted backlog connections show inode 0), the owner approved the rollback. #3154 fixed the sender lookup (poll until accepted) and added `--after-rollback`. #3155 added a Linux CI job for the controller and installer tests.
- Release of `66cffaea3` succeeded; the preflight with `--after-rollback` passed; `--apply --after-rollback` ran to `collect`, which failed again at the 20-minute ceiling. The host journal showed `cloud.http.health` 200 answers every 5 s, so the sender was identified and answered. Cause found by reading the code and reproducing it with a server written like the runtime: the runtime sends `/health` with no content-length (`apps/cloud/src/mobileDashboardHttp.ts`), Node answers chunked, and the controller parsed only a non-chunked answer (`HEALTH_UNAVAILABLE` forever). #3156 sends the request as HTTP/1.0 (new test fails on the old code). Not measured on the host: the exact reason string of that collect (the terminal output was lost).
- A release cannot run while the controller gate is installed with state `STOPPED`: `nusa-release-step.sh` restarts `nusa.service`, and the drop-in `Requires=nusa-control-reconcile.service` refuses it. So the order is: rollback, release, preflight, apply.
- Permit enforcement merged (#3150: recompute, bind, replay guard, recheck before the simulator; production default has no authority, so no permit passes). Permit producer design merged (#3151, corrected in #3153). The durable store/adapter (#3152) is on HOLD: the reachability gate refuses an unwired module.

## Next safe actions (each host step needs the owner's explicit "승인")

1. Read-only: watch release run 43807184375 (`actions_get`/`actions_list`); after success run `oracle-host-diagnose.yml`.
2. Owner terminal, read-only preflight: `sudo bash -c 'f=/opt/nusa/releases/dfb75c16e5c77aadcfc6ec0c088837418d736047/deploy/control/install.sh; echo "494cce37e71ca0edc0190e805f659a748a923aee3154329679e4e3a046eb469d  $f" | sha256sum -c - && bash "$f" dfb75c16e5c77aadcfc6ec0c088837418d736047 a362acb9db97e3dfab92a265f907aabb6c10993e3fda9829fc95db2c20a23065 --after-rollback'`.
3. Only with a fresh approval: the same line with `--apply --after-rollback`; the collect step takes up to 20 minutes, the owner must keep the window open and send the output. If it fails, read `diag` from the printed `START_CEILING` detail; do not roll back without approval.
4. After a verified install: replace the stale daily host-check scheduled task (`trig_01EsThfZSo7b3Qog4fDVGb19`, still says "service STOPPED on purpose") with a check for COLLECT_ONLY with the controller (state, `runtime.ok`, `NRestarts`, candle gaps).

## Open items and owner-only decisions

- #3152: option A (wire it default-off) or B (park; recommended).
- Permit producer decisions: 1 meaning of PERMIT, 2 first candidate, 3 governance authority, 4 order of work.
- Later: Cloudflare removal, phone button, cleanup, strategy review (C5/S1-S5/C6/C7).
- Research schedule from the 2026-11-14 handoff still holds: first trade-flow result on 2026-11-21 KST; no release during the second study's holdout (2026-11-24T06:00Z..11-28T06:00Z). The two releases of 2026-11-16 restarted the service briefly inside the research span.

## Not verified

- The exact failure reason of the second real-host collect, and that the HTTP/1.0 fix passes `collect` on the real host (sandbox and CI only).
- The state of the release run in flight and of the host after it.
- Whether the `actual-paper-runtime` CI job (live public market data) is flaky: it failed once on #3156 and passed on the single re-run; the first failure was not examined.
