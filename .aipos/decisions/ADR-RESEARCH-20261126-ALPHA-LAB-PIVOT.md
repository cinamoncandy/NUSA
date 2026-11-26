# NUSA Alpha Lab: the research direction moves from the closed learning loop to a validated alpha search (RECORDED 2026-11-26)

Status: **RECORDED from the owner's report; one decision confirmed by the owner in chat on 2026-11-26 ("학습폐루프 철회", below); the rest still open.** On 2026-11-26 the owner told the Claude session that Codex is working on replacing the closed learning loop with an "Alpha Lab", pasted Codex's hand-off for it, and answered "다 해" to recording it. Codex's branch is not published (see Evidence), so the scope below is the hand-off's own description. Nothing here changes code, a gate, a limit, capital or an authority flag.

Reported direction (not yet decided by the owner): strategy research is re-centred on **NUSA Alpha Lab**: a research system that looks for verifiable profit signals through the existing **Research Factory** (Issue #1094, `WO-ISSUE-1094-RESEARCH-FACTORY`), reused as the canonical path, not duplicated:

market observation -> hypothesis and candidate frozen -> point-in-time data -> cost-aware backtest -> walk-forward and OOS -> overfitting and robustness checks -> candidate verdict -> PAPER evidence.

Profitability or operational completion is accepted only with real evidence and independent review.

## Owner decision confirmed in chat (2026-11-26, "학습폐루프 철회")
The **closed learning loop as the strategy-research goal (the L1 to L8 targets of `docs/LEARNING_LOOP_LEVELS_20261112.md`) is withdrawn.** Meaning, and its limits: the L1 to L8 goal and its pass criteria are no longer a target or a gate for anything; the document is marked withdrawn. It does **not** by itself remove any code, stop any service, change the PAPER runtime, lease, risk limits or the host, or relabel past evidence; the running loop code stays until the staged cleanup below is decided and done. The 2026-11-18 decision (FORGE code-automation levels retired) is unchanged.

## Owner decision confirmed in chat (2026-11-26, "B")
Asked how Alpha Lab and PAPER trading relate (A: keep PAPER as a thin forward-verification path, B: fold it into Alpha Lab as a module, C: drop PAPER), the owner chose **B**: the forward verification (shadow recording of a candidate's decisions and outcomes) becomes part of Alpha Lab. Meaning and limits: a direction only; the staged plan is `docs/ALPHA_LAB_PAPER_FOLD_IN_PLAN_2026-11-26.md` (PROPOSAL). The PAPER substrate (Lease, accounts, risk gate, kill switch, shutdown, recovery) is **not** removed and no code, runtime or release changes follow from this record. Who implements it and when stay open.

## Owner decision confirmed in chat (2026-11-26, "니가 해봐" and "맞아")
Asked who implements the Alpha Lab x PAPER fold-in (Codex or the Claude CORE session), the owner answered "니가 해봐" and, when the session read it as "CORE implements", "맞아". Meaning and limits: the **Claude CORE session implements** the fold-in under `docs/ALPHA_LAB_PAPER_FOLD_IN_PLAN_2026-11-26.md`. Codex's own Alpha Lab branch is still unpublished and its scope unknown, so before S1 the session first reviews it if it appears and never duplicates what it already does. Server-code PRs stay frozen until 2026-11-28 15:00 KST; no host release before the owner says so; every stage keeps its regression gate and independent review; nothing here approves Stage B, a risk limit or capital.

## What is NOT decided (open, needs the owner)
1. ~~Whether the L1 to L8 targets are withdrawn~~ answered above. Still open: what the phone app's 학습 tab should say (it shows the loop steps, the COLLECT_ONLY pause and the learning results) and what to call the learning-related items in the handoff and mission records.
2. **Removal of any closed-loop code.** `apps/cloud/src/closedLearningProductionRuntime.ts` (629 lines) is also the production runtime root: PAPER runtime, account and accounting, writer Lease, risk limits, shutdown, recovery and research wiring, consumed by `scripts/start-cloud-runtime.js` and `scripts/start-cloud-paper-supervisor.js`. Deleting it or stopping the production process is **not proposed here** and needs the owner's decision; any cleanup would have to be staged with explicit dependency separation, a replacement path and regression tests first (`docs/ALPHA_LAB_CLOSED_LOOP_DEPENDENCY_MAP_2026-11-26.md`). Per the handoff section of 2026-11-26 02:50 KST (the owner lifted the code freeze for mobile-only PRs only), host and server PRs stay frozen until 2026-11-28 15:00 KST; the host release and restart freeze of the 2026-11-17 handoff covers 2026-11-24T06:00Z..2026-11-28T06:00Z, and the Claude session's plan is no host release before 2026-12-10 unless the owner says so (a session plan, not an owner rule).
3. The timeline, the owner's acceptance criteria for "Alpha Lab done", and the fate of the learning screen wording on the phone app.

## Ownership
Per the owner's report, Codex is doing the Alpha Lab implementation (the 2026-11-25 handoff already says "Codex is working on [the learning loop]; do not overlap", a Claude-session note taken from the owner's report). **Who implements the closed-loop cleanup is an open owner question**: `AGENTS.md` makes CORE (the Claude session) the implementer by default and the Codex runners were retired on 2026-11-15. The Claude CORE session: records this decision, maps dependencies read-only, and gives an **independent read-only review** of any published Codex branch or PR; never merges or approves its own or Codex's work. Strategy screens and forward pre-registrations by Claude (breadth filter, weekly trend, desk batch results) are separate research on hosted runners and are not affected.

## Evidence (what was verified on 2026-11-26)
- AIPOS had no Codex work order, claim branch or PR for this since 2026-11-20; no file in `main` contains "AlphaLab" or "알파랩".
- The hand-off cites base commit `9a30dac69dbf4ca4f792c557ba1d2c36ecd2fd76` (exists on `main`, the app 1.0.843 source) and last-seen `origin/main` `42159d092dd7af598258e4c8380c1cc9bf08eac8` (exists, the merge of #3330). Its branch `codex/alpha-lab-research-20261126` is **not on the remote**; the hand-off's new files (`apps/desktop/src/cloud/nusaAlphaLab.ts`, `.aipos/handoffs/2026-11-26-alpha-lab-pivot.md`, `.aipos/state.d/current_alpha_lab_pivot_20261126.yaml`) are not on `main`. The work sits unpublished in a GitHub Codespace and could not be inspected.
- Reported by Codex (unverified here): a new research-only entry `evaluateAlphaLabRun` delegating to `qualifyResearchFactoryRun`; `scripts/research-real-market-run.js` wired through it; focused tests 34 passed; typecheck, build, architecture, AI ZERO_AUTHORITY, AIPOS and security checks PASS; the Linux full test run **did not pass** (`tests/nusa-control-install.test.js` exceeded 120 s). #1605 is OPEN and not marked as operationally accepted. Codex states the work is not a finished Alpha Lab: no automatic strategy generation, no new real evaluation evidence, no independent review, no operational acceptance.

## Safety (unchanged)
PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `aiAuthority=ZERO_AUTHORITY`, FAIL_CLOSED. No real orders or transfers, no risk-limit relaxation, no synthetic performance, no unauthorized merge, deploy or restart, no AI self-approval.

## Next steps
1. The owner has Codex publish its branch as a **draft PR** (an outward action only the owner approves); the Claude session then reviews it read-only.
2. The owner answers the three open questions above; this record is then promoted to ACCEPTED.
3. Who does the closed-loop cleanup, and when, is for the owner to decide; if it goes ahead it should follow the staged order of the dependency map, after the host freeze.
