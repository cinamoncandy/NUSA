# NUSA Canonical Architecture v2

**Status:** CANONICAL / GOVERNING SYSTEM ARCHITECTURE  
**Scope:** Entire NUSA platform: runtime, trading, AI, research, validation, governance, evidence, applications, deployment, learning, recovery, and future capability evolution.  
**Authority:** Subordinate only to `docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md` and the NUSA Safety Constitution.  

## 0. Purpose

This document is the single architectural source of truth for NUSA.

It resolves ambiguity between the existing real-time control-plane topology and the long-term AI architecture by defining one system model with explicit planes, authority boundaries, dependency direction, lifecycle rules, and capability contracts.

When another architecture document conflicts with this document, this document governs unless the conflict is with the Core Architecture Principle or a separately approved Safety Constitution change.

---

## 1. Non-negotiable system invariants

1. Human authority remains above all autonomous systems.
2. No AI may bypass the independent Risk Authority.
3. No AI may approve its own production promotion.
4. AI, research, committee, governance, and Meta-AI are never broker-mutation authorities.
5. UNKNOWN is not SAFE.
6. Missing required evidence, unhealthy persistence, stale critical data, or failed reconciliation must fail closed according to policy.
7. Every production-capable component has a version, provenance, validation state, rollback path, and owner capability contract.
8. Learning generates candidates; it does not silently mutate LIVE behavior.
9. Applications are operator surfaces, not trading authorities.
10. Real broker mutation can occur only through the governed Execution Boundary.
11. PAPER remains the default execution authority until separately promoted through explicit deployment gates.
12. The architecture depends on capabilities, not vendors, models, exchanges, frameworks, or prompts.
13. Critical decisions must be reconstructable from durable evidence.
14. Core runtime dependencies flow inward toward stable contracts; control-plane and application concerns must not leak into the fast path.

---

## 2. The complete NUSA system model

NUSA is divided into six architectural planes plus one cross-cutting fabric.

```text
                         HUMAN / CONSTITUTION AUTHORITY
                                      |
                     +----------------+----------------+
                     |                                 |
              SAFETY AUTHORITY                  DEPLOYMENT AUTHORITY
                     |                                 |
                     +---------------+-----------------+
                                     |
+----------------------------------------------------------------------------+
|  PLANE A — REAL-TIME DECISION & EXECUTION                                  |
|  Market -> Probability -> Alpha -> Portfolio -> Risk -> Execution -> Runtime|
+----------------------------------------------------------------------------+
          |                    |                    |
          v                    v                    v
+-------------------+ +--------------------+ +-------------------------------+
| PLANE B           | | PLANE C            | | PLANE D                       |
| DATA/KNOWLEDGE    | | RESEARCH/AI        | | EVIDENCE/OPERATIONS           |
| point-in-time     | | discovery, CIO,    | | audit, replay, monitoring,    |
| data, features,   | | validation, meta,  | | reconciliation, recovery      |
| provenance        | | learning           | |                               |
+-------------------+ +--------------------+ +-------------------------------+
          |                    |                    |
          +--------------------+--------------------+
                               |
                      +--------------------+
                      | PLANE E            |
                      | CONTROL/RELEASE    |
                      | registry, gates,   |
                      | promotion, policy  |
                      +--------------------+
                               |
                      +--------------------+
                      | PLANE F            |
                      | APPLICATIONS       |
                      | mobile/desktop/API |
                      +--------------------+

Cross-cutting fabric: identity, authorization, security, time, versioning,
contracts, observability, cost/latency governance, secrets, and provenance.
```

The planes are deliberately separated so NUSA can evolve intelligence without moving authority, and evolve interfaces without changing the trading safety core.

---

## 3. Plane A — Real-Time Decision & Execution

The canonical fast path is exactly:

`Market -> Probability -> Alpha -> Portfolio -> Risk -> Execution -> Runtime`

This is the only synchronous market-decision spine.

### 3.1 Market

Responsibilities:
- receive normalized market observations from governed data adapters;
- reject stale, malformed, temporally inconsistent, or unavailable critical inputs;
- attach source, event-time, receive-time, availability-time, and quality metadata;
- expose no broker mutation authority.

### 3.2 Probability

