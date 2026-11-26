# Alpha Lab × PAPER: folding the forward verification into Alpha Lab (PROPOSAL, 2026-11-26)

Korean summary (한 줄): 사장님이 "B"를 골랐다(PAPER의 앞으로-검증 기능을 알파랩 안으로 흡수). 이 문서는 그 방향의 **제안 계획**이며 코드 변경은 없다. 계좌, 쓰기 권한(Lease), 위험 한도, 킬스위치, 종료·복구는 지우지 않고 "PAPER 바닥(substrate)"으로 남긴다. 현재 동결 규칙상 서버 코드 PR은 2026-11-28 15:00 KST 이후에만 가능하고(계획이 아니라 동결), 서버 릴리스는 사장님 말씀 전에는 하지 않는 것이 세션 계획이다.

Status: **PROPOSAL.** Nothing here changes code, a gate, a limit, capital or an authority flag. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `aiAuthority=ZERO_AUTHORITY`, FAIL_CLOSED. Follows the owner's choice "B" of 2026-11-26 (recorded in `.aipos/decisions/ADR-RESEARCH-20261126-ALPHA-LAB-PIVOT.md`). Inputs: `docs/ALPHA_LAB_CLOSED_LOOP_DEPENDENCY_MAP_2026-11-26.md` (the map; section numbers below refer to it) and `docs/NUSA_PASS_TO_PERMIT_2026-11-25.md`.

## 1. What "B" means here
Alpha Lab (research: hypothesis frozen, point-in-time data, costs, OOS, robustness, verdict) would own the **whole candidate life** (proposed), including the forward step that today lives in the PAPER runtime:

RESEARCH (verdict) -> SHADOW (forward decisions and outcomes logged with cost fields, **no order path**) -> PAPER_EVIDENCE -> owner decision -> PERMIT producer (the existing design) -> Stage B only on the owner's fresh written approval.

Proposed: one module, one status object (`alphaLab` in `/health`), one ledger of decisions and outcomes. The learning-loop machinery (coordinator, rollover, bootstrap, research worker, lineage replay) is not carried over; it was withdrawn on 2026-11-26.

## 2. What stays (the PAPER substrate; not part of the fold-in, not removable by it)
Writer Lease and its fail-closed verification, PAPER account and accounting, canonical risk gate and risk-limit scaling, kill switch, trade-permission authority (`FALLBACK_NO_PERMIT`), graceful shutdown and prepared recovery, runMode and `orderPathReady`. The map (section 4 and R1 to R9) shows these are interleaved with the loop tick, which is why the fold-in is staged. Until the owner changes it, the node stays in COLLECT_ONLY (orders OFF).

## 3. Stages (proposed; each its own work order and PR; regression tests green before and after; each stage has a rollback: revert the PR, which must leave the node booting in COLLECT_ONLY exactly as before)
| Stage | Change | Gate before the next stage |
|---|---|---|
| S0 | Docs: importer table, this plan, the ledger schema (not yet written: one row per decision and per outcome with cost fields, as PASS-TO-PERMIT section 5 asks), the answers to section 6 | independent review; the owner's answers in section 5 |
| S1 | Put the loop behind a seam; same exports and signature | `production-entry-boot-modes`, `closed-learning-daemon-order-path-off`, `report-cloud-reachability`, `research-startup-recovery`, `paper-startup-lease-budget-2770` unchanged; R9 (the file path and compiled `.js` that the reachability, truth and release smoke checks require) still satisfied |
| S2 | Add the `alphaLab` status object and the contract "absent means UNKNOWN, never PASS" **first**, so the status stays safe while duties move (map section 5 step 4). Not yet determined whether `learningLoopVerdict.test.ts` already covers a missing `closedLearningLoop`; this stage settles it | learning verdict tests plus a new contract test; the phone tab can read it |
| S3 | Move the side duties out of the tick (Lease verify, owner-baseline period, meta-learning steering of `longBarTickEvery`, research snapshot refresh) with their own schedulers | Lease-loss and shutdown tests (`tests/paper-writer-lease-loss-fail-closed`, `paper-writer-lease-liveness`, `paper-writer-lease-auto-recovery`, `paper-writer-lease-recovery`, `closed-learning-daemon-fatal-exit`) green; R1, R2, R3, R6 and R7 closed (the baseline period opens a PAPER period and the baseline strategy is executable, not loop-only) |
| S4 | Add the shadow ledger module (append-only) | **Mechanisms, each test-backed:** a test that fails if the ledger module imports an order, repository, Lease or account module; a read-only database handle for anything it reads; a timer-count assertion in COLLECT_ONLY like `closed-learning-daemon-order-path-off`; its own env gate, separate from `ownerBaselineStrategyEnabled` (map section 5 step 5). Only then COLLECT_ONLY boot unchanged |
| S5 | Wire candidate admission RESEARCH -> SHADOW from an Alpha Lab verdict plus an owner-approved policy file | owner approval; independent review |
| S6 | Retire the loop-only modules leaf-first, updating the text-reading guards in the same change (map section 3a) | R4 (governance approval wiring: `closed-learning-governance-wiring`), R5 (evidence identity bound to the PAPER risk policy: `paper-risk-limit-scaling`), R9 (the `report-cloud-reachability` and `validate-repository-truth` file lists); a release that already ran inert for a period |
S1 to S6 are server code: by the current freeze (handoff 2026-11-26 02:50 KST) PRs only after 2026-11-28 15:00 KST; a host release only when the owner says so (the session plan is none before 2026-12-10, a plan and not an owner rule).

## 4. What this does not do
No order path, no Stage B, no policy value, no threshold, no capital or risk-limit change, no claim that a candidate exists (none has passed), no release.

## 5. Open questions for the owner
1. **Who implements** S1 to S6: Codex (its Alpha Lab branch is unpublished; scope unknown) or the Claude CORE session. `AGENTS.md` makes CORE the default implementer; Codex's work must not be duplicated.
2. Whether the shadow ledger replaces the existing PAPER period evidence (`persistedPaperPeriod`) or sits beside it (the map shows the evidence fingerprint binds the PAPER risk policy; R5).
3. Timeline and the acceptance criteria for "Alpha Lab done".

## 6. Not determined (from the map, section 7)
Whether anything besides the tick keeps the Lease heartbeat alive; the exact `/health` of a freshly booted COLLECT_ONLY node; where the safety invariants are enforced outside this file; whether the Cloud AI runtime is read-only. These must be answered by S0 before S1 (the Lease heartbeat question before S3). Also missing before S1: the baseline `/health` of a fresh COLLECT_ONLY node, and the scope of Codex's Alpha Lab branch.
