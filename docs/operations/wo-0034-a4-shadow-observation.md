# WO-0034-A4: Shadow 관측 운영 가이드

이 문서는 **실제 Shadow 관측을 시작하기 전에 반드시 읽어야 하는 절차서**입니다.
명령 단위로 적혀 있으니 위에서부터 그대로 따라 하시면 됩니다.

---

## 0. 먼저 알아둘 것

**Shadow 관측이 무엇인가**

Shadow는 실제 시장 데이터를 보면서 "만약 주문했다면 어땠을까"를 **기록만** 하는 모드입니다.
주문을 넣지 않고, 잔고를 건드리지 않고, Upbit에 로그인조차 하지 않습니다.

**이 단계(A4)에서 하면 안 되는 것**

- 실제 주문 — 이 빌드에는 주문을 넣는 코드 자체가 없습니다
- Upbit Private API 호출 — API 키를 넣는 자리가 없습니다
- 장시간 관측 — 한 세션은 **최대 30분**에서 자동으로 끝납니다
- 6시간 관측 — 아직 승인되지 않았습니다

**한 세션의 기본 한계값** (`apps/desktop/src/shadowObservationProfile.ts` 한 파일에 모여 있습니다)

| 항목 | 값 |
| --- | --- |
| 시장 | KRW-BTC 고정 |
| 봉 | 1분봉, **완성된 봉만** |
| 전략 | `sma-crossover:closed-candle-1m-v1` |
| 첫 관측 목표 시간 | 10분 |
| **세션 최대 시간** | **30분 (넘으면 자동 종료)** |
| 큐 최대 깊이 | 1,000 (A3 한계와 동일) |
| 실제 주문 | 불가 |
| Private API | 불가 |

---

## 1. 시작하기 전에: 리허설 먼저 (권장)

실제 관측 전에, **네트워크를 전혀 쓰지 않는 리허설**을 먼저 돌려 보세요.
0.2초면 끝나고, 실제와 똑같은 runtime·EventBus·증거 파일 저장 경로를 그대로 사용합니다.

```bash
pnpm run build
node scripts/run-shadow-observation-smoke.js
```

**정상이면 마지막 줄이 이렇게 나옵니다:**

```
- final verdict: PASS
```

`final verdict: PASS`가 아니면 **실제 관측을 시작하지 마세요.**
바로 아래 `verdict reasons:` 줄에 이유가 적혀 있습니다.

JSON으로 받고 싶으면:

```bash
node scripts/run-shadow-observation-smoke.js --json
```

> 이 리허설은 "장치가 제대로 도는지"만 증명합니다.
> **수익성에 대해서는 아무것도 말해주지 않습니다.** 시세는 합성 데이터입니다.

---

## 2. 시작 전 확인 사항 (Preflight)

Shadow는 시작 버튼을 눌러도 아래 조건이 하나라도 어긋나면 **시작되지 않습니다.**
이건 사람이 확인하는 체크리스트가 아니라 코드가 강제하는 관문입니다.

- 상태가 `IDLE`일 것 (이미 세션이 돌고 있으면 시작 불가)
- `RECOVERY_REQUIRED` 상태가 아닐 것
- 이전에 봉인되지 않은 증거 폴더가 없을 것
- 실거래·Private API·자격증명 저장 기능이 **탐지되지 않을** 것
- 주문·체결·현금·포지션·broker 호출 카운터가 **전부 0**일 것
- 증거 저장 폴더에 쓸 수 있을 것
- 시계 값이 정상일 것
- 시장이 KRW-BTC일 것
- 완성된 봉만 쓰도록 되어 있을 것
- 큐 용량이 프로파일 한계 이내일 것

**중요한 한계 하나:** 실거래/Private API 탐지는 **소스 코드 패턴 검사**입니다.
"있다"는 증명할 수 있어도 **"없다"는 증명할 수 없습니다.**
보고서에 `capabilityAssuranceLimit: SOURCE_SCAN_PROVES_PRESENCE_NOT_ABSENCE`라고 적혀 나오는 이유가 이것입니다.
이 문장을 "안전이 증명됨"으로 읽으면 안 됩니다.

---

## 3. 관측 시작 방법

현재 Shadow를 시작하는 방법은 **데스크톱 앱 화면의 버튼 하나뿐**입니다.
명령줄로 실제 관측을 시작하는 경로는 **일부러 만들지 않았습니다** — 실수로 켜지는 걸 막기 위해서입니다.

```bash
pnpm run build
pnpm desktop
```

앱이 뜨면:

