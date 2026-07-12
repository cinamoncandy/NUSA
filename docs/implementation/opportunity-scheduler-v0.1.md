# Opportunity Scheduler v0.1

This module ranks live opportunities, removes unsafe overlap, and allocates only deployable PAPER/DRY_RUN capital.

## Score

`score = net edge × confidence × execution quality × liquidity × remaining lifetime ratio × regime fit`

Candidates with expired lifetime, non-positive net edge, or score below the configured floor are rejected.

## Budgets

- Total allocation cannot exceed the configured portfolio allocation.
- Same-direction opportunities with correlation >= 0.80 share a separate correlation budget.
- Per-opportunity allocation is capped.
- Unused deployable capital remains reserved cash.
- Kill Switch or zero deployable capital rejects all candidates.

## Safety boundaries

- PAPER and DRY_RUN only.
- No exchange adapter or order command path.
- Duplicate opportunity IDs and malformed conflict graphs fail closed.
- Results are deterministic and immutable.
- Withdrawal-reserved funds must be removed before `deployableCapital` is supplied.
