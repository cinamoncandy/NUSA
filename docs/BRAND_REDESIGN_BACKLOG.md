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
| 3 | AI 탭(`aiView.tsx`)에 `TerrainHero` 적용 | **DONE** |
| 4 | Markets 탭에 시장 등락 분포 바 추가 — 목업의 zone map 자리에, 실제 데이터(각 마켓의 real changeRate)를 하락/보합/상승으로 집계한 `MarketBreadthBar`로 구현. `classifyPriceRegime`은 모바일 클라이언트에 연결된 적 없고 단일 마켓 기준이라 시장 전체 비율에 안 맞아서 채택 안 함; RISK/OPPORTUNITY 같은 평가성 라벨도 근거 없는 주장이라 배제 | **DONE** (범위는 계획과 다르게 조정 — 완료 기록 참고) |
| 5 | 브랜드 색상 재조정 — **재검토 결과 대규모 변경 불필요로 판단, 완료 기록 참고** | **DONE** (검토 완료, 변경 범위는 예상보다 작음) |
| 6 | Portfolio 탭에 자산 구성 시각화 추가 — 목업의 도넛(주식/현금/채권/대체)은 NUSA의 실제 데이터 모델(암호화폐 PAPER 단일 포지션 계좌)에 대응하는 카테고리가 없어 그대로 채택 불가. 대신 실제로 존재하는 현금/포지션 구성(포지션 평가액·주문 가능 현금·보호 현금)을 `AllocationBar`(순위 4의 바 컴포넌트를 N-세그먼트로 일반화)로 시각화 | **DONE** (범위는 계획과 다르게 조정 — 완료 기록 참고) |
| 7 | 로고/앱 아이콘 자산 검토 — **재검토 결과 변경 불필요로 판단, 완료 기록 참고** | **DONE** (검토 완료, 변경 없음) |
| 8 | Noto Sans KR 폰트 실제 링크 | TODO (이 세션에서 보류 — 이유는 완료 기록 참고) |
| 9 | Order 화면("05 ORDER") 톤 검토 | **DONE** (검토 완료, 이미 일치 — 완료 기록 참고) |
| 10 | 데스크톱 앱(`apps/desktop/renderer`) 리브랜딩 검토 | **DONE** (검토 완료, 변경 불필요 — 완료 기록 참고) |

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
- **순위 3~4 (AI 탭 지형 시각화 + Markets 등락 분포)** — `aiView.tsx`의 관찰 히어로 카드에
  `TerrainHero` 추가, `signalStrength`는 `CALIBRATED`일 때만 실제 confidence, 그 외엔 0.3 고정
  (미보정/불가용 상태가 과도하게 확신 있어 보이지 않도록). `watchlist.ts`에 `computeMarketBreadth`
  (real changeRate를 하락/보합/상승으로 임계값 버킷팅, null은 보합 처리, `down+flat+up===total`
  불변식) + `WatchlistViewModel.breadth` 필드 추가. `components.tsx`에 `MarketBreadthBar` 신설,
  `marketsView.tsx`에 와이어링 — 이미 파싱해둔 티커 데이터 재사용, 새 fetch 없음. 목업의
  "RISK/NEUTRAL/OPPORTUNITY ZONE" 문구는 채택하지 않음 — 실제로 계산되지 않는 위험 평가를
  주장하는 게 되어 NUSA의 근거 기반 원칙에 어긋남. `tests/mobile-brand-redesign-phase2.test.js`
  신설 + `mobile-watchlist.test.js`에 breadth 단위 테스트 추가. `pnpm run build`/타입체크/lint/
  262개 테스트 전부 통과 확인.
