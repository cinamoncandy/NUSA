# ADR-0003: Hardened Research Validity Boundaries

- Status: Accepted for the WO-0051 PAPER/Research slice
- Date: 2026-08-08

## Decision

Research comparisons are evidence, not authority. Candidate registration requires
multi-window, cost-aware, risk-aware, provenance-complete, holdout-isolated,
deterministically reproducible evidence. A `CHALLENGER_BETTER` result alone is
never sufficient.

Champion mutation has one runtime authority: `CandidatePromotionRuntime` through
an explicit owner command. The legacy Champion comparison facade is read-only.
Challenger evaluation remains `ZERO_AUTHORITY`; Champion and registered
candidates remain `PAPER_ONLY`; LIVE authority remains `NONE`.

Research input is causal and bounded. Market events are fingerprinted, duplicate
suppressed, ordered within an allowed lateness window, and processed through a
bounded stream normalizer. Missing, stale, corrupted, overlapping, or
non-reproducible evidence fails closed.

Hypothesis state is append-only through lifecycle events. Typed experiment
manifests and results carry versioned canonical hashes and full provenance.

## Consequences

Research automation may run bounded PAPER experiments and register PAPER
candidates only after the candidate gate passes. It cannot promote a candidate,
change risk policy, release a kill switch, connect a LIVE transport, or mutate
credentials. State replay and experiment reproduction are separate guarantees.
