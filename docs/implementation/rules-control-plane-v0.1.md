# Rules Control Plane v0.1

## Scope

This is the first executable-policy vertical slice for DOKKAEBI. It is an
independent, deterministic and side-effect-free control plane. It evaluates
declarative conditions and produces a traceable policy recommendation; it does
not submit orders, mutate Paper state, grant authorization, or override Risk,
Compliance, Treasury, Settlement, Accounting, or separation-of-duties checks.
`productionMutationAllowed` is always `false`.

## Rule and Policy Versions

`BusinessRule` and `BusinessPolicy` are versioned immutable contracts. A rule
contains its owner, approver, input schema, declarative conditions, outcome,
priority, salience, effective range, lifecycle state and evidence hash. Rules
and policies must be `PUBLISHED` and active at the caller-supplied evaluation
clock to participate. An unavailable, unpublished, expired, duplicate, or
otherwise unknown rule/policy yields `UNKNOWN` and blocks automated
progression.

Published rule versions are idempotent only when canonical content is exactly
the same. Different content with the same rule/version is rejected.

## Decision Table Semantics

The evaluator supports deterministic `FIRST_MATCH`, `PRIORITY`, `COLLECT`,
`UNIQUE`, `ANY`, and `OUTPUT_ORDER` policy modes. Rules are ordered by
priority descending, salience descending, then rule id and version. `COLLECT`
selects the most restrictive matching outcome. Ambiguous `UNIQUE` or `ANY`
outcomes become `UNKNOWN`; a lack of matches is also `UNKNOWN` in this first
slice. Mandatory inputs are validated before matching.

There is deliberately no string expression evaluator, scripting engine, wall
clock read, external lookup, or formula parser. Conditions are typed scalar
comparisons only. Formula registry, policy composition across policy versions,
shadow reports, CLI, dashboard and certification workflows remain later A-80
work and must preserve this no-authority boundary.

## Trace and Replay

Every evaluation returns immutable normalized inputs, their canonical SHA-256,
selected and rejected rules, deterministic execution order, explanation,
evidence hash, replay hash, and logical duration `0`. The evaluator reads only
the supplied request, including its explicit `evaluatedAt` value, so identical
inputs replay identically.

`RulesLedgerEvent` records rule/policy publication and evaluations in an
append-only SHA-256 chain. Replaying validates sequence, prior hash,
timestamps, event evidence, published lifecycle state, version conflicts, and
trace integrity.

## Persistence

Migration `006_rules_control_plane` adds append-only event and snapshot tables
plus non-authoritative rule, policy, table, formula, evaluation, explanation,
simulation, evidence, and certification projections. The SQLite store appends
an event and its hash snapshot inside one transaction; mismatch or tampering
fails closed. Projection data is a query aid, never evaluation authority.

## Safety Boundary

Rules can recommend `APPROVE`, but that recommendation is not permission to
trade or perform any mutation. Existing authorization, compliance, risk and
Paper-only gates remain mandatory. LIVE trading, private exchange APIs,
credentials, external AI, and automatic authority changes are not implemented.
