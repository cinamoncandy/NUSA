# AC-0018 Core Handoff

## Objective

Adopt the useful structured-agent engineering pattern as an explicit cross-cutting NUSA harness without duplicating existing runtime authorities.

## Repository truth used

- Main baseline at planning time: `79289f9f33f63e6b699bdbc42863c3e458f782a4`.
- ADR-0003 already owns hardened research validity, append-only experiment provenance, deterministic reproducibility, holdout isolation, fail-closed evidence handling, and explicit-owner Champion mutation.
- ADR-0006 already owns provider/model pluggability with ZERO_AUTHORITY challenger semantics.
- #1605 is the canonical production PAPER closed-loop composition work.
- #1906 is the canonical bounded autonomous Investment Scientist work.

## Core instruction

Review ADR-0018 as an orchestration/contract decision only. Do not build a second Research Factory, League, lifecycle, execution, portfolio, service-container, or plugin engine. Reconcile any newer main changes before approval.

After architecture approval, work implementation in this order:

1. Close genuinely missing P0 comparability/failure-survival/authority-separation test gaps in existing owners.
2. Finish #1605 and obtain real production PAPER closed-loop/replay evidence.
3. Complete comparable Champion/Challenger and Shadow/readiness contracts only where not already owned.
4. Implement #1906 according to its prerequisite list.
5. Only then admit named mathematical strategy families as ordinary falsifiable challengers.

## Merge gate

Do not merge on document plausibility alone. Require exact-head CI/metadata validation, SHA-bound merge, then exact-main verification. If repository validation rejects AC/ADR numbering or schema, fix the metadata rather than bypassing validation.
