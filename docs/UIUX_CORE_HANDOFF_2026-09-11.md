# NUSA UI/UX -> Core Handoff — 2026-09-12

## 현재 UX 판정

`CONTRACT_STABILIZING / IMPLEMENTATION_HOLD`

Core has fixed PR #1850 as the canonical UI/UX product-contract/governance owner. #1838 and #1849 are noncanonical implementation inputs/HOLD. Broad active implementation waits for one clean reconciliation work item after this contract stabilizes.

## 가장 큰 UX 문제

The active product still reads too much like a conventional finance dashboard and does not yet make NUSA's actual AI judgment structure the primary interaction model. At the same time, motion must not imply internal progress the runtime does not expose.

## 사용자 영향

- AI 판단 구조보다 일반 금융 UI 패턴이 먼저 읽힌다.
- current judgment/trust/uncertainty requires too much reconstruction.
- neon/decorative vocabulary can make the system look theatrical rather than trustworthy.
- static screens do not communicate authoritative state transitions well, while fabricated process animation would be worse.

## 개선 완료

- canonical cross-platform UX hierarchy fixed in #1850;
- target mobile IA: `NUSA / 판단 / 시장 / PAPER / 자산`;
- Dark Glass/non-neon direction;
- 360/390/430 acceptance;
- explicit UNKNOWN/ERROR/EMPTY/NO_WORK distinction;
- PAPER supervision/learning boundary preserved;
- runtime-motion rule: observable snapshot/state change only;
- canonical `AiTradingJudgment` re-audited and bound to the UX contract;
- implementation-ready Runtime Canvas field/motion mapping added.

## 중요한 교정

Earlier UI/UX notes inspected only `AiReadOnlyProjection` and incorrectly concluded that canonical action/invalidation/scenario/risk fields were absent.

Repository truth: `packages/contracts/src/aiTradingJudgment.ts` already provides an authoritative integrated judgment contract with action, thesis, evidence/counter-evidence, confidence/uncertainty, market regime, scenarios, expected return/downside, risk budget, time horizon and invalidation condition.

UI must use that object when an authoritative current runtime delivery path is proven. `AiReadOnlyProjection` remains trust/diagnostic detail.

## 현재 실제 구현 경계

- active mobile nav still displays `AI` rather than `판단`;
- active `AiView` primarily consumes `AiReadOnlyProjection`;
- production PAPER is supervision/learning only;
- Home status source still declares `changesSupported: false`;
- mobile package has no backdrop-blur dependency;
- design system still contains neon token/API vocabulary;
- PAPER and REAL_READ_ONLY portfolio truth remain separate.

## 다음 구현 순서

P0 — prove/wire authoritative `AiTradingJudgment` runtime delivery + freshness; otherwise render UNAVAILABLE.

P1 — implement Runtime Canvas / Judgment Object and visible `AI` -> `판단` migration under one clean implementation owner.

P2 — implement native-RN Dark Glass tokens/surfaces, remove active neon/glow/decorative intelligence presentation.

P3 — actual device screenshot parity at 360/390/430, accessibility, reduced-motion and drift guards.

## Runtime Canvas rule

The runtime canvas may animate only:

- arrival/change of a canonical judgment snapshot;
- a field whose authoritative value changed;
- an explicit runtime LOADING/RUNNING/STALE/BLOCKED/ERROR state.

It must not animate fake OBSERVE->REASON->VERIFY->DECIDE progression, fake agents, fake source counts, fake ingestion, or perpetual intelligence effects.

## Core 판단 필요 사항

- confirm visible `AI` -> `판단` migration;
- confirm judgement/system truth over universal capital-first desktop hierarchy;
- confirm Dark Glass/non-neon direction;
- define mobile Autopilot exposure boundary;
- identify/prove the active runtime delivery owner for canonical `AiTradingJudgment`;
- retain #1850 as contract owner and create exactly one implementation reconciliation item after stabilization.

## 안전

`PAPER_ONLY`  
`liveAuthority=NONE`  
`productionMutationAllowed=false`  
`aiAuthority=ZERO_AUTHORITY`

No UI change may expand authority.
