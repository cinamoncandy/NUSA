# Alpha Lab: what "complete" means and how strategies get generated (ROADMAP PROPOSAL, 2026-11-26)

Korean summary (한 줄): 사장님이 "일단 알파랩 완성과 전략 생성을 목표로 한다"고 정했다(실거래는 그 다음). 이 문서는 **"알파랩 완성"의 기준안**, **전략을 체계적으로 만드는 방법**, 단계별 로드맵, 그리고 지금까지 없던 **프로그램 전체의 거짓 통과 예산**을 제안한다. 모두 제안이며 코드와 서버 변경은 없다.

Status: **PROPOSAL, docs only.** PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `realOrderAuthority=false`, `aiAuthority=ZERO_AUTHORITY`, FAIL_CLOSED. Owner decision 2026-11-26: "일단 알파랩 완성과 전략 생성을 목표로 한다" (live trading stays the later goal of `docs/ALPHA_LAB_TO_LIVE_DESIGN_2026-11-26.md`; the loss-limit proposal `docs/LIVE_CANARY_LOSS_LIMIT_PROPOSAL_2026-11-26.md` is parked until a candidate exists). Server-code PRs stay frozen until 2026-11-28 15:00 KST; no host release before the owner says so.

## 1. Proposed definition of "Alpha Lab complete" (each item has evidence and an independent review)
| # | Component | Done when |
|---|---|---|
| A1 | **Hypothesis registry** | every hypothesis (past and new) has an id, a frozen hash taken before data, a K count, a state and its verdicts; append-only; negative results are kept so nothing is retried unknowingly |
| A2 | **Screen runner** | one command runs the history screen with the fixed costs (15 bp per side daily, 10 bp 5-minute, stress doubled), Bonferroni with K, six-window rule, second filter and the survivorship and fill disclosures; outputs are hashed and reproducible by an independent run |
| A3 | **Forward registrar and evaluators** | hosted-runner workflows (dispatch-only, hash-pinned, no host, no release) that fetch with manifests, refuse to run before each registered look and read only candles up to that look: breadth filter, weekly trend, tradeflow v2 first |
| A4 | **Shadow ledger** (fold-in plan stage S4) | append-only, no order path, with the tests of the fold-in plan; the registry feeds it |
| A5 | **Lab tab** | the app lists registry states and the next dates from server facts only; "none yet" when empty |
| A6 | **Programme accounting** | a global false-pass budget (section 3) and a running count of tests, visible in the weekly report |
| A7 | **Weekly report** | automated (set 2026-11-26) |
| A8 | **Review and safety** | every stage independently reviewed; no gate, bar or threshold loosened; `aiAuthority=ZERO_AUTHORITY` |
"Strategy generation" is a separate deliverable, G1 to G5 below; Alpha Lab is complete when A1 to A8 hold, whether or not a strategy has passed; "complete" must never be reported as "strategy found", and the stop-rule question to the owner (design section 8) stays open.
Who reviews and merges the workflow and code PRs of A1 to A5: draft PR, non-author `/grill-me` review, merge only through the release path or by the owner (`AGENTS.md`); no AI merges or approves its own work.

## 2. Strategy generation: how candidates are produced without fooling ourselves
- **G1 Grammar enumeration.** A fixed rule grammar (feature x threshold x hold x universe) is declared with its **K fixed and hashed before any run**; the screen runner enumerates inside it. Only the survivors of the second filter reach forward registration.
- **G2 Desk method.** A proposer (the AI under ZERO_AUTHORITY, or the owner) writes hypotheses with reasons and bars into a pre-registration; code freezes the hash and runs it; a non-author reviews. The AI proposes only; it never runs a trade path.
- **G3 Transfer sieve.** One run on data **not yet read** (a never-read venue, or forward data), as for the breadth filter, which missed two bars narrowly; it counts toward K; a miss is reported, not retuned. Historical KRW daily data has already been read, so re-running it is not blind.
- **G4 Cost-first design.** Prefer low turnover and limit-order rules (the cost wall: fee 0.05 percent per side plus spread); a maker-fill model is measured in shadow, not assumed.
- **G5 Overlays and combinations.** The defensive breadth overlay plus a trend or reversion rule, pre-registered as one combined candidate whose K **includes the K of its component screens**; a combination of two passed pieces is a new hypothesis with a new hash, never a post-hoc join.
Sources of new information (not just new rules on old charts): the tradeflow and order-book forward collections (third run 2026-12-10), futures data, other venues; each only inside the blind rules already registered.