Responsibilities:
- transform trusted observations into probabilistic beliefs, regimes, forecasts, scenarios, or calibrated distributions;
- expose confidence and uncertainty where applicable;
- remain replaceable behind capability contracts.

This stage may use statistical models, ML models, foundation models, ensembles, or future methods, but the fast-path contract is stable.

### 3.3 Alpha

Responsibilities:
- convert probabilistic beliefs into approved strategy intent;
- execute already-promoted strategy logic;
- never invent, mutate, promote, or retire strategies in the real-time loop.

Strategy discovery belongs to Plane C.

### 3.4 Portfolio

Responsibilities:
- combine approved intents;
- apply capital budgets, diversification, concentration, liquidity, and portfolio constraints;
- produce proposed target exposure or order intent;
- never bypass Risk.

Capital allocation and portfolio optimization are distinct capabilities even when implemented in one process.

### 3.5 Risk

Responsibilities:
- enforce independent operational trading risk authority;
- apply deterministic hard limits plus approved learned risk intelligence;
- veto unsafe or unknown actions;
- expose explicit allow/block/resize decisions with evidence.

Risk Intelligence may improve estimates. Risk Authority owns the veto.

### 3.6 Execution

Responsibilities:
- convert approved order intent into an execution plan;
- enforce exchange constraints, idempotency, retry semantics, slippage/impact controls, and broker capability checks;
- route all real broker mutation through one governed Execution Boundary;
- persist required pre-mutation evidence before mutation where policy requires it.

### 3.7 Runtime

Responsibilities:
- order the seven stages;
- enforce timeouts and fail-closed semantics;
- manage lifecycle and health state;
- publish snapshots/events;
- record execution results;
- never contain strategy invention, committee voting, deployment promotion, or application UI logic.

Runtime is an orchestrator, not a sovereign decision-maker.

---

## 4. Plane B — Trusted Data & Knowledge Fabric

All production reasoning must consume governed data rather than ad-hoc per-agent feeds.

Canonical sub-capabilities:
- market data ingestion;
- reference/master data;
- point-in-time historical store;
- feature store;
- knowledge store / RAG source store;
- corporate actions and calendar data where relevant;
- news, macro, on-chain, alternative data where adopted;
- data-quality service;
- lineage/provenance service;
- temporal-integrity service;
- deterministic replay feed.

### Temporal contract

Every decision-critical record should support, where applicable:
- `eventTime`;
- `receivedTime`;
- `availableTime` / model-visible time;
- source identifier;
- schema/version identifier;
- quality/freshness status.

Backtests, replay, and evaluation may not expose information before `availableTime`.

---

## 5. Plane C — Research, AI & Learning

Plane C produces intelligence, candidates, evaluations, and recommendations. It does not own production mutation authority.

### 5.1 Perception and world models

Capabilities:
- market intelligence;
- regime detection;
- world/scenario models;
- causal/structural models;
- uncertainty/calibration.

Promoted implementations may serve Plane A Probability through versioned contracts.

### 5.2 Strategy discovery

Capabilities:
- hypothesis generation;
- alpha discovery;
- strategy evolution/mutation;
- strategy combination;
- novelty/diversity control;
- retirement proposals;
- counterfactual research.

Outputs are candidates, never directly executable production strategies.

### 5.3 Investment intelligence / AI-CIO

Capabilities:
- specialist investment agents;
- multi-agent decision aggregation;
- critic/devil's-advocate paths;
- capital-allocation recommendations;
- portfolio recommendations;
- confidence aggregation.

AI-CIO outputs are recommendations or approved capability outputs under contracts. They do not bypass the Risk stage or Execution Boundary.

### 5.4 Validation and model risk

Required validation toolbox:
- unit/contract tests;
- historical replay;
- point-in-time backtests;
- walk-forward tests;
- out-of-sample tests;
- Monte Carlo/stress analysis where applicable;
- crisis replay;
- adversarial tests;
- leakage/overfit checks;
- calibration and uncertainty checks;
- shadow evaluation;
- Champion/Challenger;
- PAPER canary.

Validation must be organizationally and programmatically independent enough that a candidate cannot mark itself valid.

### 5.5 Learning and attribution

