# WO-AI-011 Tail-Risk Validity Test Contract

Status: PLANNING / AUDIT ONLY  
Runtime implementation: NOT STARTED / SERIALIZED  
Authority: PAPER / READ-ONLY / ZERO_AUTHORITY  
LIVE authority: NONE  
Production mutation: NOT ALLOWED  
WO-0051: HUMAN_ENVIRONMENT_ONLY

## Purpose

Prevent strong ordinary-regime averages from being interpreted as robust AI trading quality when realized rare-event evidence is sparse, clustered, ambiguously classified, or dominated by synthetic/replay evidence.

## Immutable confirmatory identity

A confirmatory tail evaluation must freeze before outcome inspection:

- tail-event family and event taxonomy;
- event threshold and severity bands;
- point-in-time event classification inputs;
- lookback/evaluation windows;
- event-clustering and dependence policy;
- minimum realized event count and minimum effective sample size;
- tail metrics and aggregation formulas;
- allowed missingness/outcome-resolution policy;
- ordinary-regime versus tail-regime separation rules;
- repeated-look/multiple-comparison policy inherited from WO-AI-011 statistical validity.

Any post-hoc change creates a new exploratory/versioned evaluation and cannot overwrite the frozen confirmatory result.

## Required fail-closed behavior

Return `INSUFFICIENT_EVIDENCE` instead of a favorable tail-quality claim when any material condition is unresolved, including:

- too few realized tail events;
- multiple observations drawn from one clustered stress episode but counted as independent;
- unresolved or stale outcome lineage;
- hindsight-only stress classification;
- missing point-in-time liquidity/volatility/market-state evidence when material;
- material missingness or abstention that selectively removes hard tail cases;
- unknown dependence across assets, timestamps, events, providers, prompts, or horizons;
- synthetic, replay, scenario, or hypothetical evidence being substituted for realized tail outcomes.

## Tail metrics kept separate from ordinary averages

When sufficient realized evidence exists, report tail evidence separately, including as applicable:

- tail conditional loss / downside realized loss;
- worst-k event behavior under a frozen k policy;
- downside calibration error;
- prediction accuracy within frozen severity bands;
- abstention rate under stress;
- evidence and outcome coverage under stress;
- disagreement rate under stress;
- economic-usefulness components under stress using the frozen WO-AI-011 cost/benchmark identity.

Ordinary-regime averages must not overwrite, pool away, or hide materially worse tail behavior.

## Provenance separation

Evidence classes remain explicit:

- `REALIZED` — may satisfy realized tail acceptance only if lineage and sample rules pass;
- `REPLAY` — advisory validation only;
- `SYNTHETIC` — stress exploration only;
- `SCENARIO` / `HYPOTHETICAL` — counterfactual analysis only.

Non-realized classes can expose weaknesses but cannot prove realized rare-event robustness.

## Required adversarial tests

1. Post-hoc threshold selection after observing losses is rejected or labeled exploratory.
2. Three hundred observations from one crash episode cannot become 300 independent tail samples.
3. Duplicate/retry/replay records cannot increase realized effective sample size.
4. Missing high-loss outcomes force fail-closed evidence status rather than improve tail metrics.
5. Hindsight volatility labels cannot satisfy point-in-time regime/tail classification.
6. Strong aggregate accuracy cannot suppress a materially poor frozen tail metric.
7. Synthetic stress success cannot substitute for missing realized crash evidence.
8. Sparse realized events return `INSUFFICIENT_EVIDENCE` despite favorable point estimates.
9. Tail degradation or recovery remains immutable evidence and cannot trigger model/provider/prompt/strategy/risk/LIVE mutation.
10. Deterministic replay of the same immutable evidence produces identical advisory results.

## Serialization and authority

This artifact does not authorize runtime implementation. It does not satisfy Issue #349 / PR #371 physical Android acceptance, external operator preflight, human activation ceremony, constitutional production decision, or any real-money LIVE gate.

No tail-risk output may automatically change provider, model, prompt, strategy, position sizing, hard-risk limits, kill switch state, broker state, or LIVE authority.
