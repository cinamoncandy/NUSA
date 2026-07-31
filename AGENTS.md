# AGENTS.md

These rules apply to every human or AI agent working on NUSA.

## Read first

Before changing code:

1. Read `NUSA.md`.
2. Inspect the active branch, open PR, tests, and CI state.
3. Preserve existing architecture unless a documented decision justifies a change.
4. State the intended profit, safety, efficiency, or convenience impact of the work.

## Safety rules

- Never enable live trading without explicit owner approval.
- Never commit API keys, secrets, tokens, credentials, account identifiers, or private trading data.
- Never change repository visibility, delete branches, rewrite shared history, or remove production data without explicit approval.
- Risk checks must not be bypassed by UI, strategy, automation, or exchange adapters.
- Automatic trading defaults to disabled after fresh install, recovery ambiguity, or fault.
- Fail closed when market data, persistence, reconciliation, or account state is uncertain.

## Architecture rules

- Strategy emits signals; it does not place orders.
- Decision converts evidence and policy into an intent.
- Risk may reject, resize, pause, or halt an intent.
- Execution receives approved orders only.
- Exchange-specific code stays behind adapter contracts.
- Upbit spot and Binance futures must remain separate domain implementations.
- Paper and live adapters may share interfaces but must not share mutable operating state.
- Electron renderer must not receive Node.js or credential access.

## Engineering rules

- Keep changes small, reviewable, and reversible.
- Add or update tests for every behavior change.
- Preserve deterministic accounting and idempotency.
- Avoid hidden global state and implicit side effects.
- Validate all IPC and external data at trust boundaries.
- Prefer explicit domain types over loosely shaped objects.
- Do not add dependencies without a clear need and license review.
- Do not claim tests passed unless they were actually run or CI confirms them.

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
- documentation is updated when needed,
- no known critical issue is hidden.

## Current priority

Finish a reliable Upbit spot Paper Trading foundation before any live trading or Binance futures implementation.
