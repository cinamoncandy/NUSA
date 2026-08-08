# NUSA Constitutional Human Transition Runbook

This runbook starts only after the automated safe-preparation work orders are merged and verified. It does not authorize LIVE, deployment, risk increase, credential execution use, or money movement.

## Hard stop before real-world transition

The transition packet must remain `INCOMPLETE` until all required evidence is real external/human evidence rather than synthetic CI proof. Do not substitute CI fixtures, screenshots, chat approval, or inferred consent for the required evidence.

## Required human/environment sequence

1. Produce the exact production release artifact and independently verify its signing state and artifact digest against the sealed release candidate.
2. On an operator-controlled machine, configure read-only broker credentials using the OS-encrypted read-only credential boundary. Do not supply execution/withdrawal permissions.
3. With explicit operator authorization, run the external read-only environment preflight and retain only its secret-free receipt/digest.
4. Re-run the Restricted LIVE preflight against the exact code/config/release/rollback evidence. Any `UNKNOWN`, mismatch, open incident, unsafe state, or failed rollback/HALT evidence stops the process.
5. Conduct the real activation ceremony outside CI with the required distinct human requester and two distinct human approvers. Approvals must bind the exact scope and evidence; no AI/automation may act as an approver.
6. Only after the separate constitutional human decision, and only under the approved tiny bounded envelope, a human-controlled tiny Restricted LIVE session may be considered. This repository's automated preparation does not make that decision or initiate the session.
7. After any separately authorized tiny session, close execution transport and collect order/fill/position/cash reconciliation, hard-risk, HALT, audit-chain, and post-trade observation evidence.
8. Run post-LIVE validation. Any bound excess, reconciliation difference, unsafe/unknown evidence, open transport, or post-close mutation blocks progression.
9. Any later risk increase requires a new exact proposal and separate two-human scale-change governance review. There is no automatic renewal or scale-up.
10. Assemble the constitutional transition review packet. `READY_FOR_CONSTITUTIONAL_HUMAN_REVIEW` means only that required evidence is structurally present and externally/human verified; the final production/LIVE decision remains human-only.

## Current expected status

Until steps requiring actual signing, external broker observation, real human approvals, and any separately authorized tiny LIVE session have genuinely occurred, the constitutional transition packet must report `INCOMPLETE`.

## Never place in evidence

Raw broker credentials, secret keys, private keys, bearer tokens, raw signatures, account balances, executable authorization tokens, or full order payloads must not be stored in the transition packet. Use approved references and cryptographic digests only.
