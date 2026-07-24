# Funding Persistence Feature v1

`FundingPersistenceFeature.ts` converts completed funding-market observations into a deterministic, immutable feature vector for research and PAPER/DRY_RUN workflows.

## Inputs

Each observation contains:

- market and unique sample ID
- completed close timestamp
- funding rate
- mark and index prices
- open interest
- volume

The engine consumes only the trailing `lookbackSamples` window. Samples must be unique, strictly chronological, from one market, no later than `generatedAt`, and separated by no more than `maximumGapMs`.

## Outputs

The feature vector includes:

- funding mean, standard deviation, and z-score
- funding velocity and acceleration
- same-direction extreme persistence count and ratio
- open-interest and volume deltas
- mark/index basis rate
- funding × OI-delta and funding × volume-delta interactions
- direction, quality, warnings, and exact source provenance

## Safety semantics

- No interpolation or gap filling
- No future samples
- No mixed markets
- No duplicate sample IDs
- Zero funding variance is explicit and lowers quality
- The engine emits research features only; it cannot submit orders, allocate capital, promote a strategy, or enable LIVE trading

## Persistence definition

Persistence is the number of consecutive trailing observations whose z-score remains beyond `extremeZScore` in the same sign as the latest observation. A non-extreme latest observation has zero persistence and `NEUTRAL` direction.

## Validation

`tests/funding-persistence-feature.test.js` covers deterministic output, immutability, trailing-window isolation, future data, duplicates, mixed markets, gaps, zero variance, and invalid policy inputs.
