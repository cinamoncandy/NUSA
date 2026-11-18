# Cloudflare removal S1: does the phone depend on Cloudflare? (source-level findings, 2026-11-18)

Status: FINDINGS from reading `main`, not an approval and not a complete S1. Part of `docs/PROPOSAL_SIMPLIFICATION_2026-11-14.md` (S1) after the S0 inventory (`docs/CLOUDFLARE_REMOVAL_INVENTORY_2026-11-14.md`). Nothing here changes code, workflows, Cloudflare or the host.
Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

## 1. Question and method

S1 asks whether the shipped Android app needs anything that only Cloudflare (the Worker `nusa-autopilot`) provides. Method: search the source of `apps/mobile` and `apps/cloud` for `workers.dev` and `cloudflare`; list the workflows that call the Worker; extract the API paths the mobile clients call and check each against the host's route source.

## 2. What the source shows (read on main at 3b8ca85a9)

| Check | Result |
| --- | --- |
| `apps/mobile` (ts, tsx, json, js) referencing `workers.dev` or `cloudflare` | none |
| `apps/cloud/src` (the PAPER host) referencing `workers.dev` | none |
| Workflows referencing `workers.dev` | 7: `autopilot-cloudflare-deploy`, `autopilot-cloudflare-credential-preflight`, `autopilot-cloudflare-runtime-proof`, `cloudflare-deployment-readiness`, `autopilot-github-event-bridge`, `autopilot-execution-consumer`, `autopilot-deterministic-audit-release` (the last three are the auto-merge path of S0) |
| Mobile API origin | build configuration: `EXPO_PUBLIC_NUSA_API_BASE_URL` / `NUSA_CANONICAL_ORIGIN` from the repository variable `NUSA_MOBILE_API_BASE_URL` (android-stable-release, android-product-ux-acceptance); the value is not in the source |
| Host routes the app uses (found) | `/v1/mobile/bootstrap`, `/v1/mobile/me`, `/v1/mobile/session/refresh` (and the other `/v1/mobile/*` routes of the host), `/api/paper-operations`, `/api/settings/investment-allocation` |
| Calls that go to the exchange, not the host | Upbit public quotation (`/v1/ticker/all`, `/v1/candles/minutes/1`); `upbitLiveClient.ts` uses Upbit private paths (`/api/v1/account/summary`, `/api/v1/orders/...`): with `liveAuthority=NONE` this client must stay inert, which S1 must confirm |

## 3. Reading

At source level the phone does not call the Worker. The only Cloudflare dependency is the repository's own auto-merge path (S0). The mobile origin value is a repository variable that was `https://nusa-api.duckdns.org` on 2026-11-14 (S0 inventory); it was not re-read today.

## 4. What is NOT established (S1 stays open)

- The extraction found only the paths written as literals next to a request call. A complete table needs every client's path construction (constants, template strings) read by hand; this is a partial list.
- The value of `NUSA_MOBILE_API_BASE_URL` was not read now, and which app build the owner's phone really runs was not checked.
- Whether `upbitLiveClient.ts` is reachable from any screen with live authority off was not traced.
- The Worker's Durable Object state and secrets (S4 rollback) are not covered.

## 5. Next

Finish the complete call table, read the variable value in the repository settings (owner), check on the phone which origin the app shows in its diagnostics, and trace `upbitLiveClient`. Then S2 (shadow the Worker decisions in Actions) can be designed. No removal step starts before S2 and S3 conditions of the proposal are met.
