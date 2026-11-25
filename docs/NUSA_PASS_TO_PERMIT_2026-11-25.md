# From a research PASS to a PERMIT: what a candidate must deliver before the producer can say PERMIT (2026-11-25, design)

Status: **DESIGN / records only. No code, no host action, no gate, threshold, limit, capital or authority change.** PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, orders OFF. Work order `WO-OPS-20261125-PASS-TO-PERMIT`.
Owner: "가장 중요한건 전략을 만들어서 실거래까지 가게 만드는거야", then "ek go" (read as "ok, go", 2026-11-25 KST). The owner's decision 2 of 2026-11-16 ("no producer is built before a candidate qualifies") is **not changed by this file**: it explains why, and what to prepare instead.

## 1. The gap in one paragraph
A pre-registered study ends in one verdict: a mean net excess over a benchmark, once, on a fixed span. The trade-permission engine (`apps/cloud/src/tradePermissionEngine.ts`) needs, **for every single order intent**, 14 inputs, among them a calibrated probability, a net expected value, a reward/risk ratio, a capacity, a slippage forecast and at least two model probabilities. **A study PASS supplies none of these per decision.** The bridge is the forward SHADOW stage of `docs/LIVE_READINESS_RUNBOOK.md` (step 2): it is where per-decision outcomes get labelled, which is the raw material of calibration, net EV and slippage evidence.

## 2. The route (each arrow is a separate decision and PR)
1. Pre-registered study PASS (a lead, never promotion).
2. Forward SHADOW test of the same rule on the governed decision path, every decision and its outcome logged with cost attribution.
3. From the labelled outcomes: calibration, net-EV model, capacity rule and slippage forecast, plus a second independent model (gate 11).
4. A reviewed policy file (the owner's decision 3: thresholds, regimes, minimum calibration samples) bound to the model version.
5. The producer (`docs/NUSA_PERMIT_PRODUCER_DESIGN_2026-11-16.md`, part 2 in draft #3179) writes a PERMIT or a REJECT with evidence into the durable store; the guard already on `main` reads it.
6. Stage B (orders ON) only with the owner's fresh written approval naming "Stage B"; then the rest of the live ladder (runbook steps 3 to 7) and a manual activation by the owner.

## 3. What each gate needs from a candidate (the design table, condensed)
| Gate | Comes from the candidate's evidence | Comes from the runtime |
|---|---|---|
| PROBABILITY, UNCERTAINTY | labelled outcomes of the candidate's own decisions (a sample bound to model, market and outcome definition) | - |
| EXPECTED_VALUE, REWARD_TO_RISK | a net-EV model on the same outcome definition and costs | - |
| CAPACITY, SLIPPAGE | a stated capacity rule and a slippage forecast (observed spread and slippage today are not a forecast) | order-book depth |
| MODEL_AGREEMENT | at least two independent models | - |
| REGIME_COMPATIBILITY, LIQUIDITY, DATA_QUALITY, FRESHNESS | the regime set the candidate was tested in | all eight market-state signals (three are futures signals that the spot runtime does not hold today) |
| RISK_BUDGET, KILL_SWITCH | - | canonical risk gate and runtime flag |
| GOVERNANCE | - | the governance source (open item after the Cloudflare removal) |
If any input is missing the producer must reject; no gate may be relaxed.

## 4. The honest time cost, by how often a candidate trades
The minimum number of calibration samples is a field of the reviewed policy file (the owner's decision 3), not a constant. For any value N, the time to reach N labelled outcomes is N divided by the trades per week of the candidate:
| Candidate | Trades per week | Weeks to 100 labelled outcomes |
|---|---|---|
| weekly trend (`docs/RESEARCH_THREE_DIRECTIONS_2026-11-25.md`, five picks) | 5 | about 20 (after the SHADOW start) |
| a daily rule with five picks | 35 | about 3 |
| an hourly rule | hundreds | days |
So the weekly candidate's study runs until 2027-06-07 and calibration would start only afterwards. **No live date follows from this file; it shows that the speed of the whole route is set by how many decisions a candidate makes and by when one passes.** The cost wall is the reason frequent candidates have not passed so far.

## 5. What can be prepared now without waste, and what must wait
- **Can be prepared (docs or tests only, each its own PR):** the shadow outcome ledger schema (one row per decision and per outcome, with cost fields), the policy file template with every threshold left for the owner, the evidence checklist of section 3 as a test fixture for the future producer.
- **Must wait for a candidate:** the producer code, the calibration and net-EV models, the second model, any wiring in the runtime.
- **Owner only, unchanged:** Stage B approval, risk limits, capital, live activation, the policy thresholds.

## 6. Not done here
Any code or runtime wiring, a release, a policy value, a store creation, a change of decision 2, a claim about when live trading could start.
