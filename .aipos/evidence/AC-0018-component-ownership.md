# AC-0018 Canonical Component Ownership

Issue: #1921

```text
Public/approved knowledge + canonical market/evidence inputs
                         |
                         v
              Existing Research Factory
        hypothesis / precommit / experiment identity
                         |
                         v
           Deterministic research evaluators
     no-lookahead / OOS / cost / risk / robustness
                         |
                         v
                  Existing NUSA League
              qualification evidence only
                         |
                         v
             Existing PAPER challenger path
         canonical execution + accounting evidence
                         |
                         v
                Shadow/readiness evidence
                         |
                         X
             HUMAN-GOVERNED LIVE BOUNDARY
```

Cross-cutting controls remain independent:

```text
Risk Governor ---------> cannot be weakened by Research/AI
Audit/Evidence --------> immutable provenance and replay truth
Release/Deployment ----> independent promotion/release boundary
AIPOS -----------------> repository execution/handoff contract, not runtime authority
AI provider/agents ----> ZERO_AUTHORITY proposals/critique only
```

## Ownership rules

- Research Factory owns research lifecycle artifacts; ADR-0018 does not add a second research state store.
- NUSA League owns existing qualification/competition semantics; ADR-0018 does not add a second scoring league.
- CandidatePromotionRuntime remains the sole Champion mutation authority described by ADR-0003 and requires explicit owner command.
- PAPER execution/accounting owns forward fills/PnL truth; Research may consume admitted evidence but may not synthesize it.
- Risk Governor owns hard risk constraints independently of learned investment performance.
- Release/Deployment owns release semantics independently of AI/research preference.
- AIPOS records architecture, work, dependency and durable evidence state; it does not become an investment runtime kernel.
- ModelProvider/AI roles remain replaceable challengers behind the existing provider boundary and cannot acquire trading authority.

## Artifact identity chain

Conceptually, each downstream artifact must bind sufficient immutable upstream identity to prevent semantic substitution:

`hypothesis_id -> precommit_spec_id -> experiment_plan_id -> implementation/code_config_id -> evaluator_semantics_id -> dataset/provenance_id -> cost_model_id -> evaluation_id -> candidate_id -> paper_period/deployment_id -> readiness_evidence_id`

Exact field names and storage locations belong to the existing canonical owners. Core must extend existing contracts where fields are missing rather than introducing a parallel identity registry.
