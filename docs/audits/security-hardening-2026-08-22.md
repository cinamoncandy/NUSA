# NUSA Security Hardening Report

Audited: 2026-08-22

| Gate | Result |
|---|---|
| Dependency vulnerability scan | PASS |
| Exact dependency backports | PASS |
| Dependency license verification | PASS |
| Lockfile integrity | PASS |
| Secret scan | PASS |
| Artifact checksum verification | NOT_APPLICABLE |
| Release signing verification | NOT_APPLICABLE (NOT_APPLICABLE) |

## Compensating controls

- GHSA-w3rx-r6r6-pgpr (image-size, audit id 1138808): exact source backport verified
- GHSA-5p2g-fcmc-qvqq (image-size, audit id 1138809): exact source backport verified

Any advisory outside the exact mapped IDs/packages above remains blocking. A source-shape or version mismatch fails closed.

## Safety

- productionMutationAllowed=false remains required for release manifests.
- Live trading remains disabled.
- Credentials are not introduced or printed.
