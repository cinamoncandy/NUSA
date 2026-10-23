# Main handoff — 2026-10-22 (CORE session)

Scope: records only. Safety unchanged: PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY.
Re-verify everything below on GitHub before acting; the repository is the source of truth.

## Learning loop (owner's top priority)

- Root cause (WO-LEARNING-20261021-ROOT-CAUSE, #2850): the loop is blocked by evidence, not code. After about 20 bp round-trip costs no candidate beats the fixed SMA 5/20 champion.
- Pre-registered studies, all merged to main and frozen by sha256 (`scripts/lib/preregisteredDesign.js`):
  - S2/S3/S4 (docs/research-ledger/PREREGISTERED_STUDIES_2026-10-21.md, `DESIGN_SHA256`): holdout 2026-11-05..12-05, verdict from 2026-12-05T02:00Z, runner `scripts/run-preregistered-studies.js` (refuses to run unless the hash matches).
  - S5 (docs/research-ledger/PREREGISTERED_STUDY_S5_2026-10-22.md v6.1, `S5_DESIGN_SHA256`): order-book imbalance, 15-minute horizon, holdout 2026-12-06..12-20, eligibility training 2026-11-22..12-06, verdict from 2026-12-20T02:00Z, runner `scripts/run-s5-study.js`, code merged in #2863.
  - Older order-book study (WO-RESEARCH-20261014-ORDERBOOK-STUDY): prints from 2026-10-29T02:00Z.
- Data retention (#2854, merged): migration 032 archive table `research_orderbook_study_rows`; the studies read live UNION archive. NOT YET DEPLOYED to the server. The first irreversible 14-day prune boundary is 2026-10-28T01:22Z; deploy before it or training days are lost (S5 needs it before 2026-12-06, the others before 2026-10-28).

## Blocker: #2770 / PR #2855 (author: another session; do not push to its branch)

- Server release of #2854 must wait for #2855 (PAPER startup exceeds the 300 s readiness budget; Oracle runs rollback SHA 345539... while main moves). Do not dispatch another Oracle PAPER release before #2855 is merged and accepted.
- State at 2026-10-22T11:45Z: Draft/HOLD, exact head 4e5b0e75, exact-head CI green. Advisory review (Claude, non-formal) and a formal fresh VALIDATOR session (`session_017gbZGPtqpLuAmY9vSsCjWd`) gave ACCEPTED_WITH_CONDITIONS bound to that SHA: (1) preflight must confirm `dist/packages/storage/src/sqliteIntegrityBootstrap.js` exists in the candidate release before any unit install, (2) re-validate if the head changes or main is synced, (3) post-merge Oracle startup/restart/replay acceptance still open. Remaining gates: author changes, Independent Audit, Release authorization, HOLD removal, bot merge, one exact-main Oracle PAPER deploy.
- Before the server release ask the owner (brief Korean) to confirm a recent daily backup (migration 032 is forward-only; a binary rollback then cannot open the database).

## Shipped this session

- Mobile: futures tab, tab rename, gate-dot motion, decision-core motion, meta-learning ledger fix, Android 1.0.621 and later (main 21241b67 released); stale-quote banner no longer shown while a refresh is only in flight (#2856); a late phone quote adds a note instead of replacing the Home headline, button roles on Home (#2860); storybook 8.6.19 (#2861, advisories 1242751/1242755).
- Android release workflow `android-stable-release.yml` is DISABLED; enable only around one dispatch, with the full source SHA, and disable again.

## Scheduled / next safe actions

1. 2026-10-29T03:30Z: read `orderbook_study` (dispatch oracle-host-diagnose, read-only), record the result in docs/research-ledger/experiments.json and AIPOS; about 10-30 check that dataset-manifest skipping stopped.
2. Keep watching #2855; if it is unresolved on 2026-10-25 tell the owner (the 10-28 deadline).
3. META assignment policy PR #2799 stays deferred until after the 2026-10-29 result.
4. After the 2026-12-05 and 2026-12-20 verdicts record PASS/FAIL honestly; a PASS qualifies only a forward SHADOW test.
5. Optional UI/UX work needs screenshots from the owner; 8 mobile views still have no accessibility labels (notification, portfolio, orderHistory, more, safety, chart, performance, realReadOnlyMonitor).

## What was NOT verified

No device rendering of any mobile change; no run of any study on real data (they print WAITING_DATA before their dates); nothing on the Oracle host; storybook build/dev.