Capabilities:
- experience store;
- post-trade attribution;
- execution attribution;
- counterfactual replay;
- failure analysis;
- drift detection;
- regime performance analysis;
- learning candidate generation.

Learning may create a Challenger. It may not mutate the active Champion in place.

### 5.6 Meta-AI Governor

May:
- discover models/tools/agents;
- launch benchmark jobs;
- register challengers;
- propose architecture/capability changes;
- recommend promote/demote/rollback/retire actions;
- optimize cost/latency/reliability tradeoffs.

May not:
- change hard safety policy;
- promote itself;
- bypass Deployment Authority;
- bypass Risk Authority;
- directly mutate LIVE behavior;
- suppress required evidence.

---

## 6. Plane D — Evidence, Operations & Recovery

Plane D is append-oriented/read-oriented relative to the fast path. It observes, records, reconciles, verifies, and restores.

Canonical capabilities:
- audit ledger;
- decision evidence graph;
- execution evidence;
- health monitoring;
- incident detection;
- structured logs/metrics/traces;
- reconciliation of orders, fills, balances, fees, funding, and positions;
- deterministic replay;
- backup/restore;
- disaster recovery;
- certification evidence;
- rollback evidence.

### Evidence rule

A production-capable decision should be reconstructable from:
- data and feature versions;
- model/agent/strategy/prompt/tool versions;
- capability implementation versions;
- configuration and policy versions;
- portfolio and risk decisions;
- approval/deployment state;
- execution plan;
- order/fill outcome;
- relevant operator actions.

Evidence services may block a safety-critical mutation when required persistence cannot be proven, but they must not become strategy decision engines.

---

## 7. Plane E — Control, Governance & Release

Plane E is the slow control plane. It never runs per market tick.

Canonical capabilities:
- Capability Registry;
- Model Registry;
- Strategy Registry;
- Agent Registry;
- Prompt/Tool/RAG Registry;
- Policy Registry;
- Champion/Challenger Orchestrator;
- Research/Validation orchestration;
- Deployment Gate;
- promotion/demotion/retirement/rollback;
- committee/governance workflows;
- release certification;
- controlled scale-up.

### Committee triggers

Committee/governance review is allowed for events such as:
- strategy registration;
- Champion promotion;
- hard risk-limit change;
- PAPER-to-SHADOW or SHADOW-to-LIVE transition;
- architecture/safety-policy change;
- post-incident resume;
- exceptional capital-scale change.

Committee/governance is never a per-tick dependency.

### Two veto domains

Operational and deployment safety remain distinct:
- **Risk Authority:** blocks market/runtime actions.
- **Deployment Authority:** blocks capabilities/configuration/policy from becoming production-active.

Neither may silently substitute for the other.

---

## 8. Plane F — Applications & Operator Surfaces

Applications include:
- Android mobile;
- desktop;
- cloud/API/operator consoles;
- future approved surfaces.

Applications may:
- read snapshots and evidence;
- submit authenticated operator intents;
- configure PAPER/test environments within allowed policy;
- initiate governed requests such as promotion review or emergency halt.

Applications may not:
- directly call exchange mutation APIs;
- directly bypass Risk;
- directly alter immutable safety policy;
- directly promote a candidate;
- embed secrets as durable plaintext;
- create a second hidden execution path.

All mutating operator actions must pass through explicit authenticated command contracts and authority checks.

---

## 9. Canonical authority hierarchy

From highest to lowest:

1. Human / Safety Constitution authority
2. Independent Risk Authority and Deployment Authority
3. Versioned policy and capability contracts
4. Real-time runtime orchestration
5. Intelligence implementations and strategies
6. Applications and external clients

Intelligence quality never increases authority.

---

## 10. Dependency rules

### Allowed direction

- Applications -> public API/command contracts
- Control Plane -> registries, validation, deployment interfaces
- Research/AI -> governed data, evaluation interfaces, registries
- Runtime -> Core capability contracts, Risk, Execution, Evidence interfaces
- Execution -> broker/exchange adapters through one boundary
- Operations -> events/snapshots/evidence stores

### Forbidden direction

