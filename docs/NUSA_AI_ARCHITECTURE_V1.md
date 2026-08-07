# NUSA AI Architecture v1

## Status

This document defines the target architecture for NUSA's long-term AI, research, investment, safety, learning, execution, and evolution systems.

It is subordinate to `docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md` and must be interpreted consistently with that document.

## North-Star Requirement

NUSA must preserve a stable core architecture while allowing future technologies to be safely absorbed, evaluated, replaced, upgraded, combined, retired, and rolled back.

No major subsystem should require a redesign of the whole platform merely because a better model, agent architecture, learning method, strategy-generation technique, retrieval system, execution model, or AI provider becomes available.

The permanent design objective is therefore:

> Keep the core skeleton stable; make capabilities replaceable; make evolution evidence-driven; make safety independent; make every production change reversible.

---

## 1. Constitution / Authority Layer

This layer is above all AI systems. It defines non-negotiable authority and safety boundaries.

### 1.1 Human Authority

Human operators retain the ultimate authority to:

- activate or halt LIVE capability;
- change hard capital limits;
- approve changes to immutable safety policy;
- override deployment state only through audited, explicit procedures;
- invoke emergency shutdown and recovery procedures.

### 1.2 NUSA Safety Constitution

The following principles are permanent architectural constraints:

1. No AI may bypass the independent Risk Governor.
2. No AI may approve its own promotion to production.
3. The Meta-AI Governor may not directly mutate LIVE trading behavior.
4. Unvalidated models, strategies, agents, prompts, tools, or policies may not enter LIVE.
5. Missing or unhealthy evidence, persistence, or critical state must fail closed where safety requires it.
6. UNKNOWN must never be treated as SAFE by default.
7. Hard capital limits may not be relaxed by autonomous learning alone.
8. Kill-switch authority remains above model intelligence.
9. Every production decision must be reproducible from versioned inputs and evidence where technically feasible.
10. Safety-policy changes require separate authority, audit evidence, and promotion controls.

---

## 2. Trusted Data & Knowledge Fabric

All AI, research, validation, and trading systems must operate on governed data rather than ad-hoc per-agent feeds.

### Required capabilities

- market data ingestion;
- trades and order-book data;
- news, macro, on-chain, and alternative data where adopted;
- point-in-time historical data;
- feature store;
- knowledge and memory store;
- data lineage and provenance;
- freshness and quality scoring;
- event-time, received-time, and model-available-time tracking;
- temporal ordering and deterministic replay support.

### Point-in-Time Rule

Backtests and historical replay must only expose information that would have been available at the simulated decision time. Look-ahead leakage is a model-risk violation.

---

## 3. Perception & World-Model Layer

This layer converts trusted data into structured beliefs about the market.

### Components

- Multimodal Market Intelligence;
- Regime Detection;
- Market World Model;
- Causal / structural market models where useful;
- Scenario Generator;
- Uncertainty / Calibration Engine.

### Common output contract

Where applicable, AI outputs should expose more than a point prediction. The target contract includes:

- decision or prediction;
- confidence;
- epistemic uncertainty;
- aleatoric uncertainty where meaningful;
- data-quality indicators;
- distribution-shift indicators;
- model-health indicators;
- evidence references;
- model / prompt / tool / policy version references.

---

## 4. Research & Discovery Layer

This is NUSA's strategy-creation and hypothesis-generation system.

### Components

- Strategy Discovery / Evolution Engine;
- Hypothesis Generator;
- Research / Evaluation Agent;
- Alpha Discovery;
- Counterfactual Research;
- Strategy Mutation;
- Strategy Combination;
- Strategy Retirement;
- Novelty / Diversity Control.

### Strategy Discovery Rule

The Strategy Engine is not the strategy inventor. It executes approved strategies. Strategy generation, mutation, combination, retirement, and evolutionary search belong here.

### Novelty Control

The research system should avoid wasting resources on functionally equivalent strategies. Candidate strategies may be compared using strategy-genome, behavioral-similarity, novelty, and diversity measures.

---

## 5. Validation & Model-Risk Layer

No candidate should be promoted merely because it performs well in one test.

