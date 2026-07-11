# Next Task

## SQLite Persistence Audit Update

The desktop main process now has a transactional runtime-command boundary. It captures PaperBroker, ControlPlane, and StrategyEngine running state before every mutating command; commits the complete runtime state to SQLite; and restores the captured state if persistence fails. After a persistence failure it marks the runtime unavailable, stops the strategy, faults the Control Plane, and rejects later commands with a safe operator-facing message.

Protected paths:

- manual BUY and SELL;
- strategy start and stop;
- automatic-trading toggle;
- order-quantity changes;
- automatic signal claiming and automatic Paper execution.

Legacy Paper and Control JSON files remain untouched. They are strict-validated, one-time migration inputs only. SQLite corruption, partial state, unknown migration versions, and command-time write failures all fail closed. Automatic trading still restores OFF after restart.

Latest verified validation:

- commit: `dee032db26169ead09897b583a89bf756da1eec8`
- Windows CI run: `#98`
- `pnpm install --frozen-lockfile`: PASS
- `pnpm run typecheck`: PASS
- `pnpm test`: PASS (56/56)

## Remaining SQLite Audit Work

- Review persisted-state decoding against the RFC's full relationship and integrity-check requirements.
- Decide whether to add checksum/name fields to the migration ledger; current runner stores ordered ID and timestamp.
- Review operator recovery guidance before removing or renaming any legacy JSON data.
- Keep PR #1 Draft and do not merge without owner approval.

## After This Task

1. Audit the SQLite persistence transition against `docs/rfc/0001-sqlite-persistence.md`.
2. Build the backtest engine against the same strategy, risk, accounting, and repository contracts.
3. Add Telegram Remote Center v1 for read-only status and alerts.
