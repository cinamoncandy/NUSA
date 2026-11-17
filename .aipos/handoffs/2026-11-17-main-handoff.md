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
