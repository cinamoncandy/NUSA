# AIPOS handoff — Claude takeover (2026-10-12 UTC)

Provider-agnostic: any capable AI can continue from this file, `.aipos/state.yaml` and the work orders named below. The
facts here are a dated snapshot; the **No-Guess Rule** applies, so re-verify branch, PR, CI and runtime state before acting.
`AGENTS.md` and `.aipos/AI_HANDOFF_CONTRACT.md` stay authoritative.

## Safety constraints and prohibited actions
- PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.
- Never loosen capital, risk limits or thresholds (consecutive-loss limit stays 3). No LIVE, real-money, credential or broker action.
- Never merge or approve your own PR; never bypass Audit or Release; never delete branches; never rewrite shared history.
- Deploy only after main CI succeeds, with the full 40-hex main SHA, via the owner's standing approval for
  `oracle-paper-release.yml` (stop if main moved; verify the dispatched run's head_sha equals the target).
- Paid AI calls only within the owner's directive (a daily cap PR was open; verify before relying on it).

## Repository and runtime state at handoff
- Protected main: `808510a6cc768a5a2bde3104da50b6e8223d1730` (re-check). Trading server was at `4a26f767` on 2026-10-12; the
  Autopilot Worker reported `e522f60d`. Both lag main; deploy per the rule above only when main CI is green.
- Blocker cleared: canonical P0 #1461 (Cloudflare credential/runtime baseline) closed after #2632 and #2635 merged and a
  manual Credential Preflight on main `d5aec9da` passed. The release bot (`nusa-release-authority[bot]`) merged #2636 normally.
- Owner must confirm: main branch protection "Do not allow bypassing the above settings" is enabled again (sessions cannot read it).

## Open pull requests (merge is by the release bot or the owner)
| PR | Purpose | Base at handoff | Work order |
|---|---|---|---|
| #2637 | deterministic completion-receipt classifier | main | WO-AUTOPILOT-20261012-COMPLETION-RECEIPT-CLASSIFIER |
| #2638 | record verified receipts in the execution coordinator | #2637 branch | WO-AUTOPILOT-20261012-COMPLETION-RECEIPT-WIRING |
| #2639 | evidence producer on `GET /release/status` | #2638 branch | WO-AUTOPILOT-20261012-COMPLETION-RECEIPT-PRODUCER |
| #2633 | SMA and breakout/mean-reversion research note | main | WO-RESEARCH-20261012-SMA-60M-OOS |
| #2586 | offline consecutive-loss limit 3/4/5 comparison (old; 4 and 5 are censored by the ledger) | main | WO-RISK-20261008-LOSS-LIMIT-COMPARISON-TOOL |
| #2640 | CLAUDE.md and this handoff | main | WO-DOCS-20261012-CLAUDE-HANDOFF |

Stack rule: when a lower PR merges, retarget the next PR to main and merge main into it. `.aipos/state.yaml` receives an
appended entry from every PR, so concurrent PRs conflict at the file end: merge main and keep both sides.

## Decisions made and rationale
- Completion receipt design (merged, `docs/AUTOPILOT_COMPLETION_RECEIPT_DESIGN.md`): store in the existing execution
  coordinator record; require runtime verification only when the change touches Worker runtime inputs (reuse
  `scripts/autopilot-worker-deploy-scope.js`); trust only the release app's approval (`TRUSTED_RELEASE_AUTH_APP_ID`);
  expose a receipt count only after a real receipt exists.
- Owner baseline fingerprint is independent of the deployed commit (periods no longer mix across deploys).
- Failed-strategy memory informs Research N+1 but does not steer scheduling or budgets (owner chose "record only").
- Adaptive research scheduling and a 240-minute interval were declined or deferred.

## Known failures and blockers
- Learning loop 0/7: the running strategy is the owner baseline (`owner-baseline-sma-5-20`), which has no Research lineage, so
  `PAPER_RESEARCH_LINEAGE_UNAVAILABLE` blocks every learning cycle. A Research candidate that passes screening and is deployed
  is required. Do not attach a synthetic lineage to the baseline: that would record an unscreened strategy as screened.
- The consecutive-loss limit (3) blocks every BUY until the KST day resets (15:00 UTC); there are no fills while it is reached.
- Research failures repeat (`FAIL_NO_EDGE`, `FAIL_EXCESSIVE_DRAWDOWN`); screening shows SMA 5/20 on 1-minute bars loses mostly to fees.
- `AUTOPILOT_VERIFIED_COMPLETION_LOOP=false`: no completion receipt exists. A real eligible code failure must go patch, PR,
  exact-head CI, independent Audit, governed merge and receipt. Do not fabricate one.

## Evidence references
- Research notes: `docs/RESEARCH_NOTE_2026-10-08_SMA_COST_SCREEN.md`, `docs/RESEARCH_NOTE_2026-10-12_SMA_60M_OOS.md` (the
  latter is in #2633); scripts `scripts/offline-sma-cost-screen.js`, `scripts/offline-sma-oos-screen.js`,
  `scripts/offline-breakout-meanrev-screen.js`; frozen data under `docs/research-data/`.
- Runtime health: `https://nusa-api.duckdns.org/health` and `https://nusa-autopilot.desporin12.workers.dev/health`.

## Verification commands (cloud sandbox)
- `npx tsc -p tsconfig.json`, then `node -r ./tests/register-dist.cjs --test <dist test file>`; run every test that references
  a changed file before pushing. A stale `dist/**/*.test.js` with no source is not a real failure.
- Validators: `node scripts/validate-{aipos-yaml,repository-truth,safety-architecture,ai-zero-authority,repository-portability,platform-independent-tests}.js`
  and `node scripts/aipos-work-order-index.js --check`. `check-runtime` and `validate:full` need Node 24 and are left to CI.

## Next permitted actions (in order)
1. Re-verify main, the PRs above, CI and the runtime health endpoints.
2. Continue existing PRs only; one task is one branch and one PR. Retarget and update stacked PRs as lower ones merge.
3. After the receipt stack merges and main CI is green, deploy main by the standing procedure so the receipt path exists on the Worker.
4. Next research (owner approval needed before any strategy change): pre-registered walk-forward and per-regime tests of a new
   signal family, then a formal Research experiment for any survivor.
5. Await owner decisions: pending-order binding on candidate transition, adaptive research scheduling, longer-history
   research, export of the ledger's completed-sell list, and whether to use the Codex automation or replace it.

## Working notes
- The owner writes Korean in easy language and dislikes notification floods: answer only when action is needed, briefly.
- CI traps: a `test` gate failure after a newer push cancelled earlier jobs is a stale-head artifact (compare PR head SHA with the run's
  head_sha); `nusa/release-authorized` fails while review threads are unresolved; GitHub 5xx in a job log is transient, so re-run once
  without changing code.

## Evening addendum (2026-10-12 UTC): owner decisions and what is deferred
Snapshot; re-verify against GitHub (No-Guess Rule). Protected main at addendum time: `07e8e694a487157c6ec34a5bb38537279fe90ea5`.

### Roles and direction (owner)
- The owner will use **another Claude account as the main coding tool**; the session that wrote this addendum is the **assistant**. Autopilot is the assistant side and prefers **light work** (a 150 changed-line proposal limit is merged in main via #2643 but the Worker is **not deployed** with it).
- **GitHub account separation is planned for 2026-10-13.** The owner-activity gate (#2644, shipped disabled) watches the main Claude's GitHub login and must stay disabled until the owner supplies two distinct logins (main Claude side, assistant/automation side) and confirms Worker, Codex and assistant sessions do not use the watched account. Owner pause command and re-push behavior are decided in `docs/AUTOPILOT_OWNER_ACTIVITY_GATE_DESIGN.md` (#2641).

### Redesign tomorrow (owner)
- The owner will **redesign on 2026-10-13**. Until then the redesign-related PRs carry the `HOLD` label and must not be merged or deployed: #2637, #2638, #2639 (completion receipt stack), #2641, #2642, #2644. The label's effect on the release bot was not verified.
- Do not deploy the Autopilot Worker before the redesign decision.

### Rename (owner decisions so far)
- Product **NUSA -> Dokkebi**; AIPOS -> **도깨비터 / Dokkebiteo**; GitHub repository -> **Dokkebi** (owner account unchanged: `cinamoncandy/Dokkebi`).
- Phase 1 (user-visible text) is in #2645. The phase 2 inventory and migration plan is in #2646 with five open owner decisions (AIPOS folder rename, app ids, hostnames, parallel required check and release app, history policy).
- **The repository rename is deferred until after tomorrow's redesign.** Before it: make every repository allowlist accept both `cinamoncandy/NUSA` and `cinamoncandy/Dokkebi` through one central constant (this widens a safety boundary, so it needs independent Audit), then rename, then verify Autopilot dispatch, the release bot, required checks and deploys, then remove the old name. Hard-coded repository names found: 13 runtime/Worker sites, 10 scripts, 1 workflow, 72 test files; at least nine allowlist comparisons (coding runner, Audit runner, execution envelope, GitHub executor, execution spine, OIDC `claims.repository`). The Worker rejects OIDC tokens whose repository claim is not the allowed name, so renaming first would stop Autopilot.
- Do not rename the Android/desktop app ids or `productName` without a separate owner-approved data-migration design. Past records (constitution, audits, decisions, work orders) are not edited.

### Safe next actions for a new session
1. Re-verify main, open PRs (#2633, #2586, #2637-#2639, #2641, #2642, #2644-#2646) and labels; respect `HOLD`.
2. Wait for the owner's redesign and the two GitHub logins; then act on the decisions, one task per PR.
3. Never merge your own PR, bypass Audit or Release, enable the owner-activity gate before account separation, or rename the repository.
