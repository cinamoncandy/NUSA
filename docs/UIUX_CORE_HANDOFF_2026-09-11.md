# NUSA UI/UX -> Core Handoff — 2026-09-11

## 현재 UX 판정

`REDESIGN_REQUIRED` — authority safety is comparatively strong, but product hierarchy, cross-platform IA, and visual language do not yet match the intended AI trading intelligence experience.

## 가장 큰 UX 문제

The mobile first viewport spends too much visual weight on decorative intelligence presentation and capital. The current product requirement is to prioritize current judgement, system/data/PAPER/strategy/risk/Autopilot truth, change, blocker, and safe next action.

## 사용자 영향

- Slow recognition of what NUSA currently thinks and why.
- Repeated navigation is required to reconstruct operational truth.
- Decorative AI presentation can look more authoritative than its evidence warrants.
- Cross-platform hierarchy differs between mobile and desktop.
- Existing neon-oriented token/API vocabulary can pull future implementation away from the approved dark-glass direction.

## 개선 완료

- Canonical cross-platform information priority specified.
- Five-destination mobile IA target specified.
- Decision Object contract specified.
- Autopilot states and ambiguous-zero prevention specified.
- loading/ready/stale/empty/degraded/blocked/error/unknown semantics specified.
- Dark Glass visual constraints specified.
- 360/390/430 responsive acceptance specified.
- implementation sequence and measurable UX acceptance specified.

## 개선 후보

P0
- replace decorative Home hero with Decision Object + global truth rail
- unify non-ready state language and recovery actions
- surface current blocker/human action without extra navigation

P1
- visible `AI` -> `판단` IA migration with route compatibility
- Decision history/change explanation
- Decision -> PAPER simulation continuity

P2
- semantic glass tokens/components
- retire active neon/orbit/particle/scan presentation
- chart/table/KPI hierarchy cleanup

P3
- mockup-to-device screenshot parity
- documentation/implementation drift guards
- active renderer load/import guards

## 개발 필요 항목

UI-only implementation after Core approval:
- mobile navigation visible-label/IA migration
- mobile Home composition
- Decision Object primitives
- Dark Glass token migration
- state-semantic primitives and tests

Cross-module integration needed:
- authoritative strategy state projection
- authoritative Autopilot status projection
- last-success/last-healthy timestamps
- blocker/human-action reason projection
- validated portfolio-impact projection for decision simulation

## 데이터/관측 필요 항목

UI must consume, not infer:
- data freshness / last observed time
- strategy runtime state
- Autopilot queue/claim/run/validate/block/failure evidence
- calibrated confidence provenance
- invalidation/risk evidence
- last successful meaningful action

No evidence -> `UNKNOWN/UNAVAILABLE`, never optimistic substitution.

## 충돌 여부

Yes.

1. Desktop canonical doc currently establishes universal capital-first dominance; new AI-trading hierarchy requires judgement/system truth to win when material.
2. Mobile active implementation contains decorative `IntelligenceMotionField` and neon token/component vocabulary; approved visual direction rejects these patterns.
3. Open PR #1838 is technically validated but represents an intermediate IA/hierarchy. Do not merge solely because CI is green; reconcile it with this contract first.

## 검증 결과

Repository audit confirmed:
- main mobile navigation exposes five primary destinations including `AI`.
- mobile Home contains `LIVE INTELLIGENCE`, `IntelligenceMotionField`, and a dedicated capital rail.
- mobile design system contains neon tokens and `NusaCard(neon)` behavior.
- desktop canonical architecture declares capital as the largest object.
- existing AI view already carries useful evidence/counter-evidence, calibration, uncertainty, authority and learning information that can be reorganized instead of duplicated.

## Core 판단 필요 사항

- Approve target IA and `AI` -> `판단` visible migration.
- Approve judgement/system truth as cross-platform priority over universal capital-first hierarchy.
- Approve Dark Glass / non-neon direction.
- Decide Autopilot exposure boundary on mobile.
- Decide whether PR #1838 is rebased/reworked into the new contract or superseded.

## UI/UX merge policy

UI/UX will not merge broad product changes or alter trading/backend authority. After Core approval, implementation should land in small reviewable slices with exact screenshot + state-semantic acceptance.
