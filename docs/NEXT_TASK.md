# Next Task

## Current baseline

NUSA remains PAPER-only and fail-closed. `liveAuthority=NONE`, `productionMutationAllowed=false`, AI remains ZERO_AUTHORITY/read-only, and no real-money order/cancel/withdraw/transfer capability is introduced by the work described here. Human/environment-only validation gates must remain explicit rather than being inferred from automated evidence.

### WO-0031: canonical strategy research promotion architecture

WO-0031 has one canonical research-promotion authority.

- `scripts/lib/strategy-research-evidence-manifest.js` owns evidence integrity, provenance, immutable linkage, and declared evidence trust. It does not produce a promotion decision.
- `scripts/lib/strategy-research-promotion-gate-runner.js` owns the only `researchDecision` produced by the research-promotion path.
- `scripts/lib/strategy-research-promotion-gate-verifier.js` independently re-derives and verifies that decision without delegating the deciding logic back to the runner.
- `scripts/lib/strategy-research-scorecard.js` is a compatibility/readiness and provenance surface only. It must not emit, own, or imply an independent research-promotion decision.

Synthetic or incomplete evidence is non-promotable. A weighted aggregate must not be allowed to average away a data-integrity, provenance, safety, or D-010 failure. `executionStatus` and `researchDecision` remain distinct, and mandatory owner review remains required before any promotion beyond the currently documented PAPER boundary.

Applied to the repository's current evidence, research remains non-promotable where operational or real-market evidence is incomplete. No strategy parameter, symbol, runtime mode, LIVE authority, or production-mutation permission changes as a consequence of this architecture clarification.

See `docs/research/strategy-research-promotion-gate-contract.md` and `docs/research/strategy-research-decision.md` for the decision contract and current evidence interpretation.

### WO-0032: independent PAPER risk and deployment safety

The independent risk gateway and deployment-safety boundary remain fail-closed. Runtime composition must derive its request from explicit deployment integrity, Paper reconciliation, persisted safety state, market/runtime fingerprints, and bounded session/exposure state. Missing, malformed, stale, or uncertain inputs must halt rather than silently relax enforcement. `productionMutationAllowed` remains false.

### WO-0033 / WO-0034: operational evidence boundary

Shadow/Canary and Extended Paper promotion remain evidence-driven only. Closed-candle runtime wiring, durable evidence, reconciliation, reconnect diagnostics, and owner-controlled lifecycle support do not by themselves constitute sufficient operational evidence. Repository automation must not convert synthetic fixtures, rehearsal evidence, or missing human/environment evidence into an operational promotion claim.

### Mobile completion and human environment gates

Issue #349 / PR #371 remain governed by truthful PAPER-only mobile behavior and real-device evidence requirements. Physical Android install, cold-start/relaunch, navigation, visual QA, PAPER interaction, Portfolio/AI behavior, and reinstall evidence are HUMAN_ENVIRONMENT_ONLY unless a real device run is actually performed and recorded. Automated CI must never fabricate that evidence or silently waive the gate.

## Repository-truth rule

`docs/NEXT_TASK.md` is a statement of current canonical architecture and current blockers, not an archive of superseded design alternatives. When implementation and this document diverge, the divergence is a repository-truth defect and must fail architecture validation until the document or implementation is reconciled. Historical context belongs in issue/PR history or dedicated closeout documentation rather than being retained here as an unresolved current decision.

## Completion discipline

A slice is complete only after the exact current head has the required CI, coverage, architecture/repository-truth, safety, Restricted LIVE/read-only, and relevant native workflows passing; latest-main ancestry is current; review blockers are clear; and automated P0/P1 for the inspected slice is zero. Human/environment-only gates remain separate and cannot be satisfied by automated checks.
