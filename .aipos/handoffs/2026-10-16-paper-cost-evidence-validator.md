# PAPER cost evidence — fresh validator handoff
Scope: canonical strategy quote admission only; no historical repair or period retirement is activated.
Base: 310d34d7d785cf89d0503f2619954218c94f6b67.
Branch: codex/paper-cost-evidence-20261016.

Reproduction: prior canonical boundary accepts a fully bound, risk-ALLOW strategy tick with no observed quote and creates a FILLED result whose cost evidence is explicitly INCOMPLETE. Real read-only canonical reconciliation reproduces the same stable rejection on the existing open period. Raw fill/account/price information remains outside the public repository.

Fix: reuse validatePaperObservedExecutionQuote before canonical risk evaluation for new strategy intent and working continuation. Missing quote returns existing INVALID_ORDERBOOK_QUOTE; existing depth-wait/replay and risk-reducing cancellation retain their behavior. No simulator, Risk policy, thresholds, TTL, account, manual command or lineage history edits.

Review especially:
- Every automatic production path uses this boundary; no alternate mutation fallback.
- Fresh quote validation precedes risk idempotency claim and order/fill persistence.
- Working-order continuation without quote/depth produces no new fills and preserves state.
- Invalid/future/stale/wrong-market/tampered receipt cannot execute.
- Positive tests use canonical quote receipts and retain existing financial/sizing assertions.
- Incomplete historical fill stays immutable and blocks performance admission.
- Proposed disposition is NOT IMPLEMENTED and cannot authorize row deletion, synthetic cost or fake completion.
- Rollover failure disposition needs an independently accepted durable/checkpoint contract; existing retirePending deletion is insufficient.
- No new source binding/Research qualification or LIVE authority.

Author managed full strict TS/root/mobile programs PASS; focused and repository gate receipts recorded separately. Request a separate fresh non-author review of FINAL commit and base; author results are not independent PASS. Keep Draft until then. Subsequent deterministic Audit/Release bot only.

CI repair:0880eb97 CI38875954837 failed on exact-source pin and ticker-only #755 fixture; actual logs and local reproductions preserved. EXECUTION sourceCommit now points to implementation0880eb97/blob e0f73d356659e5f7d2be17c729cf7795c64a3be1. Criterion statuses/10X-S TARGET_ONLY remain unchanged. #755 now drives existing snapshot/reconciler/quote callbacks before ticker; original FILL/LEARNING/restart-dedupe checks retained. Historical exact-head receipts: implementation head 85ad783fafe8dfb1214cef4c3b0bc537bfaed147 / run 38877067204 PASS; AIPOS sync head 08673732458a6ba1652292d7766b6bace79cf31b / run 38908235645 PASS. Static AIPOS records completed receipts only; verify the current PR head and its CI dynamically from GitHub Actions at review time. Independent non-author review, Audit, Release, merge, and runtime acceptance remain pending or unverified.

## Fresh review finding and local repair (2026-10-16)

An independent fresh Codex validator reviewed head 89a55a1bffe19184df49ce0720b2b4241b370409 against main 310d34d7d785cf89d0503f2619954218c94f6b67 and found P0=0/P1=1/P2=0. Present order-book depth was consumed after the persistent Risk gate, so a valid quote receipt paired with tampered depth could claim the continuation/intent identity before execution rejected the depth; a corrected retry could then conflict. The canonical boundary now runs the existing depth validator before Risk whenever depth or its fingerprint is supplied, for both new and continued automatic strategy intents. Added adversarial regression tests prove rejection without Risk/state mutation and successful corrected retry on the same intent. Local evidence: 38 related tests, build, typecheck, validate:full, lint (24 pre-existing warnings), and security:gate PASS. This repair is not yet pushed; fresh exact-head CI and a fresh review of its resulting head are required. No GitHub review was submitted; Audit/Release/merge and all live PAPER runtime acceptance remain pending/unverified. The separate review was Codex, not Claude.
