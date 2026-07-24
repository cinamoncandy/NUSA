# Dokkaebi

Renderer interaction guidance: [Command Palette](docs/design/command-palette.md).

> **브랜치 안내:** 이 브랜치가 주력 브랜치입니다 — 실제로 실행되는 Paper Trading 앱입니다 (PR #1). `main`은 향후 실거래 게이팅에 재사용할 회계·인증 라이브러리 실험 공간으로 별도 유지됩니다. 이 브랜치의 `packages/storage`, `packages/contracts`는 분기 시점에 `main`의 코드를 기반으로 시작됐지만, 이후로는 자동 동기화 없이 독립적으로 발전해왔습니다.

Electron 기반 Windows Paper Trading 앱입니다. Upbit 공개 WebSocket의 `KRW-BTC` 실시간 시세를 받아 로컬 모의 주문과 손익을 계산합니다.

## 안전 범위

- 현재 실거래 주문 기능은 없습니다.
- API 키를 요구하거나 저장하지 않습니다.
- 모든 매수·매도는 메모리 기반 Paper Trading입니다.
- Electron renderer는 `contextIsolation`, sandbox, 제한된 preload IPC를 사용합니다.

## 실행

```bash
pnpm install
pnpm test
pnpm desktop
```

Windows 설치 파일 생성:

```bash
pnpm package:win
```

## 구성

- `apps/desktop/src/main.ts`: Electron main process와 IPC
- `apps/desktop/src/preload.ts`: renderer에 노출되는 제한된 API
- `apps/desktop/src/upbitWebSocket.ts`: Upbit ticker WebSocket 및 재연결
- `apps/desktop/src/paperBroker.ts`: 현금, 포지션, 수수료, 실현·미실현 손익
- `apps/desktop/renderer`: 데스크톱 대시보드
- `packages/contracts`: 공통 회계·리스크 계약
- `packages/storage`: SQLite 포지션 회계 저장소

## 검증

GitHub Actions의 Windows 환경에서 TypeScript typecheck와 Node 테스트를 실행합니다.
