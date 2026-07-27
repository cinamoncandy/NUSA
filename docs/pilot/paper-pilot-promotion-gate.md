# Paper Pilot Promotion Gate

`scripts/lib/paper-pilot-promotion-gate.js` returns only evidence decisions:
`BLOCKED`, `OBSERVATION_INCOMPLETE`, `OWNER_REVIEW_REQUIRED`, or
`ELIGIBLE_FOR_EXTENDED_PAPER`. It never starts, resumes, or changes a runtime mode.

`BLOCKED` applies to a bad seal, stale source or fingerprints, verifier failure, Shadow
mutation, unauthorized Canary order, duplicate/orphan fill, reconciliation failure,
automatic resume, persistence continuation, P0, invalid approval, or Live/private/
credential capability. Observation shortfalls remain `OBSERVATION_INCOMPLETE` rather
than being invented from fixtures or dry runs.

An eligible evidence package still requires an independently sealed owner review. The
accepted review decision is `APPROVED_FOR_EXTENDED_PAPER`; a review is not an execution
command and has no production authority.
