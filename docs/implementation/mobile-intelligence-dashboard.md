# Mobile Intelligence Dashboard

## Scope

This module defines the framework-independent presentation contract for the future React Native NUSA mobile cockpit.

It does not fetch news, call an LLM, place orders, store exchange credentials, or predict guaranteed prices.

## Inputs

- ranked global and crypto news evidence
- scenario probabilities for bullish, sideways, and bearish outcomes
- AI attention signals
- aggregate confidence, risk level, and operator-facing outlook

## Output

`buildIntelligenceDashboard` returns an immutable view model containing:

- top news ranked by `impact * reliability`
- exactly three probability scenarios sorted by probability
- deterministic signal ranking
- the primary scenario and its planned response
- the explicit `SCENARIO_NOT_PREDICTION` disclaimer

## Safety boundaries

- probabilities must sum to 1
- news and signal IDs must be unique
- scores and confidence must be finite and bounded
- timestamps must be non-negative safe integers
- duplicate related assets are rejected
- identical input produces identical output
- no market order or live trading path is introduced

## Mobile integration

A future React Native screen should consume this model without duplicating ranking or validation logic. The mobile app remains a monitoring and control cockpit; exchange secrets stay on the server-side secret store.
