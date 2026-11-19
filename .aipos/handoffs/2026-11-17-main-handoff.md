# CORE handoff — C4 (release through the controller) in draft, controller stable (2026-11-17)

Observed: 2026-11-17 (Asia/Seoul), early morning. Everything below is what the records claim; re-verify on GitHub and with the read-only host diagnose before acting. It supersedes `2026-11-16-main-handoff.md` for next actions.

## Canonical state

- Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, orders OFF everywhere, Release=HOLD. Stage B (orders ON) stays blocked: it needs a permit producer with a durable store, a qualified candidate, a release and a fresh written owner approval naming Stage B.
- Host: build `678085c2f` runs in `COLLECT_ONLY` WITH the controller installed (the old controller, without the `release` verb). The public `/health` showed no restart from 21:29 KST to about 23:20 KST on 2026-11-16 (stability check, two hourly research jobs passed). Not re-read since.
- Protected `main` at the time of writing: see `git log origin/main` (the C4 work below is NOT on main).

## C4 work, all DRAFT pull requests (code PRs stay draft until a non-author review)

| PR | Branch | What |
| --- | --- | --- |
| #3165 | claude/c4-design-review-fixes | design second revision (docs) |
| #3167 | claude/c4-release-verb | controller `release <sha>`: authenticated single-use start grants (slot files claimed by atomic rename), stop marker denied at the gate, recovery table, delegation of the real activation to the reviewed host helper (`ACTIVATING`, two-start grant), crash injection at every mutation |
| #3169 | claude/c4-release-verdict | `scripts/release-verdict.js` and the final `verdict` job: a run is a deployment only when job results, receipt, public health (`ok:true` and the build) and, in controller mode, the controller's own outcome, active build and runtime check all agree |
| #3170 | claude/c4-installer-upgrade | `install.sh --upgrade-controller`: replace the controller files in place without touching the runtime; restore only under the lock, `RECOVERY_REQUIRED` otherwise |
| #3171 | claude/c4-workflow-controller | `stage_only` and `activation=helper|controller` inputs; the runner may call exactly `release <sha>` and `status` of the controller |
| #3172 | claude/c4-sudo-handover | `sudo-audit.sh` (read-only) and `sudo-handover.sh` (adds one sudoers file; `--check-exclusive`: complete only when the old helper `activate` is unreachable) |

Stacking: #3169-#3172 are based on other branches; full CI (about 18 checks) ran only when each PR was opened, later pushes run only the event bridge, and stacked PRs do not run CI at all. Full CI for the latest heads runs when a PR is marked ready, which needs the non-author review first.

Reviews so far: a Codex PRELIMINARY review (not the formal Claude VALIDATOR that AGENTS.md requires) rejected all five on 2026-11-17 00:03 UTC; every finding was fixed in the branches above (grant race, restore under lock, verdict evidence, controller-mode outcome, exclusivity of the hand-over). No formal validator verdict exists yet.

## Next safe actions (each host step needs the owner's one-word "승인")

1. Owner: give the review block to a fresh Claude session (validator) for #3167, #3170, #3169, #3171, #3172; fix its findings; then mark ready, CI, bot merge in stack order.
2. After merge: dispatch one release with `stage_only=true` (stages, activates nothing; the verdict reports `STAGED_ONLY`).
3. Owner terminal: `install.sh <sha> <manifest> --upgrade-controller` (read-only preflight first, then `--apply`); no restart.
4. Owner terminal: `sudo-audit.sh`; read the output; `sudo-handover.sh <runner> --apply`; remove the old helper `activate` rule with visudo; `--check-exclusive` must say COMPLETE.
5. Dispatch a release with `activation=controller`; the verdict job decides.

## Open items and owner-only decisions

- Review partner: on 2026-11-17 the owner chose Codex (chat: "코덱스로 할게") for the C4 PRs. `AGENTS.md` still names the VALIDATOR as a separate fresh Claude session and says Codex workflows stay disabled, so a Codex verdict is recorded as the owner-chosen non-author review for these PRs; the rule text itself was NOT changed by CORE (the owner decides whether to amend `AGENTS.md`). Earlier alternatives discussed: Gemini, a fresh Claude session; `docs/NUSA_CORE_CODEX_ROLE_SPLIT_2026-11-16.md` still names Codex. Track C (separate the research job from the collector process) was proposed for the partner and is not started.
- Permit producer governance details, Cloudflare removal/phone workflow (C5/C6/S1-S5), strategy review (C7): unchanged from the 2026-11-16 handoff.
- Known small items: the `runMode` comment in `apps/cloud/src/runtime.ts` should say "selected mode; readiness is `orderPathReady`" (fix when that file is next edited); the release helper's `activate` is not changed by C4 (the controller delegates to it).

