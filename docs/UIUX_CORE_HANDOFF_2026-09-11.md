# NUSA UI/UX -> Core Handoff — 2026-09-11

## 현재 UX 판정

`REDESIGN_REQUIRED` — authority safety is comparatively strong, but product hierarchy, cross-platform IA, and visual language do not yet match the intended AI trading intelligence experience.

## 가장 큰 UX 문제

Mobile first-viewport hierarchy overweights decorative intelligence presentation and capital. NUSA needs current judgement/observation, system/data/PAPER/strategy/risk truth, blocker and safe next action first — without presenting capabilities the runtime does not actually expose.

## 사용자 영향

- NUSA의 현재 판단과 근거를 이해하는 시간이 길다.
- 운영 상태를 재구성하려면 화면 이동이 필요하다.
- 장식적 AI 표현이 실제 evidence보다 더 강한 권한/확신처럼 보일 수 있다.
- mobile/desktop 정보 계층이 다르다.
- neon 중심 token/API vocabulary가 승인된 Dark Glass 방향과 충돌한다.
- UX가 aspirational capability를 실제 capability처럼 설계할 위험이 확인됐다.

## 개선 완료

- cross-platform information priority 정의
- mobile 5-destination target IA 정의
- evidence-first Decision/Observation Object 정의
- Autopilot semantic state target 정의
- loading/ready/stale/empty/degraded/blocked/error/unknown 구분
- Dark Glass/non-neon constraints 정의
- 360/390/430 responsive acceptance 정의
- current runtime capability 재감사 및 contract 교정

## 개선 후보

P0
- decorative Home hero 제거/축소
- Decision/Observation + global truth rail 우선
- non-ready state 언어/복구 행동 통일
- UNKNOWN을 정상/0으로 치환하는 경로 차단

P1
- visible `AI` -> `판단` migration with route compatibility
- 현재 존재하는 AI evidence/counter-evidence/calibration/uncertainty 재구성
- PAPER supervision/learning으로의 진입은 실제 runtime linkage가 있을 때만 제공

P2
- semantic glass tokens/components
- active neon/orbit/particle/scan presentation 제거
- chart/table/KPI hierarchy cleanup

P3
- mockup-to-device screenshot parity
- documentation/implementation drift guards
- active renderer load/import guards

## 개발 필요 항목

UI-only after Core approval:
- navigation visible-label migration
- mobile Home composition
- Decision/Observation primitives
- Dark Glass token migration
- semantic state primitives/tests

Cross-module projection work requires canonical owner decision:
- strategy state projection
- Autopilot queue/claim/run/validate/block/failure projection
- last-success / last-healthy timestamps
- blocker / human-action reason projection
- decision history/change projection
- stance/invalidation projection if product requires them
- validated portfolio-impact/scenario projection if product requires simulation

## 데이터/관측 필요 항목

UI consumes; it does not infer:
- data freshness / observed time
- strategy runtime state
- Autopilot evidence
- calibrated confidence provenance
- risk/invalidation evidence
- last successful meaningful action
- decision-history delta

No evidence -> `UNKNOWN/UNAVAILABLE`.

## 충돌 여부

Yes.

1. Desktop canonical architecture says capital truth is universally dominant; proposed AI-trading hierarchy makes judgement/system truth dominant when material.
2. Mobile active implementation contains `IntelligenceMotionField` and neon vocabulary; approved direction is non-neon Dark Glass.
3. PR #1838 is green but represents an intermediate hierarchy/IA and is now draft; do not merge from CI alone.
4. Current production mobile PAPER route is deliberately supervision/learning only. It exposes no manual BUY/SELL/price/quantity/submit controls. A UI contract requiring “confirm PAPER action” would exceed current capability.
5. `homeStatusRail` explicitly reports `changesSupported: false`; the UI cannot truthfully show “what changed” until history evidence exists.
6. `AiReadOnlyProjection` provides thesis/evidence/counter-evidence/uncertainty/calibration/scenario robustness, but not canonical stance, invalidation, portfolio impact or decision history.

## 검증 결과

Repository audit confirmed:
- main mobile navigation has five primary destinations including visible `AI`.
- Home still renders `LIVE INTELLIGENCE`, `IntelligenceMotionField`, and a large capital rail.
- mobile design system exposes neon tokens and `NusaCard(neon)` behavior.
- existing AI view already contains strong evidence, calibration, uncertainty, scenario robustness and ZERO_AUTHORITY truth.
- market surface correctly separates public read-only observations from PAPER authority.
- portfolio surface explicitly separates PAPER capital from REAL_READ_ONLY balances.
- production PAPER surface is a supervision/learning surface, not an order ticket.
- current branch PR #1850 is docs-only/draft; all workflows on its prior head completed successfully, but Core review remains required.

## Core 판단 필요 사항

- Approve target IA and visible `AI` -> `판단` migration.
- Approve judgement/system truth priority over universal capital-first hierarchy.
- Approve Dark Glass / non-neon direction.
- Decide Autopilot exposure boundary on mobile.
- Decide canonical ownership for missing decision-history/stance/invalidation/portfolio-impact projections.
- Decide whether #1838 is reworked or superseded.
- Keep PAPER supervision boundary unless a separate canonical product/authority decision changes it.

## UI/UX merge policy

UI/UX will not merge broad product changes or alter trading/backend authority. After Core approval, implementation lands in small reviewable slices with exact state-semantic and device screenshot acceptance.