- Core/Runtime -> Mobile/Desktop UI
- Core fast path -> Committee/Governance
- Core fast path -> Meta-AI
- Risk Authority -> application-owned state
- broker adapters -> AI/strategy discovery
- Applications -> broker/exchange adapters
- Plugins -> hidden bypass around Risk or Execution Boundary
- Learning -> in-place mutation of production Champion
- Model/vendor SDK identity -> architecture-wide interface dependency

Dependency tests should encode these rules rather than relying on convention.

---

## 11. Capability contract standard

Every major replaceable capability must declare a versioned contract.

Minimum fields where applicable:
- capability ID;
- implementation ID/version;
- input schema/version;
- output schema/version;
- confidence/uncertainty semantics;
- evidence/provenance references;
- temporal semantics;
- deterministic/reproducibility expectations;
- timeout semantics;
- retry/idempotency semantics;
- failure semantics;
- resource/latency budget;
- security/tool permissions;
- data-access scope;
- validation state;
- rollback compatibility.

Vendor/model identifiers belong in implementation metadata, never in the capability identity.

---

## 12. Plugin rule

A plugin is an implementation extension, not an authority extension.

Plugins may:
- implement an approved capability contract;
- consume stable Core contracts;
- register through the capability registry;
- participate in validation and Champion/Challenger evaluation.

Plugins may not:
- introduce a parallel order path;
- call broker mutation outside Execution Boundary;
- bypass Risk;
- own deployment authority;
- depend on application UI internals;
- silently change hard policy.

Funding carry, prediction-market modules, exchange-specific modules, and future strategy packs therefore remain replaceable plugins/capabilities rather than new platform cores.

---

## 13. Execution modes and promotion lifecycle

Canonical modes:

`OFFLINE -> REPLAY/BACKTEST -> SHADOW -> PAPER -> LIVE`

A capability may have a more granular internal lifecycle, but LIVE authority is never implied by implementation completeness.

Default candidate lifecycle:

`Discover -> Register Challenger -> Offline Eval -> Historical Replay -> Point-in-Time -> Walk-Forward -> OOS -> Stress/Adversarial -> Shadow -> Champion/Challenger -> Paper Canary -> Deployment Gate -> Approved Promotion -> Production Monitoring -> Attribution -> Learning`

Rollback remains available after every production-capable promotion.

### Current safety default

Unless a separately approved and evidenced promotion changes this state, NUSA must remain PAPER-only with no real broker order/cancel/withdraw/transfer authority.

---

## 14. Failure semantics

Every critical capability must define `healthy`, `degraded`, `unavailable`, and `unknown` behavior.

Canonical defaults:
- stale/corrupt critical market data -> block new risk-increasing actions;
- Risk unavailable/unknown -> block risk-increasing mutations;
- evidence persistence required but unavailable -> block mutation;
- exchange connectivity unknown -> do not assume success; reconcile before retry;
- reconciliation mismatch -> reduce or freeze affected authority until resolved;
- model unavailable -> fallback only to an explicitly validated fallback Champion;
- Meta-AI unavailable -> no impact on real-time trading path;
- committee unavailable -> no impact on ordinary already-approved PAPER runtime, but block governance actions requiring committee authority;
- application unavailable -> runtime may continue only according to its independently approved operating policy.

---

## 15. Security architecture

Cross-cutting security requirements:
- least privilege;
- per-capability identities;
- short-lived credentials where practical;
- credential isolation from UI and logs;
- explicit broker permission scopes;
- secret zeroization / memory-lifecycle controls where required;
- dependency and artifact integrity;
- model/tool supply-chain verification;
- prompt-injection and tool-abuse defenses for AI capabilities;
- sandboxing for untrusted research/tool execution;
- authenticated operator commands;
- append-oriented approval provenance.

No AI tool permission may exceed the capability authority granted by architecture.

---

## 16. Data ownership and state model

Canonical ownership rules:
- Data Fabric owns normalized observations and lineage.
- Runtime owns ephemeral orchestration state.
- Strategy/Probability implementations own no hidden authoritative production state outside registered stores.
- Portfolio owns portfolio intent/state through explicit interfaces.
- Risk owns risk-state decisions and hard-limit evaluation state.
- Execution owns order lifecycle state and idempotency keys.
- Reconciliation owns verified external truth alignment.
- Evidence Plane owns durable audit/evidence records.
- Control Plane owns registry, validation, and promotion state.
- Applications own presentation/session state only.