### Required validation stages

- unit and contract tests;
- historical replay;
- backtesting;
- point-in-time validation;
- walk-forward testing;
- out-of-sample testing;
- Monte Carlo analysis where appropriate;
- crisis / stress replay;
- adversarial evaluation;
- overfitting detection;
- leakage detection;
- Shadow validation;
- Champion / Challenger comparison;
- Paper Canary.

### Model Risk Management

The validation system must independently evaluate risks including:

- regime overfitting;
- data leakage;
- look-ahead bias;
- calibration failure;
- hallucination or unsupported inference;
- distribution shift;
- instability across seeds or runs;
- hidden dependence on unavailable data;
- excessive latency or cost;
- correlated failure among supposedly independent agents.

---

## 6. Investment Intelligence Layer

This layer makes investment and capital-allocation decisions. It is not responsible for self-promotion or safety-policy changes.

### Components

- Multi-Agent AI-CIO;
- specialist investment agents;
- Critic / Devil's Advocate Agent;
- confidence aggregation;
- Capital Allocator;
- Adaptive Portfolio Optimizer;
- Risk Budget Allocator.

### Capital Allocation Rule

Portfolio optimization and capital allocation are separate concerns.

The Capital Allocator determines how much risk capital the system may deploy across strategies, assets, and regimes. The Portfolio Optimizer determines the composition of the deployable capital subject to those budgets.

### N-Version Decision Principle

High-impact decisions may use multiple independently implemented decision paths to reduce correlated model failure. Merely prompting the same model three different ways does not automatically constitute independent reasoning.

---

## 7. Independent Safety Authority

Safety is a separate authority, not another voting member of the investment committee.

### Components

- Autonomous Risk Governor;
- deterministic hard risk limits;
- Policy Authority;
- Deployment Gate;
- liquidity risk controls;
- concentration and correlation limits;
- drawdown and tail-risk limits;
- kill switch;
- fail-closed boundary;
- independent veto.

### Risk Intelligence vs Risk Authority

Risk models may learn and improve their assessment of risk, but learned risk intelligence must not autonomously relax hard safety policy.

`Risk Intelligence != Risk Authority`

### Dual Veto

Operational trading risk and production promotion are separate veto domains:

- Risk Governor: may block an order, position, allocation, or runtime action.
- Deployment Gate: may block a model, strategy, agent, prompt, tool, policy, or architecture from entering production.

---

## 8. Execution Intelligence Layer

This layer converts approved investment intent into market actions.

### Components

- Strategy Engine;
- Execution Planner;
- Adaptive Execution Agent;
- Slippage Model;
- Market Impact Model;
- Smart Order Routing where supported;
- Broker / Exchange Adapter;
- Reconciliation.

### Execution Rule

No broker mutation may occur unless all required upstream approvals, risk gates, persistence requirements, and evidence requirements have succeeded.

---

## 9. Learning & Attribution Layer

Continual Learning is a system-wide loop rather than one standalone AI.

### Components

- Experience Store;
- Post-Trade Attribution;
- Counterfactual Replay;
- Failure Analysis;
- Drift Detection;
- Regime Performance Analysis;
- Continual Learning;
- Strategy / Model / Agent Improvement.

### Attribution Rule

NUSA must not learn only from profit and loss. The system should distinguish, where possible:

- strategy alpha;
- market beta;
- regime effect;
- portfolio sizing effect;
- execution quality;
- risk intervention;
- noise or luck;
- data or model failure.

### Counterfactual Learning

The learning system should be capable of asking controlled questions such as:

- what if the trade had not been taken?;
- what if size had been smaller?;
- what if another strategy had been used?;
- what if another execution method had been used?;
- what if the risk block had not occurred?

### Catastrophic-Forgetting Control

Learning must preserve representative historical regimes and crisis conditions rather than optimizing only for recent market behavior.

---

## 10. Meta-Evolution Control Plane

The Meta-AI Governor exists to improve NUSA itself, but is not a sovereign production authority.

### Components

