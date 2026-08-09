# Dokkaebi — Quick Start Guide

실제 사용 가능한 3가지 앱 (Desktop, Web, Mobile)을 지금 바로 시작하세요.

## 📦 사전 요구사항

- **Node.js** >= 24.0.0
- **pnpm** >= 11.7.0
- **Windows** (Desktop 앱의 경우) 또는 **macOS/Linux** (Web, Mobile 앱)

## 🚀 3가지 앱 시작 가이드

### 1️⃣ Desktop 앱 (Electron) — Windows Paper Trading

**실시간 Upbit 시세를 받아서 로컬에서 Paper Trading을 하는 데스크톱 애플리케이션**

```bash
# 설치 & 빌드
pnpm install
pnpm build

# 개발 모드 실행
pnpm desktop

# Windows 설치 파일 생성
pnpm package:win
```

**기능:**
- ✅ 실시간 KRW-BTC 시세 수신 (Upbit WebSocket)
- ✅ Paper Trading (매수/매도, 자동 전략)
- ✅ 실시간 차트 표시
- ✅ 포트폴리오 현황
- ✅ 주문 기록
- ✅ Kill Switch (긴급 중지)
- ✅ AI CIO 대시보드 (읽기 전용)

**원리:**
1. Upbit public WebSocket에서 실시간 시세 수신
2. SMA/EMA 교차 전략 엔진 실행
3. Risk Engine을 통해 주문 검증
4. SQLite에 거래 기록 저장
5. 로컬 메모리에서만 Paper Trading 실행 (실제 거래 없음)

---

### 2️⃣ Web 앱 (Node.js + Vanilla JS) — 브라우저 Paper Trading

**로컬 서버를 통해 브라우저에서 접근 가능한 Paper Trading 앱**

```bash
# 설치 (Desktop과 함께 진행됨)
pnpm install

# 서버 시작
pnpm server

# 브라우저 접속
# http://localhost:3000
```

**기능:**
- ✅ REST API 기반 거래
- ✅ 실시간 시세 (Upbit REST API 폴링)
- ✅ Champion/Challenger 전략 비교
- ✅ 온디맨드 백테스트
- ✅ CSV 내보내기
- ✅ PWA (설치 가능한 앱)
- ✅ 모바일 대응
- ✅ 선택적 API 키 인증

**장점:**
- 별도 설치 없이 브라우저에서 실행
- 모바일/태블릿 완벽 대응
- Webhook 알림 지원
- 자동 동시성 제어

---

### 3️⃣ Mobile 앱 (React Native + Expo) — iOS/Android Paper Trading

**iPhone/Android에서 실행 가능한 네이티브 모바일 앱**

```bash
# 설치
pnpm install

# iOS 시뮬레이터에서 실행
pnpm --filter mobile-app ios

# Android 에뮬레이터에서 실행
pnpm --filter mobile-app android

# 웹 버전으로 개발 테스트
pnpm --filter mobile-app web

# 실제 기기에 배포 (EAS Build)
cd apps/mobile-app
eas build --platform ios
eas build --platform android
```

**기능:**
- ✅ 대시보드 (실시간 자산 현황)
- ✅ 포트폴리오 (보유 자산)
- ✅ 전략 제어 (시작/중지)
- ✅ 설정 (서버 주소, API 키)
- ✅ 푸시 알림 (Expo Notifications)
- ✅ 보안 저장소 (Expo Secure Store)

**구조:**
```
apps/mobile-app/
├── src/
│   ├── App.tsx           (네비게이션 구조)
│   ├── screens/          (4개 주요 화면)
│   ├── api/              (REST 클라이언트)
│   ├── components/       (UI 컴포넌트)
│   ├── storage/          (로컬 저장소)
│   ├── notifications/    (알림)
│   └── theme/            (색상 토큰)
└── package.json
```

---

## 🔧 공통 설정

### 서버 주소 설정 (Web/Mobile 앱용)

Web 앱이나 Mobile 앱을 사용하려면 로컬 서버가 필요합니다:

**Web 앱:**
```bash
# 터미널 1: 서버 시작
pnpm server
# 출력: Listening on http://localhost:3000

# 터미널 2: 브라우저 접속
http://localhost:3000
```

**Mobile 앱:**
1. 설정 화면에서 서버 주소 입력: `http://localhost:3000`
2. 선택사항: API 키 입력 (설정하지 않으면 누구나 접근 가능)

### 선택: API 키 보안

Web/Mobile 앱에 선택적 인증 추가:

```bash
# 환경 변수 설정
export DOKKAEBI_API_KEY="your-secret-key-here"

# 서버 시작
pnpm server
```

그 후 클라이언트에서 설정 화면에 같은 키를 입력하면 인증됨.

---

## 📊 세 앱의 역할