There must be exactly one authoritative owner for each production-critical state class.

---

## 17. Event architecture

Events are versioned facts, not hidden commands.

Rules:
- commands express intent;
- events record outcomes/facts;
- critical event types are schema-versioned;
- event-time and receive-time are preserved;
- consumers must tolerate backward-compatible schema evolution or explicitly reject unsupported versions;
- replay must not trigger unintended broker mutations;
- broker-mutating handlers require explicit runtime mode and authority checks.

The event bus cannot become a bypass around the Execution Boundary.

---

## 18. API and command architecture

Every mutation-capable external/operator action must be represented as an authenticated command with:
- actor identity;
- requested action;
- environment/mode;
- target capability/resource;
- idempotency key where applicable;
- policy context;
- audit correlation ID;
- explicit authorization result.

Read APIs expose snapshots/evidence without granting mutation authority.

---

## 19. Observability architecture

Minimum production observability dimensions:
- runtime health;
- market-data freshness/quality;
- model/capability health;
- risk veto/resize rates;
- order lifecycle latency;
- reconciliation status;
- evidence durability;
- drift and calibration;
- strategy/portfolio attribution;
- dependency availability;
- cost and inference budget;
- deployment/version state.

Metrics must never be treated as the durable audit ledger by themselves.

---

## 20. Repository topology target

The current repository may migrate incrementally, but the target ownership model is:

```text
apps/
  mobile/          # operator surface only
  desktop/         # operator surface only
  cloud/           # public/operator API composition
  execution/       # current execution-heavy implementation; migrate by capability boundaries

packages/
  contracts/       # canonical schemas, capability contracts, commands/events
  core/            # stable runtime primitives/orchestration abstractions
  storage/         # persistence adapters and governed storage primitives
  aipos/           # AI/research/control-plane orchestration where appropriate

services/ (future optional extraction)
  data/
  risk/
  execution/
  control-plane/
  evidence/
```

Physical directories are not architectural authority by themselves. Dependency tests and contracts determine boundaries.

`apps/execution` currently contains multiple responsibilities that logically map to Risk, Execution, Evidence, Recovery, and Control/Certification. It should be decomposed gradually behind stable contracts rather than by a disruptive rewrite.

---

## 21. Existing-document conflict resolution

### 21.1 `core-control-plane-v1.md`

Retained as the canonical fast-path topology specification.

Its seven-stage path is adopted unchanged by this document.

### 21.2 `NUSA_AI_ARCHITECTURE_V1.md`

Retained as the detailed long-term AI capability catalog.

Its layers are mapped into this document as follows:
- Trusted Data & Knowledge -> Plane B
- Perception / World Models -> Plane C, promoted implementations may serve Plane A Probability
- Research / Discovery -> Plane C
- Validation / Model Risk -> Plane C
- Investment Intelligence -> Plane C; promoted outputs feed Plane A under contracts
- Independent Safety Authority -> authority boundary + Plane A Risk / Plane E Deployment Authority
- Execution Intelligence -> Plane A Execution
- Learning / Attribution -> Plane C + Plane D evidence inputs
- Meta-Evolution -> Plane C/E
- Operations / Evidence -> Plane D
- Identity/Security/Time/Versioning -> cross-cutting fabric

Therefore the AI architecture is not a competing runtime topology. It is a capability taxonomy mapped onto the canonical planes.

### 21.3 Committee vs real-time decision conflict

Resolved: committee/governance is always slow-path Control Plane. AI-CIO or portfolio capability outputs may participate in the real-time path only after promotion through stable contracts; committee voting itself does not.

### 21.4 Risk vs deployment conflict

Resolved: Risk Authority and Deployment Authority are separate veto domains. Risk protects runtime actions. Deployment protects what software/model/strategy/policy may become active.

### 21.5 Strategy Engine naming conflict

Resolved: strategy **discovery/evolution** belongs to Plane C. The fast-path Alpha/Strategy execution capability only evaluates already-approved strategy implementations.

### 21.6 Runtime vs governance conflict

Resolved: Runtime orchestrates already-authorized components and fail-closed behavior. Runtime never decides promotion or constitutional policy.