1. 시세가 들어오기 시작할 때까지 기다립니다 (워밍업 20분봉 필요)
2. Control Room 화면에서 Shadow **시작** 버튼을 누릅니다
3. 상태가 `RUNNING`으로 바뀌는지 확인합니다

**시작했는데 `RUNNING`이 안 되는 경우**

| 표시 | 뜻 | 할 일 |
| --- | --- | --- |
| `IDLE` + `MARKET_DATA_WARMING_UP` | 아직 봉이 덜 모임 | 그냥 기다렸다 다시 누르기 |
| `HALTED` + `EVIDENCE_RECOVERY_REQUIRED` | 지난번 기록이 봉인 안 됨 | 아래 6번 절차 |
| `HALTED` + `KILL_SWITCH_ACTIVE` | 킬스위치가 켜져 있음 | 킬스위치 먼저 해제 |
| `HALTED` + `RISK_GATE_NOT_CONFIGURED` | 리스크 게이트 미구성 | 정상입니다. 아직 구성 전 |

---

## 4. 관측 중 상태 확인

앱 화면에 다음이 표시됩니다. 별도의 상태 조회 시스템은 만들지 않았고,
**기존 `shadow:status` 하나를 확장**했습니다.

| 항목 | 의미 |
| --- | --- |
| `sessionId` | 이번 세션 고유 번호 |
| `state` | `RUNNING` / `PAUSED` / `HALTED` / `COMPLETED` |
| `startedAt` / `elapsedMs` | 시작 시각 / 경과 시간 |
| `maxSessionDurationMs` | 자동 종료까지의 한계 (30분) |
| `closedCandleCount` | 처리한 완성 봉 개수 |
| `duplicateCandleCount` | 중복으로 들어와 버린 봉 |
| `staleCandleCount` | 너무 오래돼서 버린 봉 |
| `outOfOrderCandleCount` | 순서가 뒤집혀 들어온 봉 |
| `signalCount` | 전략이 낸 신호 개수 |
| `blockers` | 멈춘 이유 (있을 때만) |
| 주문/체결/현금/포지션 카운터 | **항상 0이어야 합니다** |

**카운터가 0이 아니면 즉시 중단하고 보고하세요.** 그건 Shadow의 전제가 깨졌다는 뜻입니다.

---

## 5. 자동으로 멈추는 조건

아래 중 하나라도 생기면 시스템이 **스스로** 멈춥니다. 사람이 볼 때까지 기다리지 않습니다.

**HALT (문제가 생겨 멈춤 — 기록은 `ABORTED`로 봉인)**

- 큐가 가득 참 (`QUEUE_OVERFLOW`)
- 증거 파일 쓰기 실패 (`SINK_WRITE_FAILED`)
- flush 실패 / finalize 실패
- 봉 순서 역행 (`CANDLE_SEQUENCE_REGRESSION`)
- 이벤트 해시 체인 검증 실패
- WebSocket 재연결 완전 실패

**정상 종료 (`COMPLETED`로 봉인)**

- 사용자가 정지 버튼을 누름
- **세션 최대 시간 30분 도달** (`MAX_SESSION_DURATION_REACHED`)

**버리기만 하고 계속 진행**

- 중복 봉 → 세어 두고 버림
- 오래된 봉 → 세어 두고 버림

멈춘 뒤에는 새 신호를 처리하지 않고, 새 이벤트도 내보내지 않습니다.
그리고 **실패한 세션은 절대 "정상 완료"로 표시되지 않습니다.**

---

## 6. 정상 종료 방법

1. 앱 화면에서 Shadow **정지** 버튼을 누릅니다
2. 상태가 `COMPLETED`가 되는지 확인합니다
3. 앱을 닫습니다

앱을 그냥 닫아도 됩니다 — 정상 종료 시 기록을 봉인한 뒤 종료합니다.
다만 **강제 종료(작업 관리자로 죽이기)는 하지 마세요.** 기록이 봉인되지 않아 다음 시작이 막힙니다.

---

## 7. 증거 검증 방법

기록은 여기에 저장됩니다 (경로는 화면에 표시되지 않습니다 — 개인 경로라서요):

```
<앱 사용자 데이터 폴더>/shadow-evidence/<sessionId>/
```

Windows 기준 사용자 데이터 폴더는 보통 `%APPDATA%\dokkaebi` 입니다.

폴더 안에 있어야 하는 파일:

