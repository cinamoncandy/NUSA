# Learning loop L2 (learning efficiency): gap analysis before any build (2026-11-19)

Status: ANALYSIS ONLY, read from `main` (d142a7014 and later). No code, limit, threshold, gate or authority change. `docs/LEARNING_LOOP_LEVELS_20261112.md` rules apply: L1 first, L2 only as **record-only instrumentation** (that document, "Order and reasons", point 2), never used in a decision, a gate or a limit.

## 1. L2 pass criterion (from the levels document)

"Every failed candidate leaves a cause classification, and research priority is set from recorded evidence." Pass is proven by server records, not by a document.

## 2. What already exists

| Piece | Where | What it records |
| --- | --- | --- |
| Research priority from recorded evidence | `packages/contracts/src/researchMetaLearning.ts`, `apps/cloud/src/researchMetaLearningRuntime.ts`, `researchLedgerSnapshot.ts` | per dimension value (data type, timeframe, universe, method class): experiments, configurations, discovery and holdout passes; EXHAUSTED at 50 configurations with 0 holdout passes; ranks untried combinations; exposed under `/health` closed-loop `metaLearning` |
| Experiment outcome counters per bar length | runtime Research ticks | status counts such as `FAIL_NO_EDGE`, `FAIL_EXCESSIVE_DRAWDOWN`, `NOT_DUE`, `REPEAT_*` (2026-11-19: 216 / 66 / 30 / 5) |
| Fixed rejection codes of the bootstrap qualification | `closedLearningLoopStatus.ts` | `bootstrapQualification` (candidates, qualified, insufficient, rejected) and `bootstrapRejectionReasons` (code to count), published only while `RESEARCH_NOT_DEPLOYABLE` |
| Per-experiment durable record | table `research_experiment_records` (811 rows on the host) with `result_json`, `hypothesis_id`; `research_evaluation_ledger` (811) | the full result as written by the evaluator |

So the "priority from recorded evidence" half of L2 is largely present (a pure, reviewed policy). It is not claimed as passing: it has not been verified on the host as a recorded decision.

## 3. The actual gap

1. The failure causes are visible as **aggregate counters** (status counts, rejection-code counts). Nothing was found that stores, for each failed candidate, one classified cause row that a later query can join to its experiment id, hypothesis and dataset. The cause may be derivable from `result_json`, but that was not read (only counts were run on the host).
2. The counters are in memory and in `/health`; a restart resets them, so the history of "why candidates failed" is not durable except through `result_json`.
3. No cause taxonomy is pinned: `FAIL_NO_EDGE` and `FAIL_EXCESSIVE_DRAWDOWN` are statuses, not a reviewed set of cause classes (no edge, cost-dominated, regime-fragile, data-insufficient, design flaw, and so on), so two failures with the same status can have different lessons.

## 4. Minimum record-only addition (proposal, not built)

- A pure classifier in `packages/contracts` that maps an experiment result to one cause class from a **fixed, reviewed list** (unknown maps to `UNCLASSIFIED`, never guessed), plus a pinned golden test over real stored `result_json` samples.
- A durable, append-only `research_failure_causes` table keyed by experiment id (one row, written once, same transaction discipline as the experiment record), read-only to every decision path: no gate, qualification, allocation, threshold or order code may import it.
- A read-only count by cause class under `/health` (fixed keys only) so the daily check can report it.
- The meta-learning policy is **not** changed to use it in this step.

## 5. Before building

1. Read, on the host, how `result_json` of a failed experiment looks (one or two records, redacted to the verdict fields only) to see whether the cause is already in it. A read-only paste by the owner or a read-only diagnose addition is needed; an agent session cannot read the host.
2. Pre-register the L2 pass criterion before the build (levels document, rule 3): for example "100 percent of failed experiments in a 7 day window have a cause row, with `UNCLASSIFIED` at most 10 percent".
3. Independent non-author review of the classifier list and the isolation rule (no decision path reads the table).
4. L1 stays the priority: this does not change what the loop does, so it does not block or speed L1. It only makes the next lesson measurable.

## 6. Not in this step

No code, table, workflow, host, release, limit, threshold, capital, order switch or authority change.
