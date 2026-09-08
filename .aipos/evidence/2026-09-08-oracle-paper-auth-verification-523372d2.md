# Oracle PAPER authenticated verification — 523372d262a99fa5c8fcfb6c6417915db13830d1

Status: VERIFIED for repository + Oracle runtime scope.

## Protected-main evidence

- Protected main / deployed source: `523372d262a99fa5c8fcfb6c6417915db13830d1` (merge of PR #1780).
- PR #1780 exact head: `6955267dae2aca4695506fab4eacbb5698b2d932`.
- PR exact-head CI: PASS.
- PR Actual PAPER Public-Market Runtime Evidence: PASS.
- PR Restricted LIVE capability, transport readiness, activation rehearsal: PASS.
- PR read-only broker credential integration: PASS.
- Post-merge main CI run `34178491758`: PASS.
- Post-merge Actual PAPER run `34178491718`: PASS.
- Exact-Head PAPER Readiness Convergence run `34178586873`: PASS.

## Oracle deployment evidence

- Active immutable release: `/opt/nusa/releases/523372d262a99fa5c8fcfb6c6417915db13830d1`.
- `NUSA_SOURCE_COMMIT`, `NUSA_SOURCE_COMMIT_SHA`, and `NUSA_CLOUD_SOURCE_VERSION` all equal `523372d262a99fa5c8fcfb6c6417915db13830d1`.
- `NUSA_MODE=PAPER`.
- `NUSA_LIVE_MUTATION=PROHIBITED`.
- `scripts/oracle-validate.js`: PASS.
- Authenticated `/ready`: HTTP 200 with database, migrations, dashboard persistence, and runtime recovery checks true.
- Authenticated `/api/dashboard`: HTTP 200, mode `PAPER`.
- Authenticated `/api/live-readiness`: HTTP 200, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.
- Authenticated `/api/paper-operations`: HTTP 200, mode `PAPER`, `liveAuthority=NONE`, `productionMutationAllowed=false`.
- Authenticated `/api/engineering-operations`: HTTP 200, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, `mutationAllowed=false`.
- Authenticated `/api/evolution-learning`: HTTP 200, `authority=READ_ONLY`, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.
- Local runtime `/health`: HTTP 200.
- Caddy TLS/SNI to `nusa-api.duckdns.org` through loopback: HTTP 200.
- Invalid mobile refresh: HTTP 401 / fail-closed.
- Current compiled rate-limit regression: PASS, including anonymous/authenticated/mobile-refresh lane isolation and pre-limit side-effect purity.

## Network evidence boundary

The available independent execution environments could not directly resolve/fetch the DuckDNS hostname. Therefore this evidence **does not claim independent outside-in public DNS reachability**. Oracle-local runtime, TLS/SNI proxy routing, exact-source deployment, authenticated read-only behavior, and safety authority projections are proven. Outside-in public DNS reachability remains a separate network-level evidence item and does not change the PAPER-only authority conclusion.
