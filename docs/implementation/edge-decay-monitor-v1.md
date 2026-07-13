# Edge Decay Monitor v1

## Purpose

Detect material deterioration in a validated edge before the deterioration becomes a large capital loss.

## Inputs

The monitor compares an immutable baseline performance window with a distinct recent performance window. Both windows include:

- sample size
- Sharpe ratio
- win rate
- expected calibration error
- profit factor
- maximum drawdown
- average slippage
- estimated capacity

## Output

The monitor returns:

- `GREEN / YELLOW / ORANGE / RED`
- `MAINTAIN / OBSERVE / REDUCE_CAPITAL / SUSPEND`
- normalized decay score
- evidence confidence
- per-metric deterioration and contribution
- explicit reasons
- policy and edge versions

## Safety properties

- deterministic and replayable
- immutable result
- future windows rejected
- insufficient recent evidence cannot produce a green operational conclusion
- no strategy promotion
- no direct capital mutation
- no order submission
- PAPER / DRY_RUN only

## Operational integration

`ORANGE` is an input to the Capital Allocation Engine for reduction. `RED` is an input to Governance and Risk for suspension. Actual lifecycle changes remain separate audited decisions; this monitor only produces evidence and a recommendation.
