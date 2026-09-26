# ADR-0018: Structured Agentic Quant Harness

- Status: Proposed for Core review
- Date: 2026-09-15
- Tracks: #1921
- Extends: ADR-0003, ADR-0006, #1605, #1906

## Context

NUSA already owns hardened Research validity boundaries, append-only hypothesis evidence, deterministic candidate gating, PAPER-only challenger semantics, provider abstraction, and zero-authority AI. The useful lesson from external structured-agent research is therefore not to create another research, league, execution, or lifecycle engine. The remaining architectural task is to make the cross-cutting engineering harness explicit and bind it to existing canonical owners.

External claims about model superiority, institutional-equivalent performance, operating cost, or profitable strategy families are not architecture evidence and are not adopted by this decision.

## Decision

NUSA SHALL use one canonical governed lifecycle for autonomous investment research:

`OBSERVATION -> HYPOTHESIS -> PRECOMMIT_SPEC -> EXPERIMENT_PLAN -> TEST_CONTRACT -> IMPLEMENTATION -> INDEPENDENT_FALSIFICATION -> CANONICAL_EVALUATION -> PROTECTED_OOS_WALK_FORWARD -> COST_STRESS -> QUALIFICATION_LEAGUE -> PAPER -> SHADOW_READINESS -> HUMAN_GOVERNED_LIVE_BOUNDARY`

This is an orchestration contract over existing canonical components, not a new state engine. Existing Research Factory, NUSA League, Risk Governor, PAPER execution/accounting, Deployment/Release gates, and AIPOS remain authoritative in their domains.

## Gate contracts

### 1. Immutable precommit/specification

Before protected validation is exposed, a versioned artifact SHALL freeze the falsifiable hypothesis, dataset roles, universe, feature/parameter search space, benchmark, evaluator semantics, cost assumptions, sample requirements, stopping/failure rules, and required risk evidence. Any material change creates a new hypothesis/experiment identity and retains lineage to the prior attempt.

### 2. Test-first invariant contract

Before candidate implementation is eligible for canonical evaluation, tests SHALL define at least provenance/no-lookahead, deterministic replay, accounting/cost invariants, numerical-finiteness behavior, stale/partial-input behavior, and authority boundaries. Passing implementation tests is necessary but never sufficient for investment qualification.

### 3. Separation of roles and authority

The producer of a hypothesis or implementation SHALL NOT be its qualification authority. AI agents may propose, implement candidates, critique, reproduce, and summarize. Deterministic canonical evaluators adjudicate evidence. Risk/Release owners retain independent authority. No AI confidence, vote, or consensus can weaken a deterministic gate.

### 4. Comparable Champion-Challenger evidence

Champion and Challenger comparisons SHALL bind evaluator version, dataset/provenance roles, cost model, code/config identity, and statistical-search history. Comparisons SHALL be net of canonical costs and include the canonical risk/robustness evidence applicable to the strategy family. A `CHALLENGER_BETTER` comparison remains evidence only and does not mutate Champion state.

### 5. Promotion ladder

Automatic authority ends at bounded research and PAPER/Shadow readiness evidence. Each promotion step consumes only evidence admitted by the preceding canonical gate. Failed, rejected, insufficient, conflicting, or unknown outcomes are append-only evidence and cannot be erased to regain a clean statistical budget. LIVE activation remains separately human governed.

### 6. Failure survival

Missing, stale, partial, corrupt, out-of-order beyond the canonical lateness contract, or provenance-ambiguous market evidence SHALL fail closed. NaN/Inf, solver failure, reconciliation conflict, evaluator-version mismatch, risk-limit violation, and incomplete restart state SHALL produce a deterministic HOLD/REJECT/UNKNOWN-class outcome owned by the relevant canonical subsystem; they SHALL NOT fabricate prices, fills, PnL, or qualification evidence.

Restart/replay SHALL preserve immutable identities and SHALL NOT duplicate experiments, OOS exposure budgets, candidate registration, evaluation, or PAPER deployment.

### 7. Degradation creates research, not direct retuning

PAPER/OOS calibration drift, signal decay, cost deterioration, regime/liquidity shift, unexplained drawdown, correlation convergence, contradictory evidence, or stale provenance MAY trigger a new versioned research question or revalidation request. They SHALL NOT directly retune or replace a deployed candidate.

### 8. Provider/model pluggability without authority drift

Model/provider replacement remains behind canonical provider contracts. Changing provider/model/prompt version changes evidence identity as required by existing AI governance but SHALL NOT change Risk, Research qualification, Release, execution, or LIVE authority.

## Strategy-family boundary

Ornstein-Uhlenbeck mean reversion, Avellaneda-Stoikov market making, Hawkes order-flow modeling, Heston stochastic volatility, and other literature-derived methods are research candidate families only. Literature reputation is not NUSA alpha evidence. Each family must independently survive canonical no-lookahead, multiple-testing, cost/slippage/latency/turnover/liquidity/capacity, robustness, protected OOS, and PAPER-forward validation where applicable.

## Definition of self-improvement

Code churn, model replacement, higher backtest return, or a higher qualification pass rate is not self-improvement. A change is an investment improvement only when precommitted, comparable canonical evidence demonstrates improvement against the relevant baseline while all provenance, uncertainty, cost, robustness, and independent Risk constraints remain satisfied.

## Ownership and dependency order

P0 — preserve/complete precommit validity, protected OOS semantics, deterministic evaluator/risk verdicts, failure-survival, replay/idempotency, and role/authority separation.

P1 — complete production PAPER closed-loop composition (#1605), Champion-Challenger comparable evaluation, Shadow/readiness evidence, and degradation-triggered revalidation; then layer the bounded autonomous Investment Scientist (#1906) over those canonical owners.

P2 — admit mathematical strategy families and provider/model optimization only as versioned challengers after P0/P1 correctness is canonical.

## Acceptance

- Same authoritative evidence + same versioned state yields the same artifact and verdict identities.
- Material experiment changes cannot silently reuse a protected OOS budget.
- Implementer/proposer cannot self-qualify or self-promote.
- Missing/ambiguous/stale critical evidence fails closed.
- NaN/Inf/solver/reconciliation failures cannot become valid performance evidence.
- Replay/restart creates no duplicate experiment, evaluation, candidate, or PAPER deployment.
- Champion/Challenger comparisons reject incompatible evaluator/provenance/cost semantics.
- Degradation generates revalidation/new research identity rather than in-place retuning.
- Negative/null/insufficient/conflicting evidence remains immutable.
- No path created by this ADR grants AI LIVE, transfer, credential, Risk-policy, or Release authority.

## Non-goals

- No second Research Factory, League, portfolio, execution, service-container, plugin, or lifecycle engine.
- No automatic LIVE promotion.
- No threshold relaxation to improve pass rate.
- No hidden OOS reuse or uncontrolled parameter fishing.
- No synthetic fills/PnL represented as real evidence.
- No adoption of external marketing claims as engineering truth.

## Permanent authority invariants

`PAPER_ONLY`

`liveAuthority = NONE`

`productionMutationAllowed = false`

`aiAuthority = ZERO_AUTHORITY`

Risk, Audit, Release, kill-switch, and human-governed LIVE boundaries remain non-bypassable.