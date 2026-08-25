# AGENTS.md

These rules apply to every human or AI agent working on NUSA.

## AIPOS recovery is mandatory

Before planning, editing, or generating code:

1. Read `.aipos/aipos.yaml`.
2. Read `.aipos/state.yaml`.
3. Follow the recovery protocol and active work order referenced there.
4. Read `.aipos/architecture.md`, `.aipos/context.md`, and relevant decisions.
5. Verify changes with the commands recorded in the work order.
6. Update `.aipos/state.yaml` and the active work order before stopping.

Do not rely on prior conversation history. The repository is the source of truth. Vendor-specific instructions may supplement AIPOS but cannot replace it.

## Read first

Before changing code:

1. Complete the AIPOS recovery steps above.
2. Read `nusa.md` when the task touches the current paper-trading application.
3. Inspect the active branch, open PR, tests, and CI state.
4. Preserve existing architecture unless a documented decision justifies a change.
5. State the intended profit, safety, efficiency, or convenience impact of the work.

## Safety rules

- Never enable live trading without explicit owner approval and an accepted AIPOS work order.
- Never commit API keys, secrets, tokens, credentials, account identifiers, or private trading data.
- Never change repository visibility, delete branches, rewrite shared history, or remove production data without explicit approval.
- Risk checks must not be bypassed by UI, strategy, automation, or exchange adapters.
- Automatic trading defaults to disabled after fresh install, recovery ambiguity, or fault.
- Fail closed when market data, persistence, reconciliation, account state, or AIPOS safety state is uncertain.

## Architecture rules

- Strategy emits signals; it does not place orders.
- Decision converts evidence and policy into an intent.
- Risk may reject, resize, pause, or halt an intent.
- Execution receives approved orders only.
- Exchange-specific code stays behind adapter contracts.
- Upbit spot and Binance futures must remain separate domain implementations.
- Paper and live adapters may share interfaces but must not share mutable operating state.
- Electron renderer must not receive Node.js or credential access.
- AIPOS integrates through the existing NUSA runtime; do not create a parallel kernel, plugin system, service container, or lifecycle framework.

## Engineering rules

- Keep changes small, reviewable, and reversible.
- Add or update tests for every behavior change.
- Preserve deterministic accounting, recovery, and idempotency.
- Avoid hidden global state and implicit side effects.
- Validate all IPC and external data at trust boundaries.
- Prefer explicit domain types over loosely shaped objects.
- Do not add dependencies without a clear need and license review.
- Do not claim tests passed unless they were actually run or CI confirms them.
- Update AIPOS state whenever architecture, scope, current work, or next work changes.

## PR and CI noise prevention

These rules are mandatory for every AI coding agent and are specifically intended to prevent repeated failing GitHub Actions runs and notification spam.

1. **Do not open, reopen, or refresh a pull request before local validation passes.** At minimum run the relevant targeted tests plus `pnpm run preflight`; for changes that can affect repository-wide contracts, run the work-order validation command or `pnpm run validate:full` when available.
2. **Verify repository reality before remote work.** Treat reported branch names, commit SHAs, PR state, and CI state as untrusted until the current repository or GitHub confirms them. Do not plan a push, PR, merge, or recovery around a missing/unreachable SHA.
3. **Start remote CI from current `main`.** Immediately before opening or materially refreshing a PR, fetch/inspect current `origin/main`. If `main` advanced and the branch can be safely updated, update it first and rerun the affected local validation. Do not spend a full CI cycle on a knowingly stale base only to discover avoidable merge/protection drift later.
4. **One task = one active branch = one active PR.** Before creating a branch or PR, search for an existing open PR for the same task and continue there. Never create a follow-up PR merely because CI failed.
5. **A closed PR is dead unless the owner explicitly asks to revive it.** Do not reopen a closed PR, push new commits to its old remote branch, or create another PR from that same branch automatically.
6. **When CI fails, stop remote churn.** Diagnose locally, fix locally, and rerun the failing test locally. Push only after the local reproduction passes. Do not use GitHub CI as an iterative debugger.
7. **Never push speculative fixes one-by-one to make CI discover the next stale assertion.** Search the affected contract/test family first and correct the whole known stale set locally before the next push.
8. **Do not auto-create replacement PRs.** If a PR was closed by the owner or by cleanup, leave it closed and wait for an explicit new instruction before opening any replacement.
9. **Respect notification-stop instructions as a hard hold.** If the owner says to stop CI/failure emails or stop opening PRs, no agent may create/reopen/synchronize a PR until the owner explicitly resumes that work.
10. PR descriptions must report the exact local validation actually run. Missing validation means the PR must remain local and must not be opened.

## Trading research rules

- Do not promote a strategy based only on in-sample backtests.
- Include fees, slippage, latency assumptions, and missing-data behavior.
- Require out-of-sample or walk-forward evidence before paper promotion.
- Require paper evidence before live-candidate status.
- Track regime sensitivity, drawdown, exposure, turnover, and parameter stability.
- Treat AI output as untrusted advice until validated by deterministic controls.

## Git workflow

- Use feature branches.
- Do not push risky work directly to `main`.
- Commit messages must describe behavior, not vague activity.
- Update project-state documentation when architecture, scope, or next tasks change.
- PR descriptions must include safety boundaries and real validation status.

## Definition of done

A task is complete only when:

- implementation is present,
- relevant tests exist,
- validation status is truthful,
- safety boundaries are preserved,
- documentation and AIPOS state are updated,
- no known critical issue is hidden.

## Current priority

Follow `.aipos/state.yaml`. At the time this entrypoint was updated, the priority was to complete NUSA's cross-AI repository continuity contract while preserving the Upbit spot paper-trading safety boundary.