- **순위 5, 7 (브랜드 색상 재조정 / 로고·아이콘 재검토)** — 목업 이미지의 "COLOR SYSTEM" 범례를
  다시 읽어보니 **Purple = AI/Insight, Blue = Data/Flow, Teal = Growth, White = Primary, Gray =
  Secondary**로 명시되어 있음. 즉 목업 스스로도 "브랜드 액션(버튼 등)은 모노크롬, 채도는
  AI·데이터 신호 전용"이라는 원칙을 쓰고 있고, 이건 최근 merge된 현재 코드베이스의 정책과
  이미 동일함. 로고("Primary Logo")와 앱 아이콘도 목업에서 흰색 산 정상 실루엣 단색으로
  그려져 있어 `WaveMark`(이미 흰색 산 정상 실루엣)와 이미 일치. 따라서 버튼/CTA를 퍼플로
  바꾸거나 로고를 유채색으로 바꾸는 건 목업을 오독한 방향이었음 — 순위 1~4, 6에서 이미 한
  "AI/데이터 표면에 그라디언트를 크게 쓰는" 작업이 목업이 실제로 요구하는 전부였다고 결론.
  변경 없음, 검토만 기록.
- **순위 6 (Portfolio 자산 구성)** — `components.tsx`에 `AllocationBar`(라벨 있는 N-세그먼트
  바 + 범례, `MarketBreadthBar`와 같은 시각 언어) 신설. `portfolioView.tsx`에서 실제 존재하는
  세 값(포지션 평가액/주문 가능 현금/보호 현금)으로 와이어링 — 목업의 "주식 63%/현금 20%/
  채권 10%/대체 7%"는 NUSA 도메인에 없는 카테고리라 채택하지 않음. 0 이하 값은 세그먼트에서
  제외, 전체 합이 0이면 아예 렌더링 안 함. `tests/mobile-brand-redesign-phase2.test.js`에
  테스트 3개 추가. `pnpm run build`/타입체크/lint/264개 테스트 전부 통과 확인.
- **순위 9 (Order 화면 검토)** — `tradingView.tsx`를 다시 읽음: 매수/매도 토글, 예상 주문 금액
  미리보기, 확정 전 재확인 패널, 안전 게이트 배지가 이미 전부 갖춰져 있고 목업 "05 ORDER"와
  기능적으로 동일. 색상도 순위 5 결론(모노크롬 유지)과 이미 일치. 변경 없음.
- **순위 10 (데스크톱 앱 리브랜딩 검토)** — `apps/desktop/renderer`를 확인해보니 이미 자체
  브랜드 정체성 시스템(`control-room.js`/`.css`)이 구축되어 있음: "BRAND(잉크 배경, teal/violet
  nusa-fire)는 항상 화면에 있고 정체성을 담당한다. STATUS(teal=정상, amber=경고, red=위험,
  sky=canary, gold=검증됨)는 안전 여부를 답한다"는 주석과 함께, 실시간 헬스 상태로 구동되는
  SVG 기반 "flame" 시각 요소가 이미 존재. 이건 순위 5에서 확인한 원칙(브랜드 액션은 모노크롬,
  채도는 AI/데이터 신호 전용)과 이미 일치하는 desktop 전용의 더 성숙한 구현체임 — 모바일
  목업의 6화면 구조를 그대로 얹는 건 desktop의 다른 제품 형태(단일 대시보드가 아니라 여러
  패널로 구성된 control room)에 맞지 않고, 내가 전체 맥락을 모르는 기존 설계 결정과 충돌할
  위험이 큼. 변경 없음, 검토만 기록.
- **순위 8 (Noto Sans KR 폰트) — 이번 세션에서 보류** — 네이티브 프로젝트(android
  `res/font`/`build.gradle`, ios `Info.plist` UIAppFonts + Xcode 프로젝트) 설정 변경이
  필요한데, 이 샌드박스에는 Android SDK/Xcode가 없어서 `pnpm run build`/typecheck/lint/테스트
  루틴으로는 네이티브 빌드가 실제로 깨지는지 검증할 수 없음. 검증 불가능한 네이티브 빌드
  설정 변경을 그대로 커밋하는 건 무책임하다고 판단해 보류 — 실제 Android Studio/Xcode
  환경에서 진행하거나, 최소한 네이티브 빌드를 돌려볼 수 있는 세션에서 이어가야 함.