## Not verified

- None of the C4 code has run on the real host: tests use a fake systemd, fake health, a temporary tree and stub `visudo`; the real start gate, `/proc/locks`, `sudo -l -U` and the sudoers layout are untested.
- The newest heads of the draft PRs have not had full CI.

## Update 2026-11-17 03:30 UTC (12:30 KST)

- C4 is on `main`: #3167, #3169, #3171 (workflow `stage_only`/`activation`), #3170 (installer `--upgrade-controller`), #3172 (sudo audit and hand-over), plus #3173 (this handoff), #3174 (verify patience: no answer tolerated up to 300 s, stop marker and unit state checked before each retry) and #3175 (manifest phase-timing log). The "all DRAFT, not on main" statements above are outdated. The host still runs the OLD controller (build `678085c2f`); none of #3170/#3171/#3172/#3174/#3175 runs there yet.
- Incident 2026-11-17 02:15 KST: the old controller's verify stopped the collector after `/health` stayed silent during a long research job (SENDER_UNKNOWN in the journal). The owner restarted it with `collect` at 10:14 KST; health stable since (startedAt unchanged, orders 0, COLLECT_ONLY). `eventLoopMaxStallMs` was 29 s at 12:21 KST.
- Test flake: `actual-paper-runtime` fails intermittently with `PAPER_ORDERBOOK_UNRECONCILED` then `KILL_SWITCH_ACTIVE` (run once more per rule). #3176 (restrict the e2e market to the top-10 by turnover) was REJECTED by Codex and closed: the problem market ranked 9th, so the pool did not exclude it, and at times no market is actionable (BTC fallback). A real fix has to start from runtime behaviour or a measured ranking at failure time.
- Reviews: Codex (owner-chosen) rejected earlier heads of #3167, #3169-#3172; all findings fixed. Two stale inline threads kept the bot from merging #3172 until resolved. Formal Claude VALIDATOR verdict still does not exist (gap above).
- New: `.aipos/work-orders/WO-OPS-20261117-MANIFEST-ISOLATION.yaml` (proposed, no code). Track C was CORE's after Codex declined it (Lease rule); the owner said development is independent for now.
- Next safe actions: unchanged order 2-5 above, but the controller upgrade needs a staged release first and the owner's "승인" per host step; no release inside 2026-11-24T06:00Z..2026-11-28T06:00Z.

## Update 2026-11-17 10:05 UTC (19:05 KST): second stop, release staged

