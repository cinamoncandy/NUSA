# Capital Allocation Protection

`capitalAllocationGuard.ts` is a pure mobile-domain guard between protected treasury state and future spot/futures allocation logic.

## Contract

- Only `deployableCapital` may be allocated.
- Withdrawal reservations, reserve capital, and pending deposits are never allocatable.
- Spot and futures requests are rejected when their total exceeds deployable capital.
- Unallocated deployable capital remains cash.
- Duplicate allocation identifiers, invalid money, and malformed identifiers fail closed.
- Output ordering is canonical and deterministic.

## Safety boundary

This module does not place orders, call exchange APIs, change leverage, or move funds. It only validates a proposed allocation for later presentation and server-side enforcement.
