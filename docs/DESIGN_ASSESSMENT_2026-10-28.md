# NUSA design and structure assessment — 2026-10-28

Status: assessment, not a decision. Safety is fixed and is not scored: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`,
`aiAuthority=ZERO_AUTHORITY`. Nothing here loosens a risk limit, threshold or capital.

Method: three fresh, non-author assessors each read the code and docs through one lens and posted a rated assessment on issue #2770
(A trading architecture, comment 6469911885; B learning and product, 6469901726; C process and maintainability, 6469900018). Their
ratings are merged below with the author's own measurements and with the one fact none of them had: the host release failure of the same day.
Ratings are 1 (weak) to 5 (strong). UNVERIFIED means no one read it on the host.

## 1. Verdict

The direction is right and the safety shape is sound: one mutation boundary, one risk gate, a content-addressed order intent, a writer lease,
fail-closed reconciliation, honest "not received" screens. The design is **not yet a good basis for a trading app**, because the loop that
produces evidence does not run, nothing proves it runs, and the delivery system around it is heavier than the product it protects.
Three independent assessors reached the same core finding without being told it.

| Area | Rating | One-line evidence |
| --- | :-: | --- |
| Safety invariants and fail-closed boundaries | 4 | A, C: single mutation boundary, validators, release only through the deterministic bot. |
| Core loop and coupling | 3 | A: linear, but the whole chain runs in one 873-line callback. |
| State and persistence | 2 | A: trading state and research data share one SQLite file on one 954 MB host; backup took 2 h on 2026-10-28. |
| Failure modes and observability | 2 | A, C: 4,824 of 4,824 BUY intents failed for days with no reason shown (fixed in part, see section 3). |
| Delivery (release, CI, deploy) | **1** | Section 2. A release did not complete on 2026-10-28; the host is two days behind main. |
| Path to a measurable edge | 1 | B: 192 configurations, 0 holdout passes, 0 real fills since 2026-10-18. |
| Learning feedback into decisions | 1 | B: advisory only; `cyclesEvaluated=0`. |
| Strategy diversity | 2 | B: one fixed rule (SMA 5/20), chosen by decision, not measured against a null. |
| Mobile product | 3 | B: honest and explains "why"; silent on the first broken stage and on research results. |
| Unreached code | 2 | C: 84 modules unreached after the first deletions; about 45% of cloud modules are not reached from the host. |
| Process weight vs value | 2 | C: 39 workflows, 525 work orders (91 closed), 30-day commit stream of 2,248 (890 merges). |
| Tests | 2 | C: 225 of 970 test files read source text; 382 never load compiled code. |
| Single points of failure | 1 | One host, one database, one owner, one model family for author and reviewer. |

## 2. The weakness that decides the rest: a release cannot finish on the production host

Evidence (Oracle PAPER release run 40697488340, main `fa032d3b0`, owner-approved):

- Build 1.5 min; **backup 2 h**; download of the 372 MiB bundle 8.5 min (about 0.7 MiB/s); "Verify and unpack" still running when the 40-minute
  job limit cancelled it. Stage, preflight and activation were skipped. The host still runs `c59b522` (2026-10-26).
- The previous "successful" release (run 40448780153, 2026-10-27) also skipped every host step because main had moved while the 2 h backup ran.
- With 2,248 commits in 30 days, "main must equal the released SHA at activation" cannot be met by a 4-hour release unless merges are frozen.

Consequence: the 100,000 KRW capital, the scaled risk limits, the alarm and the funnel reason codes are merged but not running. Every other
finding is moot while changes cannot reach the host.

Cause found: the sealed bundle contained the whole workspace `node_modules` (1.5 GB: Electron, React Native, Skia). The host runs plain Node and loads
one package, `ws`. Fix in PR #2927 (23 MiB instead of 372 MiB, loaded and tested on the builder). Still open and owner-owned: the 2 h backup (state DB split,
WO-ARCH-20261027-STATE-DB-SPLIT) and the host itself (1 vCPU, 954 MB, about 0.8 MiB/s disk).

## 3. Weaknesses, merged and ranked

Marks: **A**, **B**, **C** = which assessor ranked it; DONE = already fixed on main; SAFE = can be done without touching limits, authority or capital;
OWNER = needs the owner.

1. **Changes do not reach the host (section 2).** All. #2927 (SAFE, in review); backup time and host size OWNER.
2. **The evidence loop fails silently.** A, B, C. Reason codes over 48 characters were dropped (DONE #2913), per-stage first-broken-stage projection (DONE #2899),
   invariant alarm (DONE #2907), off-host health record (DONE #2902). Still open: nothing exits on a lost writer lease (A3, OWNER); the app does not show the first broken stage (B8, SAFE).
3. **The PAPER account was too small to trade or learn from.** A, B. Capital is now 100,000 KRW (DONE #2916) and risk limits scale to capital (DONE #2917; assessor A's item 4 predates reading it).
   Still open: the session drawdown peak is kept in memory and resets on restart (A4, OWNER).
4. **Risk identity is hard-coded.** A. `ACCOUNT_ID = "paper-default"` is still used; #2919 documents it and does not change it. Pinned file; needs requalification (OWNER).
5. **No null comparator, one rule, no diversity.** B. Add buy-and-hold and random-entry shadows and zero-authority shadows of RSI and Donchian beside the baseline shadow (SAFE).
6. **Governance far ahead of evidence.** B, C. No new learning or governance layer until one honest end-to-end cycle exists (OWNER, priority). The unreached-module census continues (SAFE).
7. **Qualification pin guards an empty claim.** A, C. Keep RISK and EXECUTION pins; apply option A of WO-GOV-20261027-QUALIFICATION-PIN-SCOPE for the rest (SAFE convention; which stages stay pinned is OWNER).
8. **Tests assert text.** C. Replace source-regex tests with behaviour tests, starting with RISK and EXECUTION (SAFE; never delete a safety assertion before its replacement passes).
9. **Work-order and state sprawl.** C. One status enum, an archive for closed work orders, a generated "current truth" page (SAFE, records only).
10. **Author and reviewer are the same model family; CODEOWNERS/identities not separated.** C. OWNER (account and branch-protection settings).
11. **Hot-path work grows with history.** A7. Behaviour-preserving but in a pinned file; needs requalification (OWNER).
12. **Single exchange and spot only.** A. Extract an instrument interface behind current behaviour (SAFE, later).

Where assessors differ: A rates the safety shape above C ("sound but unproven"), and C rates the pin lower than A. Both agree the pin is a change detector, not a quality gate.
Assessor A's item 4 (limits not scaled) and item 1 (long codes) were fixed on main before or while they read it; they are kept above as DONE so the history is clear.

## 4. What is genuinely good (keep)

Single mutation boundary; content-addressed order intent; writer lease with clock-regression checks; fail-closed reconciliation; one Asia/Seoul trading-day definition;
pre-registered research with an append-only ledger that records negatives; the uncensored baseline shadow; plain-Korean block reasons; merge only through the deterministic release bot;
the census and the target-architecture proposal themselves (they report the nine silent days).

## 5. Decisions for the owner

| Decision | Recommendation |
| --- | --- |
| Approve #2927 (lean release bundle) and one release run after merge | Yes. Smallest change that lets a release finish; the run proves it. |
| The 2 h backup and the 1 vCPU host | Check the host's disk throughput in the Oracle console (0.8 MiB/s is far below the volume's normal rate; swap thrashing is the first suspect). Then split research data from `state.sqlite` (the existing work order). Moving to a larger Oracle instance is an alternative. |
| Freeze merges during a release | Until the release is under one hour, yes, for the activation window. |
| Exit on lost writer lease so systemd restarts it | Yes, after the release works. |
| Persist the session drawdown peak; key risk rows by the real account id | Yes, as one reviewed requalification of the risk gateway. |
| No new learning or governance layers until one real fill-to-learning cycle exists | Yes. |

## 6. Not verified

Host state after 2026-10-28 13:26 UTC apart from the read-only diagnosis (running SHA `c59b522`, 84% disk, 64 MB free memory); whether fills resume once the current build is deployed;
the order-book study result (read date 2026-10-29 or later); device rendering of the mobile screens; whether the 84 unreached modules are loaded dynamically.