| 앱 | 용도 | 장점 | 시작 명령 |
|---|---|---|---|
| **Desktop** | 연구/분석 | 실시간 고성능, 차트, 모든 기능 | `pnpm desktop` |
| **Web** | 모니터링/거래 | 브라우저, PWA, 모바일 대응 | `pnpm server` + http://localhost:3000 |
| **Mobile** | 이동 중 제어 | 네이티브 앱, 푸시 알림, 오프라인 준비 | `pnpm --filter mobile-app ios/android/web` |

---

## ✅ 첫 번째 Paper Trade 체험

### Desktop 앱으로 시작하기

```bash
# 1. 앱 시작
pnpm desktop

# 2. Upbit 시세 대기 (자동 연결)
# "Upbit 연결됨"이 보일 때까지 대기

# 3. Manual Order
# - 수량: 0.001 BTC
# - [매수] 또는 [매도] 클릭
# - 주문이 Paper Broker를 통해 처리됨
# - 실거래가 아니므로 안전함

# 4. 자동 거래 활성화
# - "전략 제어" → [시작]
# - SMA/EMA 교차 전략이 자동 실행
# - 모든 주문이 Risk Engine을 통과

# 5. 결과 확인
# - 포트폴리오: 현금/자산/손익
# - 체결 기록: 모든 주문 이력
# - AI CIO: 읽기 전용 대시보드
```

### Web 앱으로 시작하기

```bash
# 1. 터미널 1: 서버 시작
pnpm server

# 2. 터미널 2: 브라우저 접속
# http://localhost:3000

# 3. 대시보드에서:
# - [매수], [매도] 버튼
# - 전략 제어 (시작/중지)
# - 자동 거래 토글

# 4. 모바일에서 동일한 기능 사용 가능
```

### Mobile 앱으로 시작하기

```bash
# 1. 설정 화면에서 서버 주소 입력
# http://localhost:3000 (Web 앱 서버)

# 2. 대시보드 탭
# - 실시간 시세
# - 자산 현황

# 3. 제어 탭
# - 전략 시작/중지
# - 자동 거래 토글

# 4. 포트폴리오 탭
# - 현금/자산 현황
# - 손익 표시
```

---

## 🧪 테스트 & 검증

```bash
# TypeScript 체크
pnpm typecheck

# 빌드
pnpm build

# 전체 테스트 실행
pnpm test

# 특정 테스트만 실행
npx node --test tests/paper-broker.test.js
```

---

## 📋 안전 설정 (꼭 읽기)

### Paper Trading만 가능

**현재:**
- ✅ Paper Trading (로컬 메모리, 실제 거래 없음)
- ❌ Live Trading (구현되지 않음, 의도적)

### Kill Switch (긴급 중지)

모든 앱에서 사용 가능한 긴급 중지 버튼:

```bash
# Desktop: UI의 [중지] 버튼
# Web/Mobile: [제어] 탭의 [중지] 버튼

# HTTP API:
curl -X POST http://localhost:3000/api/strategy/stop
```

**특징:**
- 즉시 실행 (< 500ms)
- Risk Engine 우선
- 모든 자동 거래 중단
- 수동 거래도 Risk Engine 통과

---

## 🐛 문제 해결

### Desktop 앱이 시작되지 않음

```bash
# 1. 빌드 확인
pnpm build

# 2. Node 버전 확인 (24.0.0 이상 필요)
node --version

# 3. 로그 확인
NODE_DEBUG=* pnpm desktop
```

### Web 서버가 3000 포트를 사용 중

```bash
# 다른 포트로 시작
PORT=3001 pnpm server
```

### Mobile 앱이 서버에 연결 안 됨

```bash
# 1. 서버가 실행 중인지 확인
pnpm server

# 2. 방화벽 확인
# localhost:3000 접속 가능한지 확인

# 3. Mobile 설정에서 IP 주소 확인
# 172.x.x.x 또는 실제 컴퓨터 IP

# Mac/Linux의 경우:
ifconfig | grep "inet " | grep -v 127.0.0.1
```

---

## 📚 더 알아보기

- **DOKKAEBI.md** — 전체 프로젝트 정책 및 설계 철학
- **DESIGN_SYSTEM.md** — UI/UX 디자인 토큰 및 컴포넌트
- **AGENTS.md** — AI 개발자 역할 및 에이전트 가이드
- **tests/** — 1200+ 테스트 (구현 예시)
- **docs/** — 성능 벤치마크, 감리 보고서

---

## 🎯 다음 단계

1. **Desktop 앱 실행** — Paper Trading 경험
2. **Web 앱 시작** — 브라우저 기반 거래
3. **Mobile 앱 배포** — iPhone/Android에 설치
4. **설정 커스터마이징** — API 키, 전략 파라미터 조정
5. **백테스트 실행** — 과거 데이터로 검증
6. **모니터링** — 거래 기록 분석

---

**모든 앱이 Paper Trading만 지원합니다. 실제 거래는 구현되지 않았으므로 안전합니다.**

행운을 빕니다! 🚀