### 21.7 Application authority conflict

Resolved: mobile/desktop/cloud surfaces submit operator commands but cannot directly mutate broker/exchange state.

---

## 22. Architecture completeness checklist

A subsystem is architecture-complete only when all applicable answers are YES:

1. Does it have a named capability owner?
2. Is its plane explicitly identified?
3. Is its authority level explicit?
4. Are inputs/outputs versioned?
5. Are temporal semantics explicit?
6. Are failure/timeout/retry semantics explicit?
7. Is the authoritative state owner known?
8. Is evidence/provenance defined?
9. Is Risk preserved?
10. Is Deployment Authority preserved?
11. Is broker mutation restricted to Execution Boundary?
12. Is it replaceable without unrelated redesign?
13. Can it be independently tested?
14. Can it be Champion/Challenger evaluated where applicable?
15. Can it be rolled back?
16. Are secrets and permissions scoped?
17. Is replay safe from accidental mutation?
18. Is monitoring defined?
19. Is the mode transition explicit?
20. Is application/UI code excluded from core authority?

---

## 23. Required architecture guard tests

The repository should maintain automated tests for at least:
- seven-stage fast-path order;
- forbidden dependency edges;
- applications cannot import broker mutation adapters;
- committee/governance excluded from fast path;
- Meta-AI excluded from LIVE mutation authority;
- Risk veto cannot be bypassed;
- Execution Boundary is the only broker mutation path;
- replay cannot perform real mutation;
- unknown/unhealthy critical safety state fails closed;
- capability/implementation identity separation;
- strategy discovery separated from strategy execution;
- required evidence persistence before configured critical mutations;
- promotion requires independent deployment gate;
- production Champion cannot be mutated in place by learning;
- PAPER default authority remains intact unless an explicit promotion fixture is used.

---

## 24. Migration plan from current repository

Migration must be incremental and behavior-preserving.

### Phase 1 — Lock architecture
- adopt this document as canonical;
- add precedence notes to subordinate architecture documents;
- encode plane/dependency invariants in tests.

### Phase 2 — Contract inventory
- map every major module to a capability and plane;
- identify duplicate contracts/state owners;
- define stable interfaces before moving files.

### Phase 3 — Isolate authority boundaries
- centralize broker mutation behind Execution Boundary;
- verify Risk and Deployment veto independence;
- verify application command boundaries.

### Phase 4 — Decompose mixed execution package
- separate risk, execution, evidence/reconciliation, and certification/control responsibilities behind contracts;
- preserve behavior and PAPER safety throughout.

### Phase 5 — Capability registries and Champion/Challenger
- register production-capable models, strategies, agents, prompts/tools, and policies;
- make version/promotion/rollback state explicit.

### Phase 6 — AI evolution integration
- connect research, learning, and Meta-AI only through candidate/registry/evaluation workflows;
- retain zero direct LIVE authority.

No phase requires a flag-day rewrite.

---

## 25. Definition of NUSA architecture complete

NUSA's architecture is considered structurally complete when:
- one canonical topology exists;
- every production-critical module has one plane and one authority classification;
- every major capability has a stable contract;
- every critical state class has one authoritative owner;
- broker mutation has one governed boundary;
- Risk and Deployment vetoes are independent and unavoidable;
- AI/research/learning cannot silently alter production;
- applications cannot become execution authorities;
- replay/evidence/reconciliation are deterministic enough for forensic reconstruction;
- versioning, provenance, rollback, and promotion are first-class;
- automated architecture tests prevent boundary regression;
- new models/vendors/strategies/exchanges can be introduced as replaceable implementations rather than platform rewrites.

---

## 26. Final architecture decision

NUSA is a **stable governed trading core surrounded by replaceable intelligence, controlled evolution, durable evidence, and non-sovereign operator surfaces**.

The real-time spine remains deliberately small:

`Market -> Probability -> Alpha -> Portfolio -> Risk -> Execution -> Runtime`

Everything that invents, evaluates, approves, audits, learns, promotes, explains, or presents belongs outside that synchronous spine and interacts through explicit contracts.

That separation resolves the prior design ambiguity and is the permanent rule for future NUSA architecture work.
