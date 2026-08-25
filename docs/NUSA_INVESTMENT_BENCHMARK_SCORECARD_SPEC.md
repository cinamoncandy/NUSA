# NUSA Investment Benchmark Scorecard v1

This specification defines the first implementation slice of the Investment Performance Engine roadmap.

## Purpose

Convert existing deterministic `ResearchExperimentResult` outputs into a comparable, fail-closed research scorecard. The scorecard is descriptive research evidence only. It never authorizes PAPER or LIVE execution.

## Slice identity

Every scorecard row is bound to dataset provenance:

- dataset ID
- content SHA-256
- market
- interval
- candle count
- exact OOS window/point/trade counts

## Required metrics

- compounded OOS total return
- maximum drawdown
- average benchmark return
- average benchmark outperformance
- profitable-window ratio
- benchmark-outperformance-window ratio
- turnover
- total trading cost and cost burden
- parameter-selection churn
- return-to-drawdown ratio when defined

## Default eligibility guardrails

A slice is ineligible when any default guardrail fails:

- at least 2 complete OOS windows
- at least 20 OOS points
- at least 1 closed OOS trade
- maximum drawdown no greater than 35%
- benchmark outperformance in at least 50% of OOS windows
- parameter-selection churn no greater than 75%

These are research-quality defaults, not claims of optimal portfolio risk limits. They may be overridden by explicit versioned research policy.

## Coverage diagnostics

A multi-slice scorecard warns when evidence is narrow:

- fewer than 3 research slices
- only one market
- only one interval

Warnings do not silently convert narrow evidence into broad evidence.

## Ranking

Eligible slices receive a deterministic composite research score using return, benchmark outperformance, drawdown, profitable-window ratio, benchmark-outperformance ratio, selection churn, and cost burden. Ineligible slices remain visible but rank after eligible slices.

The composite score is a comparison aid, not a profit forecast and not an execution signal.

## Safety

- `liveAuthority = NONE`
- `productionMutationAllowed = false`
- AI authority = `ZERO_AUTHORITY`
- no broker, credential, Risk, order, transfer, withdrawal, or LIVE mutation
