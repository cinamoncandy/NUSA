# Paper Pilot Operational Criteria

`PAPER_PILOT_OPERATIONAL_EVIDENCE` is the sole aggregate for a Paper-pilot promotion
review. It is generated from independently verified session evidence and is hash-sealed.
No generated evidence is committed to Git.

Shadow requires at least three operational sessions, 360 elapsed minutes, 300 closed
candles, 20 signals, one restart recovery, one reconnect recovery, a matching source
commit and fingerprints, verifier PASS, no P0, and zero actual mutation.

Canary requires at least two operational sessions, 120 elapsed minutes, five Paper
orders, two completed trades, restart and reconnect validation, verifier PASS, fresh
evidence, no unauthorized order, no duplicate or orphan fill, no reconciliation failure,
no persistence continuation, no automatic resume, and no P0.

The current repository has no operational session evidence. Its truthful status is
`OBSERVATION_INCOMPLETE`; this does not authorize Extended Paper, Live trading, private
API access, credentials, or runtime mode changes.