- Meta-AI Governor;
- AI Capability Registry;
- Model Registry;
- Strategy Registry;
- Agent Registry;
- Prompt / Tool / RAG Registry;
- Benchmark Factory;
- Champion / Challenger Orchestrator;
- Promotion / Demotion / Retirement / Rollback orchestration.

### Meta-AI Responsibilities

The Meta-AI Governor may:

- discover new models and AI architectures;
- register Challenger capabilities;
- initiate benchmark and historical-replay evaluation;
- propose prompt, tool, retrieval, model, strategy, agent, learning, or architecture upgrades;
- recommend promotion or rollback;
- compare cost, latency, reliability, safety, and economic value.

### Meta-AI Restrictions

The Meta-AI Governor may not:

- bypass Risk Governor;
- bypass Deployment Gate;
- directly enable LIVE mutation;
- change immutable safety policy by itself;
- promote itself;
- hide or suppress required evidence.

The Meta-AI Governor itself must be versioned, benchmarked, and subject to Champion / Challenger evaluation.

---

## 11. Champion / Challenger as a System-Wide Protocol

Champion / Challenger is not limited to strategies.

NUSA should support separate Champions for capabilities such as:

- market intelligence;
- regime detection;
- world models;
- strategy discovery;
- AI-CIO;
- portfolio optimization;
- execution;
- learning methods;
- evaluation methods;
- Meta-AI governance.

Each capability may evolve independently while preserving the stable core platform.

---

## 12. Capability Contracts

NUSA must depend on capabilities rather than hard-coding individual vendors or models into the architecture.

Example:

`REGIME_DETECTION` is a capability.

Its implementations may include:

- statistical model A;
- foundation-model agent B;
- ensemble C;
- future architecture D.

All implementations must satisfy the same versioned capability contract before they can enter validation.

### Minimum contract expectations

As applicable, a capability contract should define:

- input schema;
- output schema;
- uncertainty fields;
- evidence / provenance requirements;
- determinism or reproducibility expectations;
- latency budget;
- cost budget;
- failure semantics;
- timeout semantics;
- security / tool permissions;
- version identifiers;
- rollback compatibility.

---

## 13. Experiment & Resource Governance

Unlimited autonomous research is not acceptable.

NUSA should govern research resources using:

- experiment budgets;
- compute budgets;
- LLM / inference budgets;
- backtest budgets;
- expected information gain;
- experiment priority;
- opportunity-cost accounting.

Research systems should be able to stop low-value experiments and allocate more resources to high-information candidates.

---

## 14. Operations & Evidence Plane

All critical systems require operational evidence, observability, and recovery support.

### Components

- append-oriented Audit Ledger;
- Decision Evidence;
- system-health monitoring;
- model-health monitoring;
- incident detection;
- incident response;
- recovery and replay;
- deterministic reproduction where feasible;
- rollback evidence;
- deployment evidence.

### Reproduction Goal

For a production investment decision, NUSA should be able to reconstruct, as far as technically practical:

- data available at decision time;
- feature and knowledge versions;
- model / strategy / agent versions;
- prompts and tool configurations where applicable;
- AI-CIO decision;
- capital and portfolio decision;
- risk decision;
- approval state;
- execution decision;
- order and fill result.

---

## 15. Cross-Cutting Fabrics

The following concerns span every layer and must not be hidden inside one subsystem.

### Identity & Authorization

- least privilege;
- capability-scoped permissions;
- operator identity;
- AI / agent identity;
- approval provenance.

### Security

- credential isolation;
- tool permission isolation;
- prompt-injection defenses;
- data-poisoning detection;
- model-artifact integrity;
- dependency / supply-chain verification;
- sandboxing;
- adversarial evaluation.

### Time & Event Ordering

- event-time tracking;
- receipt-time tracking;
- model-availability time;
- deterministic ordering;
- replayable event history.

### Versioning & Reproducibility

- models;
- prompts;
- strategies;
- agents;
- tools;
- policies;
- features;
- configurations;
- datasets;
- code revisions.

### Cost / Latency / Resource Governance

Every AI capability must operate within defined resource constraints and must be evaluated on economic value, not capability alone.

---

## 16. NUSA's Three Independent Powers

