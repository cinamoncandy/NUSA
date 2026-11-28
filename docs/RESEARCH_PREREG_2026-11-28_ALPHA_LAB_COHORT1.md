# Alpha Lab cohort 1: pre-registration of three cross-section hypotheses (2026-11-28)

Korean summary (한 줄): 알파랩 첫 가설 3개(저변동성 20일 보유, 28일 반전 20일 보유, 1일 반전 5일 보유)를 **결과를 보기 전에** 고정한다. 기록은 2026-12-06 종가부터 매일 쌓이고, 언제 봐도 되는 검정(e-값)이 80 이상이 되면 통과(그림자 후보)다. 통과는 실거래도 PAPER 주문도 아니다.

Status: **REGISTERED on merge** (binding once merged; nothing evaluated before 2026-12-06). Owner direction 2026-11-28 ("해": start Alpha Lab registration now). PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

## 1. Frozen definitions
- Code: `scripts/alpha-lab/cohort1.js`, sha256 `28eb2a8468d3ee3ec4d071a338da0ab70ce9aca06cb9a72b19d393b4b244e9b2` at registration. Any later change to a rule, number or the universe needs a new registration; bug fixes that change no recorded row are allowed only with an independent review and are disclosed here.
- Universe: the 56 markets of `docs/research-data/broad-universe-filter-count-20bp-2026-11-24.json` (discoveryPool + forwardPool + KRW-BTC; file sha256 checked by the script). A day needs at least 20 markets with full lookback and the next close.
- Holdings: at the close of a rebalance day, the top third (rounded) by signal, equal weight; held for the stated hold; excess = held return minus the equal basket of the same eligible markets, close to close; cost 15 bp per side on turnover.
- Test: the e-process of `docs/ALPHA_LAB_V3_CROSS_SECTION_EVALUE_DESIGN_2026-11-27.md` (section 7): clip at 4 sd of past net excess, 20-day burn-in, average of the fixed lambda grid {0.02, 0.05, 0.1, 0.2, 0.35, 0.5} and the predictable adaptive bet (cap 0.5), each weighted 0.5. **Alpha 0.0125 per hypothesis**, threshold e >= 80; three hypotheses spend 0.0375 of the assumed programme alpha 0.05 for the year (owner may amend the programme alpha).

| Id | Signal (higher = wanted) | Hold | Source and prior |
|---|---|---|---|
| C1_LOWVOL20_H20 | minus the sample sd of the last 20 daily log returns | 20 days | low-volatility family (docs/RESEARCH_STRATEGY_COLLECTION_2026-11-25.md §2 row 3); historical IC rose with horizon to 0.095 at 20 days (docs/ALPHA_LAB_IC_DECAY_RESULT_2026-11-28.md) |
| C1_REV28_H20 | minus the 28-day return (long-term reversal) | 20 days | the IC measurement showed 28-day momentum with a NEGATIVE IC at every horizon (-0.036 at 20 days), so the registered direction is reversal |
| C1_STR1_H5 | minus the 1-day return (short-term reversal) | 5 days | short-term reversal (collection §2 row 1); historical IC peaked at 5 days (0.031) and vanished by 20 |

## 2. Blind rules
- The first signal day is the close of **2026-12-06** UTC; the first recorded return is 2026-12-06 to 2026-12-07. Lookback reads closes before 2026-12-06, which were S2-S4 holdout prices until their evaluation on 2026-12-05; no record runs before 2026-12-07.
- The historical IC (already-read history to 2026-11-04, survivor-biased, no costs) chose the directions and holds; it is not evidence. Only forward rows count.
- Rows are hash-chained and append-only; the recorder refuses to rewrite a past row.

## 3. Outcomes
- **PASS** (e >= 80 on any day): the hypothesis becomes a PAPER-only **shadow candidate**; it then needs the PAPER admission path (fold-in plan S5) and the owner's Stage B before any order. It is never a live permission.
- **OPEN**: recording continues. Stop rule (proposal): after 365 recorded days without PASS the hypothesis is retired as NOT_PASSED (not "no effect").
- A NO_DATA day (fewer than 20 eligible markets, or a held market without a close) is recorded and skipped, never filled.

## 4. Recorder
`.github/workflows/research-alpha-lab-cohort1.yml`: daily on a GitHub-hosted runner (no secret, no host), writes the rows and `status.json` to the branch `alpha-lab-records` under `cohort1/`. It does nothing before 2026-12-07.

## 5. Not done here
No order, no host change, no gate, limit, capital or authority change. No result is claimed.
