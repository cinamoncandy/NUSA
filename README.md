# Dokkaebi

Dokkaebi는 Windows Electron 기반의 **PAPER/DRY_RUN 전용** 거래·연구 플랫폼입니다. Upbit 공개 WebSocket 시세, 로컬 모의 주문, 결정적 백테스트, Walk-Forward, Stress, Paper 검증과 감사 가능한 연구 계약을 제공합니다.

## 안전 범위

- 실거래 주문 경로가 없습니다.
- 거래소 Private API, API 키, 출금, 자본 자동 배분을 사용하지 않습니다.
- 전략 결과는 수익성을 보장하지 않으며 자동 Champion 승격을 수행하지 않습니다.
- Electron renderer는 `contextIsolation`, sandbox, 제한된 preload IPC를 사용합니다.
- 저장소·데이터·마이그레이션 검증 실패는 fail-closed 처리합니다.

## 지원 환경

- Windows 11 또는 Windows Server CI
- Node.js `>=24.0.0`
- pnpm `>=11.7.0`

프로덕션 실행은 `--experimental-sqlite`에 의존하지 않습니다. `pnpm preflight`가 현재 Node 버전과 `node:sqlite`의 `DatabaseSync` 제공 여부를 확인하며, 지원되지 않는 런타임에서는 명확한 오류로 중단합니다.

## 설치와 실행

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm preflight
pnpm typecheck
pnpm test
pnpm desktop
```

Windows 설치 파일 생성:

```bash
pnpm package:win
```

모든 npm 스크립트는 저장소 상대 경로와 `node_modules/.bin`을 사용합니다. 사용자 홈, Codex cache, 특정 PC의 `node.exe` 같은 절대 경로는 허용되지 않으며 preflight에서 차단됩니다.

## 이 시스템이 하는 일

1. 공개 시장 데이터를 수신합니다.
2. PAPER 계정과 결정적 execution model로 주문·체결·비용을 계산합니다.
3. 백테스트, Walk-Forward, Stress, Paper 검증을 수행합니다.
4. 결과 해시, 데이터셋 해시, 감사 이벤트를 기록합니다.
5. 운영자 검토 전에는 어떤 전략도 실거래나 자동 승격으로 연결하지 않습니다.

## `apps/execution` 및 execution 명칭의 의미

이 저장소에서 execution은 **실제 거래소 주문 실행기가 아니라 계산·시뮬레이션 경계**를 뜻합니다. 주문 수량 산정, 비용·슬리피지·부분체결·시장충격 가정, Paper fill을 다룹니다. Private exchange adapter나 LIVE 주문 전송 책임은 포함하지 않습니다. 관련 코드와 문서는 `execution model`, `paper execution`, `execution quality` 용어를 사용해 이 경계를 명시합니다.

## SQLite와 마이그레이션

- `packages/storage/src/migrationRunner.ts`가 마이그레이션 ID 형식, 엄격한 순서, 중복, SQL 공백, 적용 이력과 SHA-256 checksum을 검증합니다.
- 각 마이그레이션은 `BEGIN IMMEDIATE` 트랜잭션에서 실행되고 실패 시 rollback 후 fail-closed 처리됩니다.
- 이미 적용된 마이그레이션의 내용 변경과 알려지지 않은 migration ID는 거부됩니다.
- 기존 DB 호환성을 위해 과거 checksum이 없는 행만 현재 checksum으로 보강합니다.
- SQLite safety pragma와 무결성 검사 정책은 구현 문서와 회귀 테스트로 고정합니다.

마이그레이션 파일이나 ID를 수정하지 말고 항상 새 순번의 마이그레이션을 추가해야 합니다.

## 수량 정밀도와 dust 정책

PaperBroker는 시장별 quantity step과 dust threshold를 적용합니다.

- 주문 수량은 step 아래 자릿수를 내림 처리합니다.
- 매도 후 잔량이 dust threshold 이하이면 `0`으로 정규화합니다.
- 반올림으로 보유 수량을 초과하는 매도는 허용하지 않습니다.
- 실제 거래소의 tick/step은 공개 메타데이터로 별도 검증해야 하며 현재 기본값은 Paper 계약입니다.

## 버전과 출처

루트 및 데스크톱 패키지 버전은 정식 SemVer `0.1.0`입니다. `0.0.0-reconstructed` 같은 임시 재구성 문자열은 허용하지 않으며 저장소 portability 검증에서 차단됩니다. 연구 결과는 Git SHA, dataset SHA-256, runtime/research/committee version을 별도 provenance 계약으로 기록합니다.

## 주요 구성

- `apps/desktop/src/main.ts`: Electron main process와 IPC
- `apps/desktop/src/preload.ts`: renderer에 노출되는 제한된 API
- `apps/desktop/src/upbitWebSocket.ts`: Upbit 공개 ticker WebSocket 및 재연결
- `apps/desktop/src/paperBroker.ts`: 현금, 포지션, 비용, PnL, quantity-step/dust 정책
- `apps/cloud/src`: 연구, 통제, 감사, 거버넌스의 순수 계약
- `packages/contracts`: 공통 회계·리스크 계약
- `packages/storage`: SQLite 저장소, 마이그레이션, 무결성 정책
- `scripts/check-runtime.js`: Node/SQLite 런타임 사전점검
- `scripts/validate-repository-portability.js`: 절대경로·재구성 버전 차단
- `tests`: Windows CI에서 실행되는 격리 회귀 테스트

## 검증

GitHub Actions는 Windows 환경에서 다음을 수행합니다.

```text
frozen dependency install
→ runtime/portability preflight
→ TypeScript typecheck
→ build
→ isolated full test suite
```

PR은 Draft 상태를 유지하며, CI 통과는 실거래 승인이나 수익성 증명이 아닙니다.
