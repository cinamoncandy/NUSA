# 모바일·비주얼 이슈 통합 분석 (2026-09-03)

대상: #210, #349, #536, #558, #594. `authority_impact: none` 문서 분석.
병합이 아닌 역할 정리 제안 — 실제 close/병합은 OWNER 판단.

## 겹침 지도

| 이슈 | 실제 범위 | 성격 |
|---|---|---|
| #536 MASTER VISUAL REFERENCE | 화면 6종(HOME/AI SIGNAL/MARKETS/PAPER/ORDER/PORTFOLIO) + 공용 토큰·프리미티브 + 순차 시퀀싱 | **마스터 계약서** (유일하게 전체 화면·토큰·순서 정의) |
| #594 HOME MASTER parity | HOME 한 화면을 승인 목업(dense 터미널) family로 + 물리 Galaxy 스크린샷 게이트 | #536 시퀀싱 2단계(HOME)의 **수용 게이트** |
| #210 UIUX-002 premium experience | 토큰·Home·Markets·Chart·하단내비 terrain/signal 비주얼 (PR #532 MERGED済) | 상당 부분 구현済. 남은 것은 #536 family 판정으로 이관 가능 |
| #349 Real-Use Completion | 기능 온보딩·태블릿 UX·최종 리디자인 | 온보딩+태블릿만 남기고 비주얼 부분은 #536에 종속 |
| #558 Android Preview Deployment Receipts | APK 아티팩트 영수증 (버전·SHA·source_sha) | 디자인 이슈가 아님. 릴리즈 파이프라인 증거물 — 분리 유지 |

## 제안

1. **#536을 마스터로 유지.** 화면별 수용 기준·순서(HOME→AI SIGNAL→MARKETS→PAPER→ORDER→PORTFOLIO)는 #536만 따른다.
2. **#594는 #536의 HOME 게이트로 격하.** 별도 P0가 아니라 "HOME 단계의 물리 스크린샷 승인" 체크리스트로 둔다.
3. **#210은 구현 완료분(#532) 제외하고 잔여만 #536으로 이관 후 close.** 중복 추적 중단.
4. **#349는 비-HUMAN 부분을 분리.** 온보딩·태블릿 반응형만 남기고, 비주얼은 #536, 물리 검수는 HUMAN_ENVIRONMENT_ONLY로 표기.
5. **#558은 릴리즈 영역으로 이동.** UI 라벨 제거, Android stable-release 파이프라인의 증거 이슈로 재분류.

## 즉시 절감

- P0 3개(#594·#536 중복, #558 오분류) → P0 1개(#536) + 게이트 1개(#594) + 파이프라인 1개(#558).
- 화면당 "MASTER family인가?" 1문장 판정으로 시각 논쟁 종료 (#536 screenshot gate).
- 물리 Galaxy 검수는 어느 쪽도 CI를 막지 않는다 (HUMAN_ENVIRONMENT_ONLY).

## 안전 경계 (공통, 변경 없음)

PAPER only, 데이터捏造 금지, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`,
Cloud/LOCAL PAPER 혼합 표시 금지. 모든 시각 작업은 이 경계 안에서만.
