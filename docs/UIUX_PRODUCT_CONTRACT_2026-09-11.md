# NUSA Product UX Contract — 2026-09-12

Status: `CANONICAL_CONTRACT_OWNER / DRAFT_HOLD`  
Owner: UI/UX  
Scope: Mobile + Desktop presentation only

## Product definition

NUSA is an AI trading intelligence system, not a generic brokerage dashboard. The interface is an observable decision system: it shows what NUSA can truthfully conclude, the evidence and uncertainty behind that conclusion, the operational state that makes the conclusion trustworthy or unavailable, and the smallest safe human action.

Canonical product loop:

`OBSERVE -> REASON -> DECIDE -> VALIDATE -> LEARN`

This is an information architecture, not a claim that the runtime exposes five live execution stages. The UI MUST NOT animate or label internal progress unless an authoritative runtime state explicitly exposes that progress.

## Non-negotiable authority truth

- `PAPER_ONLY`
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `aiAuthority=ZERO_AUTHORITY`

AI judgement is read-only decision support. A directional judgement must always retain the visible meaning `AI 판단 · 실행 권한 없음`.

## Canonical judgment source

`packages/contracts/src/aiTradingJudgment.ts` is the authoritative rendering contract for an integrated AI trading judgement. A valid `AiTradingJudgment` contains:

- `judgmentId`, `strategyId`, `market`, `generatedAt`
- `thesis`
- evidence AND counter-evidence
- epistemic status per evidence item: `KNOWN | UNKNOWN | ESTIMATE | ASSUMPTION | RISK | INVALIDATION`
- calibrated `confidence`
- separate `uncertainty` — never render it as `1-confidence`
- `marketRegime`
- normalized scenarios with probability, expected return and narrative
- expected return and downside
- risk budget
- time horizon
- explicit invalidation condition
- action: `LONG | SHORT | EXIT | HOLD | ABSTAIN`

The UI does not invent any of these values. Invalid or absent judgement data renders `UNAVAILABLE`.

`AiReadOnlyProjection` remains a secondary diagnostic/trust source for calibration diagnostics, critic severity, disagreements, explanation verdict, scenario robustness, learning provenance and ZERO_AUTHORITY truth. It must not override a canonical `AiTradingJudgment` with an inferred recommendation.

## Runtime delivery boundary

The existence of `AiTradingJudgment` as a contract does not itself prove that the active mobile runtime currently delivers a fresh judgement object to a screen. Product UI may present a judgement as current only when the implementation has an authoritative runtime delivery path and freshness semantics. Otherwise render the judgment surface as `UNAVAILABLE` rather than using fixture/demo values.

## PAPER boundary

The current production mobile PAPER route is supervision/learning only. It intentionally does not expose manual BUY/SELL, quantity, price or submit controls.

Therefore:

- no manual order ticket is introduced by this contract;
- a judgement may link to PAPER evidence/supervision only when the runtime provides a truthful relationship;
- scenarios in `AiTradingJudgment` are explanation/scenario evidence, not an execution simulator;
- any future user-triggered PAPER mutation requires a separate canonical product/authority decision.

## Information priority

Primary surfaces use this order:

1. current judgement or truthful absence of judgement;
2. system/data/PAPER/risk operational truth;
3. evidence, counter-evidence, uncertainty, scenarios and invalidation;
4. safe human action;
5. portfolio/market/detail/diagnostics.

Developer diagnostics and raw prices never compete with the first viewport unless they are the active blocker.

## Mobile IA

Five primary destinations maximum:

- `NUSA` — current judgement + operational truth + attention/action;
- `판단` — full canonical judgement and trust detail;
- `시장` — public read-only market observation used as context;
- `PAPER` — supervision/learning/validation evidence;
- `자산` — PAPER portfolio/result plus strict REAL_READ_ONLY separation.

Internal route IDs may remain compatible during migration. The visible end-state label is `판단`, not generic `AI`, because AI is the intelligence layer across the product.

## Home first viewport

Home answers without navigation:

1. Is a validated/current judgement available?
2. What is the action/posture and thesis, if available?
3. How confident and uncertain is it?
4. What operational state can invalidate trust in it?
5. Does the human need to do anything?

Priority composition:

- compact authority/truth rail;
- one dominant judgement/runtime canvas;
- confidence + uncertainty pair;
- evidence/counter-evidence tension summary;
- invalidation/risk summary;
- one safe action or `no action required`;
- portfolio/result only below the judgement hierarchy.

Do not lead with giant capital, a watchlist, raw chart tiles, news, decorative AI sphere, globe, orbit, scan field or synthetic progress animation.

## What Changed

`homeStatusRail.changesSupported === false` means the active Home status source does not support a truthful snapshot-history delta. Do not fabricate a `What Changed` feed from that source.

A new canonical judgement may visually transition when its authoritative `judgmentId`/`generatedAt` changes, but this is not a substitute for a persisted decision-history ledger.

## Runtime Canvas

The visual differentiator is an observable AI runtime canvas, not a conventional finance dashboard.

The canvas is backed only by real state:

- JUDGEMENT: `action`, `thesis`, `market`, `marketRegime`;
- EVIDENCE: actual evidence items and epistemic statuses;
- COUNTER: actual counter-evidence items;
- UNCERTAINTY: canonical uncertainty;
- SCENARIOS: canonical scenario set;
- RISK: downside, risk budget, invalidation;
- TRUST: calibration/critic/disagreement details only when provided;
- AUTHORITY: PAPER ONLY / LIVE NONE / AI ZERO AUTHORITY.

