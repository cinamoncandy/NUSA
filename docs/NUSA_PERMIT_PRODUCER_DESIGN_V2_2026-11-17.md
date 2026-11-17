# Permit producer design, second part: facts from main, open items filled, build order

Date: 2026-11-17. Status: DESIGN for owner decisions, not an approval. Adds to `docs/NUSA_PERMIT_PRODUCER_DESIGN_2026-11-16.md`; nothing here changes code, the host or the order switch.
Safety unchanged: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, Release=HOLD. Owner decision 2 of 2026-11-16 stands: no producer is BUILT before a candidate qualifies. This document designs; it does not start building.

## 1. Facts read from main on 2026-11-17

- The boundary reads permits only through `PaperTradePermissionAuthority` (`apps/cloud/src/paperTradePermissionGuard.ts`): `policy`, `probabilityModelVersion`, and three SYNCHRONOUS calls `latestPermit`, `evidenceExists`, `isLatest`; a throw means "not verifiable". Production supplies `NO_PAPER_TRADE_PERMISSION_AUTHORITY` (never a permit). A synchronous read fits a read-only SQLite connection.
- The boundary recomputes the permit from `input` with the canonical engine and the authority's policy and refuses anything that differs. A producer therefore cannot make a weak input look strong: it can only supply honest inputs.
- The eight market-state signals (`RETURN_5M`, `REALIZED_VOLATILITY`, `SPREAD_BPS`, `ORDER_BOOK_IMBALANCE`, `DEPTH_USD`, `FUNDING_RATE`, `OPEN_INTEREST_CHANGE`, `LIQUIDATION_INTENSITY`) appear in `apps/cloud/src/marketStateEngine.ts` only (outside tests). NO component of the runtime produces any of them today, and the last three are futures-market signals. Gate 3 (regime) therefore has no data source at all. Not claimed: that the host holds futures data usable here (an inventory question, section 4).

## 2. Process and store layout

- Producer: its own process (a separate service or a one-shot job), the only writer of the permit store. It imports neither the boundary nor the runtime's order path; a source test pins both directions.
- Store: one SQLite file separate from the PAPER ledger. Tables `trade_permission_records` (append-only: UPDATE and DELETE rejected by triggers) and `evidence_items` (content hash, kind, source, observed_at, linked decision id), as in the 2026-11-16 design section 3.
- Adapter: opens the file READ-ONLY, implements the three calls, throws on a missing, locked or corrupt file. `isLatest` is true only for the row with the highest `sequence` of the decision whose `permit_sha256` matches; a newer REJECT supersedes an older PERMIT.
- Crash safety: a record and its evidence rows are written in one transaction; a producer crash leaves no partial permit. A restart never re-validates an old permit under a changed policy or model version.

## 3. Gate inputs: honest minimum

| Gates | What a producer may use now | What is missing |
| --- | --- | --- |
| 1, 2 (data quality, freshness) | completeness and age of its own inputs; `sourceGeneratedAt` = the OLDEST input used | the definition of "completeness" per signal (policy file) |
| 3 (regime) | nothing | a signal source (see D5) |
| 4, 10 (probability, uncertainty) | `probabilityEngine` | labelled outcome samples bound to model, market and outcome definition |
| 5, 6, 8, 9 (EV, reward/risk, capacity, slippage) | observed quotes and depth as evidence | a versioned, evidence-backed estimator written BEFORE the order (observed cost is not a forecast) |
| 7 (liquidity) | order-book depth in the spot runtime | the signal feed |
| 11 (model agreement) | one model today | a second independent model |
| 12, 13 (risk budget, kill switch) | read-only snapshots at decision time | none |
| 14 (governance) | nothing | section 5 |

Rule that never changes: a missing input rejects. No default, no relaxation of a gate to obtain a PERMIT.

## 4. Inventory before any build (read-only, owner-visible)

One read-only script lists: models and versions, labelled samples per model, market and outcome definition, whether any futures signals exist on the host, and the research candidates and their last verdicts. It writes nothing. Its output decides whether the first honest producer would reject every intent (the expected result today) and which of D5 and D6 is needed.

## 5. Governance (owner decision 3 specifics) with a recommended default

| # | Question | Recommended default |
| --- | --- | --- |
| D3a | Who is the approving identity? | The repository owner account, recorded as a reviewed file path protected by the release gate (a file alone grants nothing; the identity is the commit author checked by the gate). |
| D3b | Revocation, and how fast the producer sees it | The producer reads the governance file at decision time; a missing, unreadable or older-than-60-second read means NOT approved; the owner revokes by merging a change that removes the approval. |
| D3c | Retirement of a policy or model version | A reviewed list of retired versions in the policy file; a permit under a retired version never validates. |

## 6. New open decisions

| # | Decision | Recommendation |
| --- | --- | --- |
| D5 | Regime without futures signals: define a spot-only market state under a NEW policy version, or feed the futures signals? | Spot-only variant under a new version, so no futures dependency enters the PAPER spot path; the three futures signals stay out of scope. |
| D6 | Where does the second independent model come from? | Decide after the inventory; until then gate 11 rejects. |

## 7. Build order (each step a draft PR with an independent review; none starts before decision 2 is met)

(a) store, adapter and the first real caller together (the reachability gate refuses an unwired module); (b) the producer for the gates that have honest data, rejecting the rest; (c) a release that wires the adapter with orders OFF so the rejections appear as evidence; (d) Stage B only with a fresh written owner approval that names Stage B.

Tests required in (a): append-only triggers, `isLatest` after a newer REJECT, evidence linkage, store failure gives UNVERIFIABLE, the boundary cannot import the writer, restart replay, crash in the middle of a write.

## 8. Not done

No code, no store, no host change, no release; orders stay OFF. This document is not an approval of Stage B.
