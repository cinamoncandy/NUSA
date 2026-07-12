# Strategy Governance v1

## Purpose

Strategy Governance prevents research output from becoming an operating strategy automatically. It is a deterministic, PAPER/DRY_RUN-only control layer: `DRAFT -> RESEARCHING -> VALIDATED -> PAPER_CANDIDATE -> PAPER_ACTIVE -> PROMOTION_PENDING -> CHALLENGER -> CHAMPION`, with explicit `SUSPENDED`, `ROLLED_BACK`, `RETIRED`, and `REJECTED` outcomes.

## Research and promotion

The existing Research Gate decides whether research evidence is sufficient to enter Paper evaluation. The Promotion Engine additionally requires matching feature fingerprints, paper duration/trade evidence, availability, execution quality, no unresolved faults, and cost/ruin/walk-forward gates. Missing validation rejects; missing Paper evidence requires more Paper. Promotion produces a Challenger only. Champion replacement is a separate comparison.

## Champion and rollback

A family has one Champion. A Challenger must use a comparable market segment and exceed the Champion in net return and Sharpe without worsening drawdown, profit factor, execution quality, availability, or faults. Ties and immaterial differences keep the existing Champion deterministically. Previous Champions are represented by a supersession audit event rather than a destructive lifecycle rewrite.

Kill switch, unresolved exposure/faults, feature drift, data-quality failure, partial-hedge recovery failure, drawdown, Sharpe, execution-quality, availability, and drift conditions can suspend or roll back a strategy. No fallback Champion means suspension rather than an invented rollback target.

## Committee boundary and audit

Committee votes are structured inputs only; no LLM is called. RISK, EXECUTION, or CIO rejection vetoes promotion, and scores never override hard safety rules. Registry identity and all lifecycle actions are append-only hash-chain events. The SQLite store writes registry, ledger, state snapshot, and Champion assignment transactionally and fails closed on replay/snapshot disagreement.

## Safety boundary

This is not a profitability guarantee. It reduces model-risk and operational-risk ambiguity. There is no LIVE activation, live order path, private API, credential, or withdrawal capability. Any future live activation requires owner approval plus separate regulatory, security, reconciliation, and operational review.
