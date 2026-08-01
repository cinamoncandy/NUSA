# Execution Recovery Runbook

## Submission unknown

1. Stop new live submission through the existing kill switch and keep the execution in `SUBMISSION_UNKNOWN`.
2. Do not change `clientOrderId` and do not retry submit.
3. Use the exchange read-only lookup bound to the existing client and exchange order identifiers.
4. Record the lookup result and transition evidence. If lookup is unavailable, keep the state unknown.

## Reconciliation difference

Treat `DIFF` or `UNKNOWN` as a blocker. Do not infer missing fills, fees, quantity, or an absent order. Preserve local and provider observations, open a review item, and keep new submission blocked until an explicit operator process resolves it.

## Recovery blocked

On restart, inspect all active records and their last transition. Recovery is complete only after each record has a deterministic reconciliation result. Never resume a submission automatically and never delete a recovery record or transition history.

## Evidence and secrets

Collect execution IDs, client order IDs, states, transition sequences, timestamps, and sanitized provider classifications. Never collect API keys, secrets, JWTs, authorization headers, signed queries, or raw credential material.