## 3. A programme-level false-pass budget (new; owner decision needed)
Today each study uses its own alpha and there is **no family-wise control across studies** (the weekly-trend registration notes about a 37 percent chance of at least one false PASS among nine independent tests). Proposal: set one **programme alpha of 0.05 per calendar year**, spend it explicitly, and require any new forward registration from now on to state what it spends. Nothing is allocated yet: the weekly trend's registration already uses 0.05 (split 0.01 + 0.04 inside it), and the breadth filter has no formal alpha of its own (its seven conditions are not significance tests; the placebo bar is 9,500 of 10,000), so the existing studies are **not retroactively charged and their bars stand**. The budget limits new registrations and makes the accounting visible. It is an owner decision and is not adopted until the owner decides; this roadmap does not decide who proposes hypotheses first.

## 4. Roadmap (proposed order; dates are KST)
| When | Work | Notes |
|---|---|---|
| now to 2026-11-28 15:00 | docs only: this roadmap, review of Codex's branch when published | server-code PRs frozen |
| 11-28 to 12-06 | A3 first (breadth filter fetch and evaluate workflows: first held day 2026-12-06), A1 registry schema | workflows run on hosted runners |
| 12-06 to 12-20 | (terms: "research S2 to S5" are registered studies; "fold-in stages S1 to S6" are the fold-in plan) A3 for the weekly trend (first decision 2026-12-07), A2 screen runner (from the offline scripts), tradeflow v2 (11-29), research studies S2 to S4 (12-05) and S5 (12-20), RET48 results | order-book blind until 2026-12-10 |
| 12-20 to 2027-01-31 | A4 shadow ledger and fold-in plan stages S1 to S3 (CORE), A5 Lab tab, first G1 enumeration round with a declared K budget | host release only when the owner says so |
| 2027-01 to 03 | breadth looks L30 (2027-01-05), L60 (02-04), L90 (03-07); weekly trend L13 (03-08); G2/G3 rounds | |
| 2027-06-07 | the confirming looks (breadth L183, weekly L26); the stop-rule question to the owner if nothing passed | |
This is an order of work, not a promise of results.

## 5. What is not decided here
The programme alpha, the K budget per round, who proposes hypotheses first, and whether G5 combinations are worth their K. The loss limits and capital wait for a candidate.

## 6. Not done here
No code, workflow, run, release, gate or policy value.

## 7. Update after the Alpha Lab 2 design (proposal; owner direction 2026-11-26, "Track R first, small farm second")
See `docs/ALPHA_LAB_2_SMALL_FARM_AND_TRACK_R_DESIGN_2026-11-26.md`. Changes to the table above, all proposals:
- **A3** now means: breadth fetch and evaluate workflows (Track R, no new bar) plus a farm **signal recorder** that computes no performance statistic before a registered look. No farm cohort is registered before F1 (calibration and power check) passes and the owner accepts the go/no-go on the detectable effect.
- **A4 and A5** are unchanged; a farm PASS only becomes a PAPER-only shadow candidate and still needs a single-rule confirmation on unseen data.
- **A6** carries the programme alpha (assumed 0.05 per year, at most 4 cohorts) once the owner adopts it; the design assumes it so work can proceed, and an owner change is applied by amendment.
- Owner delegation 2026-11-26: for decisions the owner would otherwise make, the AI proceeds on its own recommendation and the owner may amend afterwards. This never covers Stage B, risk limits, capital, live authority, host releases or release-control merges.
