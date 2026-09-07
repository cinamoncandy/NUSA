# Approved mobile visual application

Base: 307b535727a209c1b9ed57b6599b579c8e97bad0
Branch: codex/mobile-porcelain-cobalt

Owner requested implementation and Android delivery of the approved Study 03 design. This supersedes the prior design-only restriction for this bounded UI slice, not for automatic trading/server/account redesign.

Master light/dark tokens now use porcelain/cobalt and midnight/cobalt. Home uses a compact overview heading, public-market chart, surfaced PAPER capital card and highlighted canonical learning summary. Existing chart normalization and CandlePlot are reused. Actual supported one-minute candles replace the mockup's illustrative graph and fake interval choices. No sample price, sample learning state or activation control is shipped. Other screens inherit shared tokens while retaining their canonical flows.

Validation on Node 24.18.0 / pnpm 11.7.0: build PASS; typecheck PASS; 402/402 mobile Node tests PASS; validate:full PASS; lint PASS with existing unused timers warning in paper-runtime-supervisor-budget.test.js; security:gate PASS with zero secrets; git diff --check PASS. Three obsolete visual literals in regression tests were updated to the approved palette/spacing, without removing authority or data assertions. New negative cases cover stale/offline/missing/malformed chart data.

CI, independent Audit, native build, Android release/Firebase and physical device acceptance remain pending at this commit. Local checks do not prove deployment or Galaxy appearance. No other dirty worktree was modified. Safety remains liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY.
