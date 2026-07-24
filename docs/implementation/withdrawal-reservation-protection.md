# Withdrawal reservation protection

The mobile treasury model treats an active withdrawal reservation as protected capital.

## Contract

- `tradingCapital` is the gross capital assigned to trading before withdrawal protection.
- `reservedWithdrawalCapital` is the sum of active `RESERVED` reservations.
- `deployableCapital = tradingCapital - reservedWithdrawalCapital`.
- `reserveCapital` and `pendingDepositCapital` are never deployable.
- `totalAssets` must equal `tradingCapital + reserveCapital + pendingDepositCapital`.
- Active reservations may not exceed trading capital.

## Safety behavior

Invalid amounts, duplicate IDs, inconsistent treasury totals, invalid timestamps, unknown releases, and over-reservation fail closed.

This module does not perform an exchange withdrawal. It only protects capital from allocation and execution until the owner completes or releases the reservation.

## Scope

- Pure TypeScript model
- Deterministic output
- No database access
- No exchange API
- No live order path
- No credentials
