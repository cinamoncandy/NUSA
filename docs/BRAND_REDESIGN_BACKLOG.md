# NUSA 브랜드 리디자인 백로그

> 자동 재개용 상태 파일. `docs/PERFORMANCE_BACKLOG.md`와 동일한 목적 — 세션이 끊기거나
> 재시작되더라도 이 파일 하나만 보고 다음 항목부터 이어갈 수 있도록 유지한다. 항목을 끝내면
> 상태를 `DONE`으로 바꾸고 커밋할 것. 안전 불변식(zero-authority, PAPER 미연결 등)은 항상 적용.

## 배경

2026-08-15, 사용자가 ChatGPT로 만든 NUSA 브랜드 목업(퍼플·블루·틸 그라디언트 + 산맥/지형
시각화 + 로고 마크 + 6개 화면 구성)을 공유하며 "전체 리브랜딩"을 요청. 목업은 방금 `main`에
merge된 모노크롬 디자인 시스템(PR #532/#533)과 방향이 다름 — 사용자가 이 방향 전환을 명시적으로
확인함.

핵심 발견: 코드베이스에는 이미 이 방향의 DNA가 있었음 — `WaveMark`(산 정상 실루엣 로고),
`TerrainSignal`(퍼플→블루→틸로 수렴하는 얇은 시그널 라인), `aiSignalStart/Mid/End` 컬러 토큰이
전부 목업과 개념적으로 일치. 최근 리디자인이 이걸 "AI 전용" 톤으로 축소해둔 상태였을 뿐. 그래서
전면 신규 제작이 아니라 기존 프리미티브를 목업 스케일로 확장하는 방식으로 진행 중.

## 순위

| 순위 | 항목 | 상태 |
|---|---|---|
| 1 | `TerrainHero` — 레이어드 산맥 실루엣 + 정상 글로우 컴포넌트 신설 (`components.tsx`) | **DONE** |
| 2 | Home 화면 히어로에 `TerrainSignal` → `TerrainHero` 적용 (계좌 히어로 카드 중심 시각) | **DONE** |
| 3 | AI 탭(`aiView.tsx`)에 `TerrainHero` 적용 — 목업의 "02 AI SIGNAL" 화면처럼 분석 진행/신뢰도를 시각적으로 표현 | TODO |
| 4 | Markets 탭에 위험/중립/기회 구간(RISK/NEUTRAL/OPPORTUNITY ZONE) 바 추가 — 목업 "03 MARKETS"의 zone map. 실제 데이터: `classifyPriceRegime`/`evaluateStrategyRegime`이 이미 이 3분류에 대응하는 `preference`(PREFERRED/NEUTRAL/FORBIDDEN)를 갖고 있어 재사용 가능할 듯 (검증 필요) | TODO |
| 5 | 브랜드 색상 재조정 결정 — 현재 "브랜드 액션은 모노크롬, 채도는 AI 전용"(최근 merge된 정책)과 목업의 "퍼플/블루/틸이 브랜드 정체성 자체" 사이의 실제 적용 범위를 사용자와 확정. 지금은 히어로 시각 요소에만 그라디언트를 썼고 버튼/CTA는 그대로 모노크롬 — 전체 CTA까지 바꿀지는 미결정 | TODO (사용자 확인 필요) |
| 6 | Portfolio 탭에 도넛형 자산배분 차트 추가 — 목업 "06 PORTFOLIO". RN에 차트 라이브러리 의존성이 없어 View 기반으로 자체 구현 필요 (SVG 없이 원형 진행률 표현은 제약이 큼 — react-native-svg 도입 여부 판단 필요) | TODO |
| 7 | 로고/앱 아이콘 자산을 목업 방향으로 갱신 (`apps/mobile/android/.../ic_nusa_logo*.xml` 등) — `tests/mobile-design-system-v1.test.js`가 현재 모노크롬(`#FFFFFFFF`) 아이콘을 강제하고 있어, 색상 아이콘으로 바꾸려면 이 테스트의 의도적 변경이 먼저 필요 | TODO |
| 8 | Noto Sans KR 폰트 실제 링크 — 현재 `typography.fontFamily: "System"`. 목업이 명시한 폰트를 쓰려면 .ttf 번들 + 네이티브 프로젝트(android/ios) 폰트 등록 필요, 앱 빌드 설정 변경을 동반하는 큰 작업 | TODO |
| 9 | Order 화면("05 ORDER") 톤 — 현재 `tradingView.tsx`가 기능적으로는 이미 매수/매도, 예상 주문 금액, 안전 게이트 배지를 갖추고 있음. 색상 재조정(5번) 이후에 자연스럽게 따라올 것으로 예상 — 별도 구조 변경 불필요해 보임 (검증 필요) | TODO (5번 이후 재검토) |
| 10 | 데스크톱 앱(`apps/desktop/renderer`)에도 동일 리브랜딩 적용 여부 — 목업은 모바일 6화면만 보여줬음, 데스크톱 반영 여부는 사용자 확인 필요 | TODO (사용자 확인 필요) |

## 진행 방식 (다음 세션이 이어받을 때)

1. 위 표에서 상태가 `TODO`인 것 중 순위가 가장 높은 항목 하나를 고른다.
2. "사용자 확인 필요"로 표시된 항목은 임의로 진행하지 말고 먼저 물어본다 (특히 5, 10번 — 색상
   재조정 범위와 데스크톱 적용 여부는 코드 판단만으로 결정할 수 없는 디자인 결정임).
3. 구현 → `pnpm run build && npx tsc -p apps/mobile/tsconfig.json --noEmit` → `pnpm run
   lint:mobile` → 관련 테스트 → 이 파일 상태 갱신 → 커밋 → push.
4. 새 시각 컴포넌트는 가능하면 기존 `TerrainSignal`/`WaveMark`의 border-triangle 기법을 재사용해서
   새 네이티브 의존성(예: react-native-svg) 추가를 최대한 미룬다 — 정말 필요해지면(도넛 차트 등)
   그때 의존성 추가를 사용자에게 먼저 확인한다.
5. 항목을 끝냈으면 다음 항목으로 넘어가되, 세션이 끝날 것 같으면 이 파일 상태만 정확히
   반영해두고 멈춘다.

## 완료 기록

- **순위 1~2 (TerrainHero + Home 적용)** — `apps/mobile/src/components.tsx`에 `TerrainHero`
  컴포넌트 신설: 레이어드 헤이즈 피크 4개(뒤쪽, 반투명) + 포컬 피크 1개(앞쪽, `aiSignalEnd`
  색상, `signalStrength`에 비례해 높이 변화) + 정상 글로우 dot/halo + 좌우 대각선 레이 2개.
  `WaveMark`의 border-triangle 기법과 `TerrainSignal`의 glow-dot/halo 기법을 재사용해서 새
  의존성 없이 구현. `homeView.tsx`의 계좌 히어로 카드에서 기존 `TerrainSignal`을 교체.
  `tests/mobile-uiux-visual-redesign.test.js`의 관련 단언을 갱신, `pnpm run build`/mobile
  typecheck/lint/258개 테스트 전부 통과 확인.
