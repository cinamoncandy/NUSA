# Owner capital allocation boundary

The owner's `investmentCapitalWeight` is a portfolio-level ceiling between `0` and `1`.

It is deliberately a one-way constraint:

- it may reduce an allocation produced by the existing permission, risk, and capital engines;
- `0` prevents autonomous capital use;
- it cannot increase a smaller risk-gated allocation;
- it cannot convert a rejected allocation into permission;
- it grants no broker capability, LIVE authority, or production mutation authority.

This keeps owner capital preference separate from autonomous strategy selection and from hard risk controls.