NUSA must not be designed around a single all-powerful AI.

### Investment Intelligence

Responsible for how capital should be invested.

Primary components:

- Strategy Discovery / Evolution;
- Market Intelligence;
- Regime / World Model;
- Multi-Agent AI-CIO;
- Capital Allocator;
- Portfolio Optimizer.

### Evolution Intelligence

Responsible for how NUSA should improve.

Primary components:

- Meta-AI Governor;
- Continual Learning;
- Research / Evaluation;
- Champion / Challenger;
- Capability Registries.

### Safety Authority

Responsible for what must not be allowed.

Primary components:

- Risk Governor;
- Policy Authority;
- Deployment Gate;
- Kill Switch;
- hard safety constraints.

All three remain subordinate to the Constitution / Authority Layer.

---

## 17. Default Promotion Lifecycle

No AI or strategy capability should jump directly from discovery to production.

Default lifecycle:

`Discover -> Register Challenger -> Offline Evaluation -> Historical Replay / Backtest -> Point-in-Time Validation -> Walk-Forward -> Out-of-Sample -> Stress / Adversarial Tests -> Shadow -> Champion/Challenger -> Paper Canary -> Deployment Gate -> Approved Promotion -> Production -> Monitoring -> Attribution -> Learning`

Rollback must remain available at every production-capable stage.

---

## 18. Failure-Mode Requirements

Architecture reviews must explicitly define behavior when critical components fail.

Examples include:

- AI-CIO unavailable;
- model provider unavailable;
- stale or corrupted market data;
- feature-store failure;
- knowledge-store failure;
- database degradation;
- exchange disconnect;
- reconciliation failure;
- Meta-AI unavailable;
- Risk Governor unavailable;
- evidence persistence failure.

Default principle:

`UNKNOWN != SAFE`

When a critical dependency becomes unknown or unhealthy, NUSA should reduce risk, restrict new mutations, or halt as defined by policy.

---

## 19. Common Economic Objective

NUSA should not optimize raw return in isolation.

Each relevant AI capability should align with a shared economic objective framework that can include:

- risk-adjusted return;
- capital preservation;
- drawdown penalties;
- tail-risk penalties;
- liquidity penalties;
- transaction and market-impact costs;
- uncertainty penalties;
- robustness across regimes;
- operational cost;
- model and infrastructure reliability.

The exact objective may evolve, but changes must be versioned, reviewed, and audited.

---

## 20. Architecture Compliance Test for Every Work Order

Every significant future Work Order must answer the following before completion:

1. Which capability contract does this change implement or modify?
2. Is the implementation replaceable without redesigning unrelated foundations?
3. Are model, prompt, tool, strategy, policy, and configuration versions identifiable?
4. Is there an independent validation path?
5. Can the component be Champion / Challenger tested where applicable?
6. Can it be rolled back safely?
7. Does it preserve Risk Governor and Deployment Gate independence?
8. Does it preserve audit / evidence requirements?
9. Does it preserve point-in-time and temporal correctness where relevant?
10. Are uncertainty and failure semantics explicit?
11. Are security and permission boundaries explicit?
12. Does it introduce hidden coupling to a model vendor or provider?
13. Can future superior technology replace it behind the same capability boundary?
14. Does the change remain compliant with the NUSA Safety Constitution?

A feature is not considered architecture-complete merely because its happy-path code works.

---

## 21. Definition of 10/10 Architecture

NUSA does not define 10/10 as "uses the newest AI." It means:

- the core architecture remains stable as technologies change;
- major capabilities are replaceable through explicit contracts;
- new technology can enter as a Challenger rather than a rewrite;
- promotion is evidence-driven;
- rollback is designed in;
- no single AI is a sovereign authority;
- safety and deployment vetoes remain independent;
- learning improves the system without directly mutating unvalidated LIVE behavior;
- production decisions are observable and reproducible;
- failures degrade safely;
- model, strategy, data, agent, and policy risk are governed;
- the system can continuously evolve without abandoning its foundations.

This is the architecture target for NUSA v1 and the baseline against which future architecture evolution must be judged.
