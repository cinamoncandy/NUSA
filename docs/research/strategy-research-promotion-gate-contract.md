# Strategy Research Promotion Gate Contract (WO-0031)

> **Two WO-0031 layers exist on this branch and neither has been removed.**
> `scripts/lib/strategy-research-scorecard.js`
> (`docs/research/strategy-research-scorecard-contract.md`) models WO-0031 as an
> evidence-seal and linkage boundary: it binds each evidence record's strategy, dataset,
> execution, and risk-profile identity to a canonical payload hash and refuses anything
> missing, duplicate, unverified, synthetic, or tampered. The layer documented *here*
> models WO-0031 as a dimension-scoring promotion gate: ten dimensions, per-dimension
> trust and confidence, blockers, sample thresholds, a provenance downgrade, and an
> independent verifier that re-derives the gate outcome instead of rebuilding it.
> They were written in parallel, use different request shapes, and do not import each
> other. **Consolidating onto one is an open owner decision; until then this document
> describes only the promotion gate.**

## Purpose

Consolidates the WO-0025..WO-0030 research evidence into one auditable judgement about
one frozen strategy: does the accumulated evidence justify moving to an extended Paper
review, or does it not? It is deterministic research infrastructure. It is not a
profitability claim, not a promotion, and not Live Trading approval. It approves nothing
by itself — `ownerReview.status` starts and stays `PENDING`.

## Scope decision

Same reuse decision as WO-0027/0028/0029/0030 (see
`docs/research/walk-forward-contract.md`). This layer sits strictly *above* the research
runners: it **reads declared evidence and never recomputes, re-runs, or rewrites any
research result**. If a metric is absent from the manifest it is reported as `null` or as
a shortfall — never as a value the scorecard invented. A test enforces this
(`tests/strategy-promotion-gate-determinism.test.js`, "never recomputes or rewrites").

## Three rules that make this honest

1. **No single numeric total score.** A weighted total lets a data-integrity failure be
   averaged away by a good return figure. Dimensions carry a `status` and a `confidence`;
   blocking conditions always outrank everything else. The independent verifier
   explicitly rejects a result carrying `totalScore` or `score`.
2. **Technical execution is not strategy performance.** `executionStatus` says whether the
   scorecard could be computed; `researchDecision` says what to do about the strategy. A
   clean run over weak evidence is `executionStatus: PASS` with a negative decision, and
   the two fields are never merged.
3. **Synthetic evidence cannot promote.** Evidence built from invented candles supports
   implementation-correctness dimensions only. It can never raise confidence to `HIGH`
   and can never satisfy a promotion gate.

## Evidence manifest and trust levels

Eight evidence types are consumed in a fixed canonical order regardless of input order:
`DATASET_QUALITY`, `BACKTEST_BASELINE`, `COST_STRESS`, `WALK_FORWARD`,
`PARAMETER_ROBUSTNESS`, `REGIME_ANALYSIS`, `CROSS_MARKET_VALIDATION`,
`PAPER_OPERATIONAL_SAFETY`.

| Trust | Meaning |
| --- | --- |
| `VERIFIED_REAL` | real market data, independent verification `PASS` |
| `VERIFIED_SYNTHETIC` | synthetic fixture, independent verification `PASS` |
| `UNVERIFIED_REAL` | real market data, verification not run |
| `MISSING` | no entry declared |
| `INVALID` | verification `FAIL`, schema mismatch, or undeclared provenance |

Refusals rather than tolerations:

- **Duplicate evidence for one analysis is rejected.** The request must name exactly one
  result per analysis, not the best of several.
- **Mixed strategy fingerprints or mixed source commits are rejected.** Results computed
  for different strategies or different code cannot be combined into one verdict.
- **A `FAIL` independent verification is `INVALID`, never a warning.**
- When `--evidence-root` is supplied, each declared `resultPath` is read and re-hashed.
  A `resultSha256` that does not match the file on disk becomes `HASH_MISMATCH`, raises a
  blocker, and sets `executionStatus: BLOCKED`.

## Ten dimensions

| ID | Dimension | Evidence source |
| --- | --- | --- |
| D-001 | Data Integrity | `DATASET_QUALITY` |
| D-002 | Backtest Integrity | `BACKTEST_BASELINE` |
| D-003 | Cost Resilience | `COST_STRESS` |
| D-004 | Out-of-Sample Performance | `WALK_FORWARD` |
| D-005 | Parameter Robustness | `PARAMETER_ROBUSTNESS` |
| D-006 | Regime Robustness | `REGIME_ANALYSIS` |
| D-007 | Cross-Market Generalization | `CROSS_MARKET_VALIDATION` |
| D-008 | Sample Sufficiency | derived |
| D-009 | Benchmark Competitiveness | derived |
| D-010 | Operational Paper Safety | `PAPER_OPERATIONAL_SAFETY` |

Statuses are `STRONG`, `ACCEPTABLE`, `WEAK`, `INCONCLUSIVE`, `FAIL`, `INVALID`, `NOT_RUN`.
All thresholds are fixed in code before any run; none is tuned after seeing a result.

