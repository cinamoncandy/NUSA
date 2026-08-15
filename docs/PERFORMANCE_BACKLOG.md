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
| 1 | SQLite 해시체인 스토어들이 매 append/조회마다 genesis부터 전체 replay+재검증을 함 | 높음 (장기 실행 시스템의 핵심 쓰기·읽기 경로) | 높음 | **DONE** (커밋 참고) |
| 2 | 모바일 리스트 화면 중 order-history 외에 무한정 커질 수 있는 리스트가 `ScrollView`+`.map()`으로 전체 렌더링되는지 재확인 | 낮음~중간 | 낮음 | **DONE** — `watchlistView.tsx`의 "전체 결과"(검색어 없으면 Upbit 전체 공개 마켓, 수백 개까지 가능)가 실제로 무제한 렌더링 중이었음. `FlatList`로 전환(가상화), 저장한 시장 섹션은 헤더에 유지(사용자 선택으로 이미 bounded). `portfolioView.tsx`(포지션, 소수개)는 문제 아님으로 확인 |
| 3 | `apps/desktop/src/backtestEngine.ts` / `walkForwardEngine.ts` / `parameterStability.ts`의 실제 반복 복잡도 프로파일링 — 큰 과거 데이터셋에서 체감 지연이 있는지 확인 후 필요시 최적화 | 중간 (온디맨드 실행이라 상시 부하는 아니지만 사용자 체감 지연 직결) | 낮음~중간 (측정 먼저, 성급한 최적화 금지) | TODO |
| — | `JSON.parse(JSON.stringify())` 딥클론 → `structuredClone()` 교체 (`apps/cloud/src/runtimeEventBus.ts`, `apps/cloud/src/runtimeReplay.ts`) | 매 런타임 이벤트/리플레이 | 낮음 | **DONE** (커밋 `93bd697`) |

## 완료 기록

- **순위 1 (SQLite replay-per-write)** — `packages/storage/src/aiOutcomeAttributionMemory.ts`
  (`appendEpisode()`, `applicableLessons()` — 후자는 틱마다 호출되는 가장 뜨거운 경로였음)와
  `packages/storage/src/aiCalibrationDurability.ts`(`appendPrediction`/`appendOutcomeAndResolve`/
  `expirePending`) 모두 인메모리 캐시(Map, `replay()`가 채우고 매 성공한 append 직후 증분 갱신)로
  전환. `replay()` 자체(생성자에서 호출되거나 명시적으로 호출될 때의 진짜 전체 디스크 재검증)는
  그대로 유지 — 무결성/변조탐지 보장 약화 없음. 캘리브레이션 스토어는 생성자에서 replay를 안 부르는
  기존 설계라 `ensureCache()`로 최초 사용 시점에 지연 워밍업하도록 처리. 관련 테스트(계산 무결성,
  변조 탐지, 재시작 복구 등) 전부 통과 확인. governance 이벤트 스토어
  (`packages/storage/src/multiAgentGovernanceStore.ts`)는 같은 패턴이 없어 대상 아님.

## 참고

- 이 목록은 2026-08-15 세션에서 전체 감사 없이 빠르게 스캔해서 나온 것 — "극한 수준"을 표방한
  전수조사 결과가 아니라 실용적 우선순위다. 순위 2 이후로 새 항목이 발견되면 이 표에 추가할 것.
- 관련해서 검토했지만 최적화 대상이 **아니라고 판단한** 것: `apps/cloud/src/runtime.ts`의 틱마다
  evidence 번들을 다시 만드는 부분 — AI 스케줄링 cadence(30초)와 무관하게 `resolvePending()`이
  매 틱 실시간 가격으로 calibration을 해소해야 하므로, evidence 생성 자체를 스킵할 수 없음. 언뜻
  낭비처럼 보이지만 실제로는 필요한 작업.
