# AI Evaluation Framework v1 (WO-039)

## Scope

Evaluates the quality of an AI-produced output before any human decides whether to
act on it. It covers all four subject types the work order named -- AI Coach
recommendations, AI-generated strategy candidates, backtest results, and optimizer
parameter suggestions -- through one shared contract, `AiOutputEnvelope`: a
subject-typed bundle of claims, the evidence those claims cite, a dataset content
hash, and an operational-data-point count.

No AI Coach, strategy generator, or optimizer exists in this repository yet (see
`docs/implementation/research-lab-mvp.md`, `docs/implementation/walk-forward-research.md`).
This framework is the gate waiting for whichever of those ships first, rather than
a gate retrofitted after the capability already exists.

## Zero authority

`apps/execution/src/ai-evaluation-framework.ts` never executes, promotes, or
mutates anything. It reads an envelope and returns a verdict plus the reasoning
behind it. `buildPromotionApprovalInput` always sets `requiresOwnerApproval: true`
and `ownerApproved: false`; no code path in this framework can set the latter to
true. Promotion is a human decision taken outside this code, exactly as required.

## Four evaluation dimensions, never averaged

`EVIDENCE_TRACEABILITY`, `UNSUPPORTED_CLAIM_DETECTION`, `DATASET_PROVENANCE`, and
`OPERATIONAL_SUFFICIENCY` are evaluated independently. `aggregateVerdict` takes the
single WORST dimension in a fixed order (`FAIL` > `HOLD_INSUFFICIENT_DATA` >
`WARN` > `PASS`) rather than a weighted score, for the same reason
`strategy-research-promotion-gate` already established for this codebase: a
weighted total would let a hallucinated claim be diluted by three unrelated
passing dimensions.

## Hallucination / unsupported-claim detection

A claim is supported only if every evidence id it cites both exists in the
envelope's evidence bundle and is not declared `UNVERIFIED`. Citing nothing,
citing an id that isn't present, and citing an id explicitly marked unverifiable
are all treated identically: unsupported. Any unsupported claim forces the
overall verdict to `FAIL` -- the "근거 없는 추천 Fail" safety condition.

## Dataset provenance

Evidence bundles composed entirely of `SYNTHETIC_FIXTURE` entries can never reach
`PASS` (they `WARN`), mirroring "synthetic evidence can never promote" from the
strategy research promotion gate. Any `UNVERIFIED` evidence fails the evaluation
outright.

## Operational sufficiency

Below `MINIMUM_OPERATIONAL_DATA_POINTS` (10) independent operational observations,
the evaluation returns `HOLD_INSUFFICIENT_DATA` rather than guessing at a verdict
from too little data -- the "운영 데이터 부족 시 평가 보류" safety condition.

## Regression comparison

`compareAgainstBaseline` requires the current and baseline evaluation to share the
same `datasetContentSha256`. A mismatch returns `improvementRatio: null` and a
`DATASET_MISMATCH_NOT_COMPARABLE` reason code rather than a number computed across
two different datasets -- the same concern the cross-market validation layer
raised about notional-level artifacts masquerading as a real comparison.

## Independent verification

`verifyAiEvaluationRecord` re-derives dimensions, unsupported claims, and the
verdict from the ORIGINAL envelope without calling `evaluateAiOutput`, so a bug in
the evaluator -- or a hand-edited stored record -- is caught rather than confirmed.
`recordIsSelfConsistent` (in `packages/contracts/src/aiEvaluation.ts`, so both the
execution-layer evaluator and the storage-layer repository can depend on it without
storage taking a runtime dependency on application code) checks that a record's
own hash matches its own content.

## Persistence and versioning

`packages/storage/src/ai-evaluation-repository.ts`'s `SqliteAiEvaluationRepository`
is append-only. Re-evaluating a subject never overwrites or deletes its prior
evaluation: every evaluation gets its own row keyed by `evaluationId`, and
`historyForSubject` returns every version, oldest first. `latestForSubject` is a
read convenience over that history, not a separate mutable slot. `append` rejects
a record whose own hash doesn't match its content before it ever reaches the
database.

## Verification

- `pnpm run typecheck` / `pnpm run build` / `pnpm run lint` -- PASS
- `tests/ai-evaluation-framework.test.js` (25 tests): unsupported-claim detection,
  worst-of aggregation, all four end-to-end verdict paths (PASS / FAIL /
  WARN-on-synthetic / HOLD-on-insufficient-data), malformed-envelope rejection,
  same-dataset and cross-dataset regression comparison, independent-verifier
  tamper detection, and promotion-input non-self-approval.
- `tests/ai-evaluation-repository.test.js` (5 tests): append/retrieve, version
  history preserved across re-evaluation, tampered-record rejection, duplicate-id
  rejection, empty-history-is-not-an-error.
- `tests/repository-architecture-validation.test.js`: confirms the storage layer
  depends on the contracts layer only, with no runtime edge back into
  `apps/execution`.
- Full isolated suite: passes except the pre-existing, unrelated
  `tests/evidence-cli-contract.test.js` Node-22-vs-24 SQLite-warning mismatch (see
  prior audit PRs #71/#72/#84 for the same disclosed, environmental failure).

## Disclosed scope decision

Android/iOS and Windows CI in this PR validate that nothing in the existing
mobile and desktop suites broke -- this framework does not touch `apps/mobile` or
any renderer code, so there is nothing mobile- or desktop-specific to add
evidence for yet. No physical device was used, consistent with this repository's
established policy (see `docs/NEXT_TASK.md`'s WO-0033/0034 disclosure) of not
fabricating device evidence a sandboxed session cannot produce.