- Second stop of the day: at 04:35:13 UTC (13:35 KST) the OLD controller's periodic verify answered `VERIFY_STOPPED:SENDER_UNKNOWN` and stopped the collector (same class as 02:15 KST); every later verify reported `RUNTIME_NOT_ACTIVE` until the owner ran `collect` at about 09:55 UTC (18:55 KST). `/health` was 502 for about 4 h 40 min; the collection gap for that time is NOT yet checked (candle gap-fill may refill candles; trade ticks may not be refillable). The host was not rebooted (`uptime -s` 2026-10-30). The self-hosted runner did not take jobs from about 04:54 to 07:51 UTC (cause unknown, not investigated).
- Release run 44015995512 (`stage_only=true`, source `0f16c3682baad938a11e6656d3ed708317e1bf9e`) succeeded: staged only, nothing activated, verdict job success. The running build is still `678085c2f` with the OLD controller; the verify-patience fix (#3174) is therefore NOT on the host and the stops will recur at long research jobs.
- Controller upgrade preflight (read-only) was offered; the owner chose to skip it for now ("그냥 넘어가"). To resume: `install.sh <sha> <manifest-sha256> --upgrade-controller` from `/opt/nusa/releases/<sha>/deploy/control` (install.sh sha256 `5b22ab2ae43abbf661c7a268be7e5c93229406aa59bee59a29bd6ae2f9dd627c`, manifest hash `e5816b9930c030e2c533e1646221b1f296ff48d47631efa526f17a838a9f6b9b`, both computed by CORE from the commit, to be re-checked by the owner), preflight first, `--apply` only with the owner's "승인".

## Update 2026-11-18 04:00 UTC (13:00 KST): maintenance window proven, start gate defect, merges blocked by a new advisory

- On main since 2026-11-17: #3180 (the release step prints the controller's answer), #3182 (maintenance window: `maintenance begin|end <sha>`, a one-hour, one-sha, one-boot, root-only marker; verify tolerates ONLY "no answer" while it is open; sudo allow-list and workflow steps). The owner installed the new controller (`install.sh --upgrade-controller --apply` at 3b8ca85a9) and re-applied the sudo rule: `HAND-OVER COMPLETE for nusa-runner`; `sentinelx` was narrowed to `status|stop|collect` (backup `/root/sentinelx.bak-*`).
- First real use of the window (run 44211387585): the 36-minute backup ran with `/health` 200 throughout (before, three of three backups ended with the collector stopped). Evidence that the window works.
- First real controller `release` ended `STOPPED_SAFE` / `ROLLBACK_FAILED:START_FAILED`: the host journal shows `GATE_DENIED:RELEASE_OWNER_NOT_HOLDING_LOCK`. Cause (reproduced): the wrapper locks with the external `flock` binary, so `/proc/locks` names the exited flock pid, never the controller; the gate's `lockHeldBy(pid)` could never be true on the real host (the tests faked it). Fix #3184 (open): the proof is the owner's own open file (`/proc/<pid>/fdinfo`), with a real-kernel test. Not yet on the host.
- A new advisory (picomatch ReDoS, GHSA-fc5q-39xc-vjpf, patched `>=4.0.8`, not published yet) fails the security gate: every PR is red on `validation` and cannot merge, so #3184, #3183 (golden manifest test) and the queued docs are blocked. The gate is not loosened; a scheduled check waits for the upstream fix (override in `pnpm-workspace.yaml`); after about 4 hours without a fix the source-backport route (`scripts/security-backports.js`) is proposed to the owner.
- Plan once merges work: merge #3184, main CI, `stage_only` release (the backup is now protected), the owner pastes one block (controller upgrade, sudo rule, collect), then the controller release of the measurement build (phase timings of the manifest build); results of manifest isolation choose between chunked reads and a worker. No release inside 2026-11-24T06:00Z..2026-11-28T06:00Z.
- Collector stops of 2026-11-17: 04:35Z and 11:19Z during release backups (before the window), 17:15Z on 2026-11-16 (hourly research job); gaps of about 4 h 40 min, 1 h 14 min and an overnight stretch ended with the owner's `collect`. Not yet checked: whether candle gap-fill refilled the candles.
- Decisions of the owner recorded today: Gemini is not used; an owner-designated external reviewer rule is in AGENTS.md (#3178); permit producer defaults D3a-D3c and D5 accepted, D6 deferred (#3179, draft); independent reviews waived for the C4 follow-ups; all remaining decisions delegated to CORE except Stage B (needs a written approval naming Stage B), risk limits and live authority.
- Open owner items: a pending host reboot ("System restart required"), a 20-character string the owner pasted into the shell (rotate if it was a secret), the Cloudflare removal order (S1 findings in this PR).

## Update 2026-11-18 12:00 UTC (21:00 KST): exception merged, controller upgraded, first real controller release refused

- The picomatch advisory (audit id 1247710, high, ReDoS, no fixed version) was handled by an OWNER-CHOSEN exception (owner answered "2" to "wait or written exception" on 2026-11-18): #3188 adds `OWNER_EXCEPTIONS` to `scripts/security-gate-backports.js`: exactly that audit id, package, GHSA id, severity high, installed versions 2.3.2 and 4.0.7, expires 2026-12-02 00:00Z. It prints and reports itself on every run. A fresh review session returned APPROVE (two nits applied). No other gate behaviour changed. Exit: install a fixed picomatch through a `pnpm-workspace.yaml` override and remove the entry; otherwise it expires and needs a new owner decision.
- Merged after it: #3184 (start gate proves the lock through the owner's open file), #3183 (golden manifest test), #3186, #3187 (read-only permit inventory script, NOT yet run on the host).
- Finding: the dataset identity (`replayRuntimeSha256` in `researchDatasetManifestMaterializer.ts`) includes `process.version`; the same data has another `datasetId` on another Node version. The golden test pins `process.version`. A host Node upgrade changes new dataset ids.
- Host steps done by the owner: `stage_only` release of main `54c5bc4f6` (run 44275217764), then `install.sh 54c5bc4f6 <manifest d891b0b8...> --upgrade-controller --apply` and the sudo hand-over (`HAND-OVER COMPLETE`, controller state version 23, COLLECT_ONLY verified). The backup ran 36 minutes with the maintenance window open and `/health` answered at the end.
- First real controller release (run 44285912208, main `54c5bc4f6`, `activation=controller`): `REFUSED / RUNTIME_NOT_VERIFIED / SENDER_UNKNOWN` 28 s after the backup, before anything was touched; collector kept running on `678085c2f`. Cause: the controller's probe is accepted by the collector within 3 s or it is "no sender"; `/health` itself had timed out for minutes during the backup and the collector reports `eventLoopMaxStallMs=71416` and 179 stalls in 9 h. `verify` waits out no-answer for 300 s, `release` did not. Fix: #3189 (release waits out "no answer yet" for the same bounded budget; wrong answers refuse at once; stop marker ends the wait). It needs another controller upgrade on the host (owner paste) before the next controller release.
- Next safe actions: merge #3189 (after CI), `stage_only` release, owner paste (`--upgrade-controller` with the new manifest hash, sudo hand-over), controller release; then read the `[research-manifest]` phase lines from the journal (one read-only command) and choose the manifest isolation approach; the golden test is the safety net. The event-loop stalls (backup I/O and manifest builds in the collector process) are the common cause of the health silences.
- Still open: host reboot pending, permit inventory not run on the host, Cloudflare removal S1 incomplete, candle gap-fill refill unchecked, 11/21 first trade-flow result, no release inside 2026-11-24T06:00Z..2026-11-28T06:00Z.

## Update 2026-11-18 14:45 UTC (23:45 KST): first successful controller release

- Run 44319233112 (`activation=controller`, main `979986a88`, which carries #3189 release-precheck patience, #3192 fewer reads and #3193 the yielding manifest build): backup 37 min with the maintenance window open, controller release step 3 min 14 s, verdict success. `/health` now reports `sourceCommitSha=979986a88`, COLLECT_ONLY, orders OFF, `startedAt` 14:37Z. This completes C4 (first release through the controller).
- Still to read: `eventLoopMaxStallMs`, the stall count and the `[research-manifest]` build durations of the new build against 115825 ms / 392 / 13.4 s of the old one (a read-only host diagnosis was dispatched after the release).
- Open: C5 phone buttons (#3194, owner's one-time Environment setup), learning loop L1 (zero candidates pass; trading chain broken at DECISION in COLLECT_ONLY), futures collector blocked by HTTP 451, host reboot pending, no release inside 2026-11-24T06:00Z..2026-11-28T06:00Z.

## Update 2026-11-18 23:45 UTC (2026-11-19 08:45 KST): C5 phone buttons done and verified

- `PAPER Run Mode` (#3194, plus the read-only `status` action #3195) is on main. Actions: status (read-only), stop, collect. `collect` RESTARTS a runtime that is already running, so it is for a stopped host only. No action starts the order path.
- Owner setup done on 2026-11-19: Environment `paper-host-control`, repository variable `PAPER_RUN_MODE_ENABLED=true`. FINDING: the first two status runs ran without waiting for approval (3 s after the guard) because the Environment's Required reviewers box was not ticked/saved (a referenced Environment that does not exist or has no rules is created/treated as unprotected). After the owner ticked Required reviewers (the owner) and unticked "Allow administrators to bypass", run 44422249720 waited (`waiting`) until the owner approved, then ran: the approval protection is proven. Lesson: always prove a protection by an actual harmless run, never by the setting alone.
- Controller status read through the button: state version 30, desired COLLECT_ONLY, active 979986a88 (RELEASE_VERIFIED), nusa.service and the research timer active, no stop marker.
- C4 and C5 are done. Remaining from design v5: the watch-the-watcher alert drill (C5 part 2: a read-only watch workflow every 15 minutes plus a dead-man check), C6 cleanup (Cloudflare S1-S5, superseded release-decision logic), C7 strategy review; learning loop L1 blocked (no candidate passes; trading chain needs Stage B).

## Update 2026-11-19 00:15 UTC (09:15 KST): the stall fix is proven on the host; watch cadence finding

- Host numbers 9.5 hours after the controller release (build 979986a88, started 14:37Z): `eventLoopMaxStallMs` 1203 (old build 115825), `eventLoopStallCount` 1 (old 392), manifest materialization 26.1 s per gap-fill run with the collector staying responsive (old 41-46 s, blocking). Steps A (#3192 fewer reads) and B (#3193 bounded steps) work as designed.
- FINDING: the Health Watch ("every 30 minutes") is started by GitHub only about every 6-9 hours here (16 scheduled runs in five days, 6.5-8.8 h apart). The dead-man check (#3197, limit recalibrated to 12 h in #3199) caught this on its first run. The watch is therefore NOT a 30-minute watch. An independent routine of the owner's Claude session (trigger `NUSA independent liveness watch`, every 2 hours, one curl of /health, push notification only when abnormal) covers the gap; its prompt hard-codes the expected build sha and must be updated after every release.
- Closed as resolved: issues #3168 (host not answering), #3185 (security gate failing, covered by the #3188 exception), #3198 (dead-man calibration finding). The PAPER Run Mode approval protection was proven by a real waiting run (see the previous section).
- Learning loop (L1-L8): L1 still blocked: zero research candidates pass (experiment ticks: FAIL_EXCESSIVE_DRAWDOWN 216, FAIL_NO_EDGE 66), trading chain at DECISION_NONE in COLLECT_ONLY. Study states: orderbook 2nd study WAITING_DATA with 68.8% book coverage of the 192 h window against the 90% bar (collector gaps of 2026-11-17/18), trade-flow v2 WAITING_DATA (first result 2026-11-21 or later), futures collector blocked by HTTP 451 (4128 failures, 0 rows).

## Update 2026-11-19 03:50 UTC (12:50 KST): release of main 841038612 (run 44443029114)

- Release run 44443029114 (`activation=controller`, main `841038612`, CI green) succeeded; the verdict job passed. Build `841038612` is deployed (public `/health`: ok, COLLECT_ONLY, orders 0, `eventLoopMaxStallMs` 1271 ms, 1 stall). The changes since `979986a88` are workflows, tests and docs (the C5 buttons, the dead-man check, findings), no runtime change.
- Lesson: GitHub handed the final job to the host runner 37 minutes after it was queued (queued 11:56 KST, started 12:33 KST) on both attempts; the first attempt was cancelled and re-run before this was understood, which cost one extra 40-minute backup. A queued self-hosted job is not proof that the runner is broken: wait at least an hour before cancelling. The owner's runner restart at 12:49 KST was not needed.
- The independent liveness routine now expects `841038612`.

## Update 2026-11-19 06:30 UTC (15:30 KST): end-of-day state

- Deployed: main `841038612` (release run 44443029114), COLLECT_ONLY, orders OFF, Release=HOLD. `/health` at 15:11 KST: ok, `eventLoopMaxStallMs` 1271 ms, 1 stall. The independent 2-hourly liveness routine (trigger `trig_01ARumRPAxZ4oEPxHa6MccsT`) expects `841038612`.
- Merged today: C5 dead-man (#3197, #3199), findings (#3200), handoff (#3196), Cloudflare S1 update (#3201), S2 design (#3203), S2 non-gating shadow (#3204), permit inventory result (#3205). No runtime change since `979986a88` except workflows, tests and docs.
- Cloudflare S2 evidence count: the audit-release workflow prints `RELEASE_CONTROL_SHADOW` lines (Worker answer against `config/release-control.json` read from the audited base). 2 of 20 matches so far (#3203, #3205: both `match=true`, both docs PRs). Needed: 20 consecutive, at least 3 touching workflows or release paths; a mismatch restarts the count. `match=na` lines do not count. Read them from the release job log of each `audit:<pr>:...` run (`get_job_logs`, search the text). S3 (switching) and the path rule that blocks auto-merge of PRs touching the file are not started.
- Permit producer: host inventory recorded (design doc section 7): no permit store, 0 calibration and 0 outcome samples, 0 candidates; futures data exists but is thin (380 klines). Decision 2 stands.
- Learning loop (L1-L8): unchanged (L1 blocked, 0 candidates pass). Next dated items: trade-flow v2 first result on or after 2026-11-21 KST; a third order-book run needs a NEW pre-registration after gap-free collection (coverage 68.8 % of 90 %); futures needs an owner choice of a data source reachable from the host (HTTP 451).
- Lessons: a queued self-hosted job can wait 37 minutes for GitHub to hand it over; wait an hour before cancelling. Messages I create through the GitHub tools are authored by the owner's account, so GitHub does not notify the owner of them (the alert drill was cancelled by the owner: no alarms wanted).
- Open owner items: futures data source; (optional) the repository variable `NUSA_MOBILE_API_BASE_URL` value and the installed app's origin for the S1 check; the picomatch exception expires 2026-12-02 (exit: a fixed picomatch release or an override); no release inside 2026-11-24T06:00Z..2026-11-28T06:00Z.
