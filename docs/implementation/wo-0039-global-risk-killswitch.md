# WO-0039 Global Hard Risk Gateway & Kill Switch

This slice adds deterministic hard-risk evaluation and an independently latched stop authority. It does not add broker execution, order mutation, execution credential use, or real-money execution.

Hard risk is provider-independent and outside learned strategy authority. Safety-critical `UNKNOWN`, reconciliation mismatch/unknown, stale or disconnected market data, unsafe runtime state, or an active kill switch fail closed. Numeric hard limits cover order notional, aggregate/strategy/symbol exposure, drawdown, open-order count, position count, and concentration.

The kill switch is latched and cannot be released by AI, Meta-AI, automation, a strategy, or an adapter. Release requires two distinct HUMAN approvers plus SAFE operational evidence, hard-risk PASS, reconciliation MATCH, healthy market data, and zero unresolved execution states. Releasing the stop does not authorize `ACTIVE` and does not enable real-money execution.
