# NUSA Core Architecture Principle

**Status:** CORE / GOVERNING ARCHITECTURE DOCUMENT  
**Scope:** All NUSA architecture, AI, research, risk, execution, learning, deployment, and future capability work.

## Prime Directive

> **NUSA must be designed so that when new technologies emerge, the system can safely absorb, evaluate, replace, and evolve individual capabilities while preserving its core architecture and safety boundaries.**

This is the primary architectural principle of NUSA.

NUSA must not be designed around a particular AI model, vendor, prompt, agent framework, strategy-generation technique, exchange, data provider, or implementation that would force a system-wide redesign when technology changes.

The objective is not to build a system that never changes. The objective is to build a system whose **core remains stable while its capabilities can continuously improve**.

## Architectural Consequences

All major NUSA capabilities must therefore be:

- defined by explicit capability contracts rather than vendor/model identity;
- independently versioned;
- independently testable;
- replaceable without rewriting unrelated foundations;
- observable and auditable;
- reproducible from evidence;
- deployable through controlled promotion stages;
- rollback-capable;
- subject to independent safety authority;
- eligible for Champion/Challenger evaluation;
- compatible with continual learning and Meta-AI evaluation.

## Stable Core, Evolvable Capabilities

The following foundations are treated as the stable core and must not be bypassed by a new AI capability merely because it is newer or more powerful:

- authority and safety constitution;
- independent Risk Governor veto;
- policy and deployment gates;
- evidence and audit requirements;
- trusted data provenance and temporal integrity;
- identity and authorization boundaries;
- production mutation controls;
- deterministic/reproducible evaluation;
- rollback and recovery mechanisms;
- capital and risk limits.

Above that stable core, NUSA should allow controlled evolution of:

- foundation models;
- specialist models;
- agent architectures;
- AI-CIO implementations;
- market-intelligence models;
- regime/world models;
- strategy discovery/evolution methods;
- portfolio optimizers;
- execution agents;
- research/evaluation agents;
- learning methods;
- memory/RAG systems;
- prompts and tools;
- Meta-AI implementations;
- other future capabilities not yet known.

## Capability-First Design

NUSA architecture must define **what a capability must do**, not **which model or vendor must do it**.

Example:

`REGIME_DETECTION` is a capability.

Its implementation may be a statistical model, neural model, foundation model, multi-agent ensemble, or a future technique that does not yet exist.

The architecture should allow these implementations to compete under the same contract and evaluation criteria.

## Evidence-Based Evolution

New technology is never adopted solely because it is newer.

Every replacement or upgrade must demonstrate superiority under NUSA-specific evaluation criteria including, where applicable:

- financial quality;
- drawdown and tail-risk behavior;
- robustness across regimes;
- calibration and uncertainty;
- hallucination/failure rates;
- reproducibility;
- latency and cost;
- operational stability;
- security;
- tool reliability;
- data quality sensitivity;
- market-impact characteristics.

The default evolution path is:

`Research -> Offline Evaluation -> Historical Replay / Backtest -> Walk-Forward -> Out-of-Sample -> Shadow -> Champion/Challenger -> Paper Canary -> Approved Promotion -> Production`

No AI component may directly promote itself to production.

## Continuous Evolution

NUSA must continuously search for and evaluate better technology.

The Meta-AI Governor / AI Control Plane should eventually support:

- capability discovery;
- model and agent discovery;
- benchmark orchestration;
- Champion/Challenger comparison;
- architecture-change proposals;
- learning-method comparison;
- cost/performance optimization;
- promotion recommendations;
- rollback recommendations;
- retirement of obsolete components.

The Meta-AI Governor is an evolution coordinator, not an absolute authority. It may not bypass the Risk Governor, Policy Authority, Deployment Gate, audit requirements, or human-controlled production authority.

## Learning Principle

Learning itself is an evolvable capability.

NUSA must continuously improve how it learns from:

- market observations;
- strategy outcomes;
- portfolio decisions;
- execution quality;
- risk blocks;
- failures;
- drift;
- operator actions;
- model decisions;
- counterfactual and historical replay.

Learning must generate candidates, not silently mutate LIVE behavior.

