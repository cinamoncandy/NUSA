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

## Claude Code session reliability

To prevent reports of completion that do not match actual remote state:

- **Verification is mandatory**: Every completion report must include actual evidence via `git log`, `git status`, or CI confirmation. Never claim "done" without proof.
- **Evidence format**: Show terminal output showing the last 3-5 lines of test results or `git log origin/BRANCH -3 --oneline` and `git status` side-by-side in the report.
- **Infinite loop detection**: If the same confirmation question repeats (unchanged) twice in a row despite different input, treat the session as stuck. Do not attempt a third iteration. Instead: identify the root cause, explain why it blocked, and suggest a restart.
- **Device-specific roles**:
  - PC-based work (diagnosis, debugging, test verification): highest priority. Terminal logs reveal root causes faster.
  - Mobile-only approvals (merge/cancel decisions, lightweight interaction): acceptable.
  - If diagnosis requires terminal access but only mobile is available, defer to GitHub web UI for accurate branch/PR/CI state before relying on Claude Code reports.

## Definition of done

A task is complete only when:

- implementation is present,
- relevant tests exist,
- validation status is truthful,
- safety boundaries are preserved,
- documentation and AIPOS state are updated,
- no known critical issue is hidden,
- **completion is verified with actual git/CI evidence, not assumptions**.

## Current priority

Follow `.aipos/state.yaml`. At the time this entrypoint was updated, the priority was to complete NUSA's cross-AI repository continuity contract while preserving the Upbit spot paper-trading safety boundary.
