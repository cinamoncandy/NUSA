# NUSA 성능 개선 백로그

> 자동 재개용 상태 파일. 세션이 끊기거나(컨텍스트/크레딧) 재시작되더라도 이 파일 하나만 보고
> 다음 항목부터 이어갈 수 있도록 유지한다. 항목을 끝내면 상태를 `DONE`으로 바꾸고 커밋할 것.
> 안전 불변식(zero-authority, PAPER 미연결, WO-AI-011 금지 등)은 `NUSA_AI_CODEX_HANDOFF.md`와
> 동일하게 항상 적용.

## 진행 방식 (다음 세션이 이어받을 때)

1. 아래 표에서 상태가 `TODO`인 것 중 순위가 가장 높은 항목 하나를 고른다.
2. 구현 → `pnpm run build && pnpm run typecheck` → 관련 테스트 → 커밋 → 이 파일 상태 갱신 → push.
3. 리스크가 `HIGH`인 항목은 반드시 기존 테스트가 통과함을 확인하고, 안전/무결성 보장이 약해지지
   않았는지 별도로 검토한 뒤 진행한다 — 크레딧 절약보다 정합성이 항상 우선.
4. 한 항목을 끝냈으면 다음 항목으로 넘어가되, 세션이 끝날 것 같으면 이 파일 상태만 정확히
   반영해두고 멈춘다 (다음 트리거가 이어받음).

## 순위

| 순위 | 항목 | 영향 | 리스크 | 상태 |
|---|---|---|---|---|
| 1 | SQLite 해시체인 스토어들이 매 append마다 genesis부터 전체 replay+재검증을 함 (`packages/storage/src/aiOutcomeAttributionMemory.ts`의 `appendEpisode()`, `packages/storage/src/aiCalibrationDurability.ts`, 그리고 governance 이벤트 스토어도 같은 패턴일 가능성 — 확인 필요). append 1건당 O(n) → 누적 O(n²). 이 스토어들은 append-only라 시간이 갈수록 계속 커짐 | 높음 (장기 실행 시스템의 핵심 쓰기 경로) | 높음 — 변조 탐지 보장을 절대 약화시키면 안 됨. 안전한 접근: 생성자에서의 최초 전체 replay는 유지(무결성 검증), 이후 append는 메모리에 캐싱된 검증된 체인 헤드에서 증분 검증만 하도록 변경. 서두르지 말 것 | TODO |
| 2 | 모바일 리스트 화면 중 order-history 외에 무한정 커질 수 있는 리스트(포지션, 워치리스트 등)가 `ScrollView`+`.map()`으로 전체 렌더링되는지 재확인. order-history는 이미 페이지네이션 확인됨(문제없음) | 낮음~중간 (실사용 규모에서 대부분 작을 가능성) | 낮음 | TODO |
| 3 | `apps/desktop/src/backtestEngine.ts` / `walkForwardEngine.ts` / `parameterStability.ts`의 실제 반복 복잡도 프로파일링 — 큰 과거 데이터셋에서 체감 지연이 있는지 확인 후 필요시 최적화 | 중간 (온디맨드 실행이라 상시 부하는 아니지만 사용자 체감 지연 직결) | 낮음~중간 (측정 먼저, 성급한 최적화 금지) | TODO |
| — | `JSON.parse(JSON.stringify())` 딥클론 → `structuredClone()` 교체 (`apps/cloud/src/runtimeEventBus.ts`, `apps/cloud/src/runtimeReplay.ts`) | 매 런타임 이벤트/리플레이 | 낮음 | **DONE** (커밋 `93bd697`) |

## 참고

- 이 목록은 2026-08-15 세션에서 전체 감사 없이 빠르게 스캔해서 나온 것 — "극한 수준"을 표방한
  전수조사 결과가 아니라 실용적 우선순위다. 순위 3 이후로 새 항목이 발견되면 이 표에 추가할 것.
- 관련해서 검토했지만 최적화 대상이 **아니라고 판단한** 것: `apps/cloud/src/runtime.ts`의 틱마다
  evidence 번들을 다시 만드는 부분 — AI 스케줄링 cadence(30초)와 무관하게 `resolvePending()`이
  매 틱 실시간 가격으로 calibration을 해소해야 하므로, evidence 생성 자체를 스킵할 수 없음. 언뜻
  낭비처럼 보이지만 실제로는 필요한 작업.