### Motion semantics

Motion is telemetry, never theatre.

Allowed:

- subtle opacity/position transition when a new canonical snapshot arrives;
- brief emphasis on the exact field whose authoritative value changed;
- calm pulse for an explicitly provided RUNNING/LOADING state;
- STOP at the exact BLOCKED/STALE/ERROR node when that state is authoritative;
- reduced-motion fallback to instant state change.

Forbidden:

- pretending OBSERVE/REASON/VERIFY/DECIDE are live sequential stages without runtime stage evidence;
- perpetual orbit/particle/scan motion implying intelligence activity;
- random data pulses;
- fake percentages, source counts or progress;
- motion that makes UNKNOWN look healthy.

When no stage telemetry exists, the runtime canvas displays a snapshot topology, not a progress tracker.

## State semantics

Data-backed modules distinguish:

`LOADING | READY | STALE | EMPTY | DEGRADED | BLOCKED | ERROR | UNKNOWN | UNAVAILABLE`

Autopilot semantic target remains:

`NO_WORK | READY | CLAIMED | RUNNING | VALIDATING | BLOCKED | HUMAN_ONLY | FAILED | STARVATION | DONE`

Autopilot states appear only when an authoritative product projection exists. Observation failure is never `0` or `NO_WORK`.

## Dark Glass implementation contract

Visual direction: premium dark + restrained glassmorphism, non-neon.

Current mobile dependencies are React Native + safe-area + AsyncStorage; there is no approved blur package. Therefore the first implementation MUST be achievable without adding a dependency:

- near-black/graphite base;
- translucent RGBA surfaces;
- subtle tonal depth and thin low-contrast boundaries;
- max two competing surface elevations per viewport;
- high-contrast text and quiet secondary typography;
- one low-saturation intelligence accent;
- green/red/amber reserved for semantics;
- tabular financial numerals;
- no glow shadow as a primary hierarchy device.

A future true backdrop blur requires a separate dependency/compatibility decision. The approved mockup must not rely on effects unavailable in the current RN stack.

## Market

Market remains public read-only observation. Price/chart/watchlist are useful evidence context but do not create strategy authority. STALE/ERROR state is rendered directly on the affected data surface.

## PAPER

PAPER is supervision/learning. It answers:

- is PAPER operating/observable;
- what learning/validation evidence exists;
- what completed/failed/blocked evidence exists when projected;
- what the user may safely inspect next.

No production order ticket is implied.

## Assets

PAPER capital/result and REAL_READ_ONLY balances remain separate. Never sum them. Missing values are `—/UNAVAILABLE`, not zero.

## Responsive and accessibility

- 360px: single column, no clipped authority/state labels;
- 390px: canonical mobile composition;
- 430px: more spacing, not more card count;
- >=768px: two-column detail only when scan order remains obvious;
- touch target >=48px where practical;
- state meaning is never color-only;
- dynamic text must not hide risk/authority;
- reduced-motion honored.

## Drift findings

Current active implementation still has debt against this contract:

1. visible primary nav uses `AI` rather than `판단`;
2. the design system retains neon token/API vocabulary;
3. existing Home hierarchy has historical decorative-intelligence/capital-first influence;
4. desktop architecture documents universal capital-first dominance;
5. active `AiView` primarily consumes `AiReadOnlyProjection`; the integrated `AiTradingJudgment` delivery/rendering path must be proven before the new judgement canvas is activated;
6. Home history remains unsupported by its current status source;
7. production PAPER is supervision/learning and must stay so.

## Implementation sequence

P0 — truth wiring

- prove canonical `AiTradingJudgment` runtime delivery path or keep judgement unavailable;
- define freshness semantics;
- unify READY/STALE/ERROR/UNKNOWN/UNAVAILABLE presentation;
- preserve authority truth.

P1 — runtime canvas + IA

- implement Judgment Object / Runtime Canvas from canonical fields;
- visible `AI` -> `판단` label migration with route compatibility;
- evidence/counter-evidence/scenarios/invalidation progressive disclosure;
- no synthetic live-stage progression.

P2 — Dark Glass

- semantic translucent surface tokens;
- remove active neon/glow/decorative-motion usage;
- responsive typography/spacing/chart cleanup.

P3 — parity

- approved 390px implementation-ready visual contract;
- 360/390/430 device screenshots;
- screenshot parity review;
- accessibility and reduced-motion checks;
- doc/code drift guards.

## Acceptance

A UI change is not complete because CI is green. Completion requires:

- correct authority semantics;
- no fabricated evidence/state/progress;
- critical task scan order meets the hierarchy above;
- no clipping at 360/390/430;
- accessibility acceptance;
- real device screenshot parity with the approved implementation-ready mockup;
- fresh exact-head CI/safety evidence under repository governance.

## Core ownership disposition

Core has fixed PR #1850 as the canonical UI/UX product-contract/governance owner. PRs #1838 and #1849 are implementation inputs/HOLD, not independent merge candidates. After this contract stabilizes, implementation must be routed through one clean reconciliation work item. Global Release freeze / #1803 remains independently blocking.
