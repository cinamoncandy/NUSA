# NUSA 사용자 화면 쉬운말 기준 — 2026-09-27

내부 enum/API/testID는 유지하고 실제 사용자 문구와 접근성 문구만 쉬운 한국어로 바꾼다. backend truth가 최우선이며 LOCAL_FALLBACK만으로 정상/실행 중을 표시하지 않는다.

| 기존/내부 표현 | 사용자 표시 |
|---|---|
| PAPER | 모의투자 |
| PAPER ACTIVE | 모의투자 실행 중 |
| NOT_CONFIGURED | 설정 필요 |
| UNAVAILABLE | 사용 불가 |
| DISCONNECTED | 연결 안 됨 |
| RECOVERING | 복구 중 |
| STALE | 최신 정보 아님 |
| LOCAL_FALLBACK | 기기 내 대체 데이터 |
| SERVER_STREAM | 서버 실시간 데이터 |
| READ ONLY | 보기 전용 |
| LIVE NONE | 실거래 권한 없음 |
| AI ZERO AUTHORITY | AI 실행 권한 없음 |
| EVIDENCE | 확인 기록 |
| RISK | 위험 |
| EQUITY | 평가 자산 |
| REALIZED PNL | 확정 손익 |
| UNREALIZED PNL | 평가 손익 |
| PORTFOLIO | 자산 구성 |
| PERFORMANCE | 성과 |
| RECONCILIATION | 데이터 맞춤 확인 |

## 화면별 적용
홈 / 모의투자 / 실거래 준비 / 더보기 / 자산 구성 / 전략 / 주문 기록 / 알림 / 설정 / PAPER 상세 모니터.

## 상태별 visual matrix
- 정상·연결됨·실행 성공: 초록
- 대기·복구·부분 확인: 노랑
- 실패·사용 불가·안전 정지: 빨강
- 미설정·정보 없음: 회색
- 기기 내 대체 데이터: 노랑, 단독 초록 금지

## 변경하지 않는 내부 canonical term
PAPER, LIVE, NOT_CONFIGURED, UNAVAILABLE, RUNNING, HALTED, LOCAL_FALLBACK, SERVER_STREAM, exact SHA, workflow run id, liveAuthority, productionMutationAllowed, aiAuthority, Home/Paper/Live/More route ids, backend JSON field names와 API endpoint.

## 검증
exact-head CI, Android Product UX interaction, exact-head screenshot artifact, HOME/PAPER/LIVE/MORE visual review, stable release 이후 physical Galaxy acceptance.