**Derived trust inheritance.** D-008 and D-009 have no evidence entry of their own — they
read numbers other analyses produced. This was a real hole: a benchmark comparison built
entirely on synthetic cross-market numbers escaped the synthetic downgrade purely because
it had no entry to be marked synthetic. They now inherit the *worst* trust among the
sources they actually consume (D-008 from cross-market/walk-forward/regime, D-009 from
cross-market), and their confidence is capped by that inherited trust in the same way an
evidence-backed dimension's is.

**Confidence is a function of evidence quality and quantity only** — never of how good the
numbers look. Synthetic, unverified, or invalid evidence caps confidence at `LOW`.

## The provenance gate

When a dimension's evidence (own or inherited) is `VERIFIED_SYNTHETIC`, a `STRONG` or
`ACCEPTABLE` status on D-001, D-003, D-004, D-005, D-006, D-007, or D-009 is downgraded to
`INCONCLUSIVE`, whatever the numbers say.

Three dimensions are deliberately exempt, because none of them asserts anything about a
market:

- **D-002 (Backtest Integrity)** — determinism, closed-candles-only, benchmark parity, and
  shared `PaperBroker` accounting are properties of the code. They hold or fail regardless
  of which candles were fed in, and establishing them is exactly what synthetic evidence
  *can* do.
- **D-010 (Operational Paper Safety)** — persistence atomicity, kill switch, duplicate
  protection, and the absence of a live-trading capability are likewise code properties.
- **D-008 (Sample Sufficiency)** — counts *how much* evidence exists. That is a property of
  the evidence set, not a claim that the strategy performed.

The independent verifier enforces the same exemption list separately, so the runner and
the verifier must agree on which dimensions are allowed to be promotable on synthetic
input.

## Gate decisions, in evaluation order

1. `INVALID` — any evidence source is `INVALID` or failed independent verification.
2. `INVALID` — D-002 is `FAIL`: with a broken backtest path no performance result can be
   trusted.
3. `INVALID` — D-010 is `FAIL`. **A breached safety boundary is a hard stop, not a hold.**
   A discovered live-trading capability, a failing kill switch, or non-atomic persistence
   invalidates the whole exercise; an earlier draft returned `HOLD` here, which was far
   too soft for the thing being discovered.
4. `INSUFFICIENT_EVIDENCE` — any evidence is missing, or a declared minimum sample
   threshold is unmet.
5. `REJECT_STRATEGY` — two or more of D-003..D-007 are `FAIL` (structural failure).
6. `REVISE_STRATEGY` — exactly one of D-003..D-007 is `FAIL`.
7. `CONTINUE_RESEARCH` — blockers and/or inconclusive dimensions remain.
8. `HOLD` — blockers remain although every dimension is otherwise adequate.
9. `PROMOTE_TO_EXTENDED_PAPER_REVIEW` — every dimension is `ACCEPTABLE` or `STRONG`, no
   blockers, no missing evidence, no synthetic evidence, sample thresholds met.

`PROMOTE_TO_EXTENDED_PAPER_REVIEW` is a request for owner review, not an action. Its
permitted next actions are review preparation only.

## Prohibited actions, unconditional in every result

Enable Live Trading; place real orders; use the Upbit private API; store credentials;
change production strategy parameters automatically; change the production symbol
automatically; start automatic Paper trading automatically; transition the pull request to
Ready automatically; merge automatically.

An `INVALID` or `REJECT_STRATEGY` decision additionally prohibits reusing the existing
research results, promoting the strategy, and publishing any profitability claim.

## Independent verification

`scripts/lib/strategy-research-promotion-gate-verifier.js` does not call the runner's dimension
evaluators or its decision helper. It re-derives the blocking conditions and the gate
outcome from the scorecard's own recorded dimension statuses and manifest, and separately
checks manifest completeness and canonical order, strategy-fingerprint linkage, the
provenance gate, the missing-evidence-implies-blocker rule, every promotion precondition,
the absence of a total score, the `PENDING` owner review, the unconditional prohibited
actions, and every hash. Recomputing a hash over tampered content therefore does not get
past it — the re-derived rules still fire.

## Determinism

Every output is a pure function of the request. There is no wall-clock timestamp anywhere
in the result: the only timestamps present are ones copied verbatim from the declared
evidence. Repeated runs over the same request are byte-identical, and shuffling the input
evidence order changes nothing but the input.

## Known limitations

- The scorecard is only as honest as the declared metrics. It verifies linkage, provenance,
  and file hashes; it cannot detect a research runner that produced a wrong number and
  reported it consistently.
- Thresholds in `policy` are researcher-chosen before the run. A different policy yields a
  different verdict; the policy is hashed into `requestSha256` so it cannot be adjusted
  after seeing the result without changing the hash.
- Dimension weighting does not exist by design, so "how close to promotable" is not a
  question this contract answers.
- `PAPER_OPERATIONAL_SAFETY` evidence is declared, not measured here. Real Paper
  acceptance evidence and an independent risk gateway (WO-0032) do not yet exist in this
  repository, so D-010 cannot currently exceed `INCONCLUSIVE` on real inputs.
- Nothing in this layer is evidence for Live Trading. The production strategy, symbol, and
  fee/PnL formulas are untouched.