| 파일 | 뜻 |
| --- | --- |
| `session.json` | 세션 정보 |
| `events.ndjson` | 이벤트 기록 (해시로 연결됨) |
| `manifest.json` | 요약 + 해시 |
| `verification.json` | **검증 결과** |
| `completed.marker` 또는 `aborted.marker` | 봉인 도장 |

**확인 방법:** `verification.json`을 열어 `"status"`를 봅니다.

- `"status": "PASS"` → 정상
- 그 외 → `"blockers"` 배열에 이유가 있습니다

**`completed.marker`가 있어야 정상 완료입니다.** `aborted.marker`면 중간에 멈춘 세션입니다.

---

## 8. `RECOVERY_REQUIRED`가 떴을 때

**뜻:** 지난번 앱이 비정상 종료돼서, 그때 기록이 봉인되지 않은 채 남아 있습니다.
지금 시작하면 두 세션의 기록이 한 폴더에 섞여 나중에 구분할 수 없게 되므로 **일부러 막는 것**입니다. 고장이 아닙니다.

**절차:**

1. 앱을 완전히 종료합니다
2. `shadow-evidence` 폴더에서 `completed.marker`도 `aborted.marker`도 **없는** 하위 폴더를 찾습니다
3. 그 폴더를 **지우지 말고** 다른 곳(예: 바탕화면의 `shadow-incomplete-백업`)으로 **옮깁니다**
   - 지우면 그때 무슨 일이 있었는지 영영 알 수 없게 됩니다
4. 앱을 다시 켭니다
5. 상태가 `IDLE`로 돌아오면 정상입니다

옮긴 폴더는 나중에 원인 분석용으로 보관하세요.

---

## 9. 절대 실행하면 안 되는 것

- ❌ `shadowObservationProfile.ts`의 `actualOrdersEnabled` / `privateApiEnabled`를 `true`로 바꾸기
- ❌ `maxSessionDurationMs`를 30분보다 크게 늘리기 (A4 범위 밖입니다)
- ❌ `maxQueueDepth`를 1,000보다 크게 늘리기 (A3 안전 한계가 무너집니다)
- ❌ 봉인 안 된 증거 폴더를 **삭제**하기 (옮기는 건 됨)
- ❌ 어떤 형태로든 Upbit API 키·시크릿을 환경변수나 파일에 넣기
- ❌ 6시간짜리 장시간 관측 시작하기 (아직 승인 전)
- ❌ 앱을 작업 관리자로 강제 종료하기

---

## 10. 실제 주문이 꺼져 있는지 확인하는 방법

세 가지를 각각 확인하시면 됩니다.

**(1) 소스에 주문 코드가 있는지 검사**

```bash
node scripts/build-deployment-descriptor.js --output /tmp/descriptor.json
```

출력에서 다음 세 줄이 전부 `false`여야 합니다:

```
[deployment] liveTradingCapabilityPresent: false
[deployment] privateApiCapabilityPresent: false
[deployment] credentialStoragePresent: false
```

> 다시 강조: 이건 **패턴 검사**입니다. "있다"는 잡아내지만 "없다"를 증명하진 못합니다.

**(2) 리허설 결과의 카운터 확인**

```bash
node scripts/run-shadow-observation-smoke.js
```

다음이 전부 `0`이어야 합니다:

```
- broker mutation: 0
- order mutation: 0
- fill mutation: 0
- cash mutation: 0
- position mutation: 0
- private API calls: 0
```

**(3) 실제 세션 종료 후 증거 파일 확인**

`verification.json`의 `actualOrders`, `actualFills`, `cashMutations`, `positionMutations`가 전부 `0`인지 봅니다.
이건 앱이 스스로 보고하는 값이 아니라, **저장된 기록을 다시 읽어서 독립적으로 다시 센 값**입니다.

---

## 11. 문제가 생겼을 때 보고할 내용

아래 항목을 그대로 복사해서 채워 보내주시면 됩니다.
**절대 경로와 API 키는 절대 포함하지 마세요.**

```
- sessionId:
- runtime state:
- blockers:
- elapsed:
- closedCandleCount / duplicate / stale / outOfOrder:
- signalCount:
- verification.json 의 status:
- completed.marker 또는 aborted.marker 중 무엇이 있는지:
- 주문/체결/현금/포지션 카운터:
```

---

## 관련 문서

- `docs/operations/shadow-operational-runtime.md` — 데이터가 흐르는 경로 (A2)
- `docs/operations/shadow-owner-lifecycle.md` — 상태 전이와 소유자 명령 (A2)
- `docs/operations/wo-0034-integration-matrix.md` — A1~A3 통합 현황
