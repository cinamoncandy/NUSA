# Learning loop L2 pre-registration: failure cause classifier (2026-11-20)

Status: PRE-REGISTRATION, written before the build (`docs/LEARNING_LOOP_LEVELS_20261112.md`, rule 3). Record-only instrumentation. It follows `docs/LEARNING_L2_GAP_ANALYSIS_2026-11-19.md` sections 4 and 5. No gate, threshold, limit, capital, order switch or authority change. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

## 1. Pass criterion (fixed now, judged later on host data)

L2 passes only if, over a 7 day window after the table and wiring exist (not in this step):

1. 100 percent of failed experiments have exactly one cause row (no missing row, no second row).
2. `UNCLASSIFIED` is at most 10 percent of the cause rows.
3. The table is append-only (no UPDATE or DELETE path exists; a row is written once).
4. No decision, gate, qualification, allocation, threshold or order code imports the classifier or reads the table (pinned by `tests/research-failure-cause-isolation.test.js`, which must be changed explicitly by the later wiring PR for the one writer only).

If any item fails, L2 is not claimed. The criterion is not tuned after seeing data.

## 2. Fixed cause taxonomy (`packages/contracts/src/researchFailureCause.ts`)

| Class | Meaning |
| --- | --- |
| `NO_EDGE` | A comparison ran on usable evidence and the challenger did not beat the champion, with no more specific cause; or the deflated Sharpe was below the confidence threshold. |
| `COST_DOMINATED` | Gross return positive, net return not positive after costs (`FAIL_COST_SENSITIVE`). |
| `EXCESSIVE_DRAWDOWN` | Challenger maximum drawdown worse than the champion's. |
| `EXECUTION_MISMATCH` | Challenger execution quality below the champion's. |
| `REGIME_FRAGILE` | Qualification rejected the edge as regime fragile (`REGIME_FRAGILE_EDGE`). |
| `DATA_INSUFFICIENT` | The evidence needed to judge was missing or too short (low sample, no candles, volume missing, too many gaps, insufficient history, missing qualification evidence). |
| `STALE_EVIDENCE` | The dataset manifest did not match the experiment (binding, range or content mismatch). |
| `DEPENDENCE_UNVERIFIED` | The hold-back could not be used as independent evidence (already used, or overlaps a used one). |
| `DESIGN_REJECTED` | The experiment design was refused (invalid window config or fold count). |
| `NOT_APPLICABLE_NOT_A_FAILURE` | Not a failure: challenger better, or `NOT_DUE`. |
| `UNCLASSIFIED` | Unknown, malformed, ambiguous or not an experiment (see below). Never guessed. |

The first four metric-based causes use the same fixed priority as `classifyResearchFailure` in `apps/cloud/src/researchFailureMemory.ts` (low sample, cost, drawdown, execution, then no edge); the contracts copy does not import from `apps/cloud`, so the two must be kept in step by review.

Sources read (code that writes the data, not host data): `researchExperimentRunner.ts` (outcome statuses, skip reasons, `holdoutNote`), `researchExperimentOrchestrator.ts` (`NOT_DUE`, `NO_CANDLES`, count keys), `researchFailureMemory.ts` (`FAIL_*`, `REPEAT_*`), `researchWalkForwardWindows.ts` (window refusals), `researchAutomationRuntime.ts` (what is stored as `result_json`), `researchQualificationIdentity.ts` (qualification policy codes).

Deliberately `UNCLASSIFIED`: `ERROR_EXPERIMENT_FAILED` and `PROVENANCE_*` (cause unknown), bare `VALIDATION_CHAMPION_BETTER` style keys without metrics, `REPEAT_*` (a derived streak count over strategies, not an experiment), a completed experiment with neither hold-back nor note.

## 3. Isolation rule

The classifier is pure (no IO, clock, randomness, imports) and nothing under `apps/cloud` or `researchMetaLearning*` references it. Later, only one writer may import it, and no reader may feed a decision.

## 4. Explicitly NOT done

- The meta-learning policy (`researchMetaLearning*`) is not changed to use causes.
- No database table, no runtime wiring, no `/health` field, no workflow, no host action.
- No gate, qualification, allocation, threshold, limit, capital or order change.

## 5. Unverified assumption

The shape of `result_json` on the host was NOT read. Only the code that writes it was read. That code writes either the hardening result (`result`, metrics `champion` and `challenger` directly, no `reason`, no cost evidence) or a fallback `{evaluationId, result, reason, champion, challenger}`. The classifier accepts both, but stored records may differ (older versions, other writers). A stored `FAILED` record without cost evidence can never be `COST_DOMINATED` from `result_json` alone; the real `UNCLASSIFIED` share is unknown until measured.

## 6. Follow-ups (separate PRs, after the 2026-11-23 release)

1. Owner or read-only diagnose paste of one or two redacted `result_json` samples to check the shape.
2. Append-only `research_failure_causes` table keyed by experiment id, same transaction discipline as the experiment record.
3. One writer wiring, with the isolation test updated for that single importer.
4. Read-only count by cause class under `/health` with fixed keys.
5. Independent non-author review of the class list and the isolation rule; then the 7 day measurement against section 1.
