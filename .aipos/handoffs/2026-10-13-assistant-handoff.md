# AIPOS handoff 2026-10-13 (assistant Claude)

Written by the assistant Claude session (role: VALIDATOR/RESEARCH and operations in the proposed redesign). It continues `.aipos/handoffs/2026-10-12-claude-handoff.md`. Snapshot at 2026-10-13 00:05 UTC; re-verify on GitHub before acting (No-Guess Rule).

## Safety constraints (unchanged)
PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY. No capital, risk or threshold loosening; the consecutive-loss limit stays 3. Never merge or approve your own PR, never bypass deterministic Audit or the release bot, never delete branches. One task = one branch = one PR.

## What happened in this session (after the 2026-10-12 handoff)
1. **Claude-centered redesign, revision 2 — merged as PROPOSED** (#2650, merged by the release bot 2026-10-12 22:40 UTC). Design: `docs/CLAUDE_CENTERED_OPERATING_MODEL.md`; ADR `ADR-OPS-20261013-CLAUDE-CENTERED-OPERATING-MODEL` (PROPOSED). Nothing in it is adopted until the owner answers its six decisions (section 10).
   - Re-verified the notification flood: 230 Autopilot Execution Consumer failures on 2026-10-12 (26 on 2026-10-11). Three causes: the temporary Dokkebi rename (repository mismatch), Autopilot treating failures of non-code workflows as repair targets, and unlimited re-dispatch of the same work. Consumer runs are triggered as `cinamoncandy`, so failures notify the owner.
   - Main protection verified: required check `nusa/release-authorized` (app 4935691), enforcement `everyone`.
2. **P1 Autopilot fixes (owner chose "P1 시작")** — both DRAFT, CI green, waiting for a non-author review:
   - **#2651** `claude/autopilot-repair-target-allowlist` (head `0d0873a2`, WO-AUTOPILOT-20261013-REPAIR-TARGET-ALLOWLIST): only failed/timed-out `CI` and `Autopilot Sandbox New-File Guard` runs become repair targets — scheduled path (`scheduledRuntime.ts`, `scheduledEvolutionCoding.ts`, new `repairableWorkflowRun.ts`) and webhook path (`dispatchPlanner.ts`). The 22:06/22:11 UTC failures on 2026-10-12 were webhook repairs of a cancelled Android Stable Release Trigger run (run 38314706259; artifact of run 38315180204: `CODING_RUNNER_FAILURE_EVIDENCE_INVALID`).
   - **#2652** `claude/autopilot-repair-attempt-cap` (head `6773b5c0`, WO-AUTOPILOT-20261013-REPAIR-ATTEMPT-CAP): optional `maxAcquisitions` on the execution coordinator's `/acquire`; scheduled evolution coding passes 3, then gets `ATTEMPT_LIMIT_REACHED`. Other acquire callers unchanged.
   - Regression tests reproduce the 2026-10-12 cases and fail on the old code. Local: autopilot dist tests pass except the stale `codingRunnerFailureClass.test.js` (no source); `tests/autopilot-*.test.js` 229/229.
   - The planned third P1 step (quiet expected stops) was **not** done: on current main the only remaining noisy expected stop is #2644's `OWNER_ACTIVE` returned as `FAILED_CLOSED`, which belongs in #2644 itself when its HOLD is lifted.
3. **Open-PR inventory (P3, list only)** — **#2653** `claude/open-pr-inventory`, open (docs only; may auto-merge): `docs/OPEN_PR_INVENTORY_2026-10-13.md` groups all 46 open PRs at the snapshot. Confirmed superseded: #1922 (replaced by the #1921 consolidate decision) and #2060 (replaced by #2115). #2327 is **not** superseded.
4. **Owner decision executed**: **#2311 closed** (not merged, 2026-10-13) — the PAPER initial-capital default stays KRW 10,000,000; branch `fix/paper-default-capital-5000` kept. Comment left on the PR.

## Open pull requests to watch
| PR | State | Waiting on |
|---|---|---|
| #2651, #2652 | Draft, CI green | Non-author review (main Claude), then the author marks Ready for review |
| #2653 | Open, docs only | CI, Audit, Release |
| #2637-#2639, #2641, #2642, #2644 | `HOLD` | Redesign decision 5. Do not enable #2644 before fixing its closed-gate-as-failure behaviour and separating the Worker identity |
| #2631 | Open | Redesign decision 3 (paid overflow daily cap) |
| #2633, #2648, #2586 | Open | Owner: keep as research records or close |
| #1922, #2060 | Draft | Owner approval to close (supersession confirmed) |

## What the owner still needs to decide
1. May #1922 and #2060 be closed?
2. Review #2651 and #2652 with the main Claude account.
3. The six redesign decisions: adopt roles/rules (and allow CLAUDE.md/AGENTS.md updates), GitHub identities (machine account, Worker GitHub App separate from the release-authority app), engine and paid-overflow cap, Codex assets, PR cleanup order, automatic review.
4. Which other inventory groups to close (group 6 stale September work; group 4 security PRs to re-check).

## Safe next actions for a new session
1. Read `.aipos/state.yaml` entries `current_ops_claude_centered_redesign`, `current_autopilot_repair_target_allowlist` (on #2651's branch), `current_autopilot_repair_attempt_cap` (on #2652's branch) and `current_ops_open_pr_inventory` (on #2653's branch until it merges).
2. Re-verify the PRs above. Respect `HOLD` and drafts; do not mark another author's draft ready.
3. After #2651/#2652 merge, the Worker auto-deploys from main: check `/scheduled/status` for `ATTEMPT_LIMIT_REACHED` and the Execution Consumer failure count. Owner's standing approval: dispatch `oracle-paper-release.yml` with the full main SHA after main CI succeeds when a runtime change needs it.
4. Do not re-enable Codex coding, enable the owner gate, close PRs or change identities without the owner's decision.

## Verification commands (cloud sandbox)
`npx tsc -p tsconfig.json`; `node -r ./tests/register-dist.cjs --test dist/apps/autopilot/src/*.test.js`; `node --test tests/autopilot-*.test.js`; `node scripts/validate-aipos-yaml.js`; `node scripts/validate-repository-truth.js`. `check-runtime` and full preflight need Node 24 (CI).
