# WO-AI-011 Point-in-Time Leakage Test Contract

Status: planning/audit hardening only. No runtime implementation authorization.

## Objective

Define fail-closed tests that prove longitudinal AI trading evaluation uses only information that was available to the system at prediction time and cannot gain performance from revised, future, or survivorship-contaminated data.

## Required clocks

Every evaluation input that can change over time must preserve distinct clocks where applicable:

- `event_time`: when the underlying market/company event occurred;
- `received_time`: when NUSA received the datum;
- `model_available_time`: when the datum became eligible for the prediction runtime;
- `prediction_time`: immutable cutoff for one prediction;
- `outcome_window_start` / `outcome_window_end`: realized-label horizon.

A datum is prediction-eligible only when its causal availability is demonstrably no later than `prediction_time`. Ambiguous or missing clocks fail closed.

## Mandatory contamination tests

1. **Revised fundamentals / macro data** — a later revision cannot replace the vintage visible at prediction time.
2. **Corporate actions** — splits, dividends, symbol changes, mergers, bankruptcies and delistings must use point-in-time knowledge and adjusted/unadjusted series identities explicitly.
3. **Universe membership / survivorship** — historical evaluation must include securities that later delisted or left the universe and must use the universe membership known for that historical date.
4. **News and filing latency** — publication timestamp alone is insufficient when ingestion or model availability was later; the latest relevant availability clock governs.
5. **Overlapping label horizons** — train/validation/holdout or walk-forward windows whose realized-outcome horizons overlap must be purged/embargoed or rejected according to the frozen partition policy.
6. **Future benchmark leakage** — baselines, regime labels, benchmark constituents and normalization parameters must be frozen using information available at the evaluation cutoff.
7. **Backfilled missing data** — later backfills cannot make an earlier prediction appear to have consumed data it did not receive.
8. **Cost-model lookahead** — fee, spread, slippage, borrow/funding and turnover assumptions must carry version/effective-time identity and cannot use later realized execution conditions as prediction-time inputs.
9. **Outcome provenance** — realized, synthetic, replay and hypothetical labels are distinct immutable provenance classes; only realized labels can satisfy realized-outcome evidence.
10. **Duplicate/replay identity** — reruns of the same immutable prediction/outcome lineage must be idempotent and cannot multiply sample counts.

## Required partition evidence

Each temporal holdout / walk-forward partition must bind at minimum:

- partition id and schema version;
- train/validation/holdout boundaries;
- prediction horizon and label horizon;
- purge/embargo rule when horizons overlap;
- frozen universe identity;
- data-vintage identity;
- provider/model/prompt/schema/calibration identities;
- cost-model and benchmark identities;
- immutable digest of the included prediction ids.

Mutation of any bound identity creates a new partition/version. Silent repair is prohibited.

## Acceptance behavior

- Future-contaminated, revised-without-vintage, ambiguous-clock, stale, corrupt, or lineage-incomplete records: **REJECTED / FAIL_CLOSED**.
- Insufficient sample count or observation window: **INSUFFICIENT_EVIDENCE**.
- Synthetic/replay/hypothetical-only evidence: cannot satisfy realized-market evaluation.
- Degradation findings: advisory evidence only; cannot mutate provider, model, prompt, strategy, sizing, risk, promotion, broker state, kill switch, HALT, or LIVE authority.

## Safety and serialization

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI remains `ZERO_AUTHORITY`
- PAPER/read-only only
- WO-0051 remains `HUMAN_ENVIRONMENT_ONLY`
- Issue #349 / PR #371 physical Android acceptance is not satisfied by this work
- runtime implementation remains prohibited until serialization permits it