Learning results must pass the same controlled validation and promotion process as any other capability.

## Measured Parallelism and Outcome Convergence

NUSA should decompose work into the smallest independently verifiable units that preserve architecture, evidence integrity, and safety. Independent work may proceed in parallel, but parallelism itself is never the objective.

The objective is better verified outcome per unit time, cost, and risk.

A parallel execution design should therefore provide:

- one canonical objective and acceptance contract;
- explicit ownership and conflict boundaries for each work unit;
- independent state for each unit;
- shared evidence and verification semantics;
- deterministic convergence into one canonical result;
- bounded retry and stale-work recovery;
- before/after measurements against an appropriate baseline.

Worker count, agent count, branch count, task count, or raw activity are not success metrics.

## Evidence-Derived Progress

NUSA must not use self-reported progress as authoritative state.

Progress should be projected from durable evidence such as:

- implementation present;
- focused validation passed;
- exact-head CI passed;
- independent Audit passed;
- Release eligibility satisfied;
- deployment or runtime verification completed;
- investment evidence reached the required validation stage.

A UI may summarize this state, but it must not invent percentages, completion, speedups, confidence, or success that are not derivable from authoritative evidence.

Claimed progress != verified progress

## Bottleneck-First Optimization

Increasing parallelism is useful only while it improves verified throughput and owner-perceived latency.

NUSA should distinguish at least:

- queue / work-selection bottleneck;
- worker / implementation bottleneck;
- CI bottleneck;
- Audit bottleneck;
- Release / merge bottleneck;
- data / provider / external dependency bottleneck;
- human-only bottleneck;
- infrastructure bottleneck such as CPU, RAM, disk, or network saturation.

When downstream capacity becomes the constraint, concurrency should contract rather than generate conflict, stale work, retry storms, or useless queue growth.

The optimization loop is:

Measure -> identify largest bottleneck -> improve -> verify before/after -> repeat

## Canonical Event and Projection Model

Operational truth should originate from canonical execution events and durable state, then be projected outward.

Preferred direction:

Canonical Runtime / Control Plane Events -> Durable State -> Observability Projection -> UI

The UI, reporting layer, or visualization layer must not create a second execution state machine merely to make the system appear active.

This principle applies to development automation, research, strategy evaluation, PAPER operation, portfolio/risk, and other multi-stage NUSA capabilities.

## Economic Outcome Convergence

For investment-facing capabilities, NUSA should converge activity into economic evidence rather than activity counts.

The canonical direction is:

Market -> Research -> Strategy -> Risk -> Portfolio -> PAPER Outcome -> Attribution -> Learning -> next iteration

Research volume, strategy count, model-call count, or trading frequency are not economic success metrics by themselves.

Where applicable, success should be evaluated with evidence such as net-of-cost return, out-of-sample persistence, drawdown, downside/tail behavior, regime robustness, liquidity/capacity, portfolio contribution, and PAPER persistence.

A system that does more work without improving verified economic quality has not improved merely because it is busier.

## Non-Negotiable Safety Rules

1. No AI may bypass the independent Risk Governor.
2. No AI may approve its own production promotion.
3. Meta-AI may not promote itself.
4. Unknown or unverified critical state must never be treated as safe by default.
5. Missing evidence must block safety-critical execution where evidence is required.
6. Unvalidated learned behavior must not directly modify LIVE trading.
7. Hard capital/risk limits must not be relaxed by an AI without separate policy authority.
8. Every production component must have a known version, provenance, and rollback path.
9. Production decisions must be reconstructable from durable evidence.
10. New technology must integrate through capability contracts rather than bypassing architecture boundaries.

## Design Review Rule

Every future NUSA work order, architecture proposal, AI feature, dependency choice, and refactor must be checked against this question:

> **Does this change preserve NUSA's ability to safely absorb, replace, and evolve future technology without redesigning the core system or weakening safety?**

If the answer is no, the design should be revised before implementation unless a deliberate core-architecture change is explicitly approved.

## Permanent Principle

**NUSA is not tied to today's best technology. NUSA is built to continuously discover tomorrow's better technology, prove that it is superior, adopt it safely, and roll it back when necessary—while preserving a stable, auditable, and independently governed core.**
