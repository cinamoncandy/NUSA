# AI CIO Decision Engine v0.1

This slice combines bounded, timestamped domain signals into a deterministic portfolio action.

## Inputs

- one signal per source
- score in `[-1, 1]`
- confidence in `[0, 1]`
- no future observations
- current and maximum allocation
- risk level and trading-enabled state

## Outputs

- `BUY`, `SELL`, `HOLD`, `REDUCE`, `EXIT`, or `WAIT`
- bounded allocation and leverage
- deterministic score, confidence, and ordered reasons

## Safety policy

- disabled trading always returns `WAIT`
- `CRITICAL` risk exits existing exposure and never opens exposure
- `HIGH` risk reduces existing exposure and never opens exposure
- malformed, duplicate, stale-order, future, or out-of-range signals fail closed
- leverage is capped by input policy and v0.1 never exceeds 2x

This engine does not place exchange orders. It produces an immutable decision object for later Paper Trading integration and audit storage.
