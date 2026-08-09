# WO-AI-007 Implementation Notes

This implementation introduces a provider-neutral N-version comparison path for the `STRATEGY_PROPOSER` role.

## Intelligence invariant

Independent provider groups receive one canonical evidence context, one prompt/schema identity, and one model-input hash. The comparison records decision, raw probability, uncertainty, assumptions, rationale claims, and evidence references. Agreement never raises execution authority or calibrated confidence; material disagreement forces abstention.

## Independence invariant

Cross-provider consensus requires at least two completed groups with distinct canonical provider identities and distinct declared model-family lineages. Group aliases and repeated models from one provider cannot inflate the independent-group count. Runtime provider/model identity must exactly match the immutable pool policy before inference starts.

## Resource invariant

All provider attempts share one `InferenceResourceLedger` from WO-AI-006. Provider fan-out cannot bypass call, retry-attempt, input-byte, output-token, or wall-clock ceilings. Resource exhaustion blocks later provider side effects before invocation.

## Safety invariant

The comparison result is evidence-only and always retains:

- `liveAuthority=NONE`
- `realOrderAuthority=false`
- `realTransferAuthority=false`
- `productionMutationAllowed=false`

No provider vote, consensus, disagreement score, or abstention state can mutate PAPER, strategy promotion, deterministic risk, P0/HALT/kill-switch state, credentials, or LIVE authority.

## Next implementation step

After the provider-neutral runtime passes exact-head compilation and adversarial regressions, add a second explicitly opt-in provider adapter only against the provider's current official API contract, then wire comparison evidence to the existing read-only Cloud AI surface.
