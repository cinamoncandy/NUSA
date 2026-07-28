# A4K Long-running Shadow Observation

This procedure validates runtime stability without enabling orders, private APIs, credentials,
or automatic restart. It is an operator check, not a CI job: CI uses the fake-timer tests only.

## Start

From the repository root:

```powershell
pnpm run build
pnpm desktop
```

In Control Room, run the existing read-only A4 safety check. Start Shadow only when the screen
reports `READY_FOR_OBSERVATION`, then keep the session open for at least 30 minutes. The profile
remains KRW-BTC, verified closed 1-minute candles, and the existing hard safety ceiling applies.

## During the observation

The Shadow panel's **Long-running diagnostics** section is read-only. Check it periodically:

- session id and state remain unchanged;
- elapsed time advances;
- memory health is `INSUFFICIENT_SAMPLES` until three samples exist, then `MEMORY_STABLE` unless heap usage
  is strictly increasing in every sample;
- active interval and timeout counts stay flat while running, and listeners/subscriptions remain one;
- Evidence and signal counts advance without duplicate subscriptions;
- actual orders, fills, cash/position mutations, broker calls, and private API calls remain zero.

The sampler captures one immediate snapshot and then one every minute. Its memory heuristic is a
conservative diagnostic signal, not proof of a leak: sustained monotonic heap growth is
`MEMORY_GROWTH_SUSPECTED`; ordinary GC variation is `MEMORY_STABLE`. The complete per-session snapshots remain
read-only diagnostics and do not alter the immutable Evidence archive.

## When the public feed drops (WO-0034-A4L)

The observation is expected to survive an ordinary network blip. The transport owns exactly
one reconnect timer and retries with bounded exponential backoff (1s, 2s, 4s … capped at 30s),
up to 10 attempts or 10 minutes within a single outage, whichever comes first. There is no
unbounded retry: the policy validator rejects one.

The session does not fail on the first drop. It moves to a safe wait, stops producing Shadow
signals, and keeps the same session id and the same archive. When real market data is flowing
again AND the full start precheck passes again, the session returns to RUNNING — the same
session, not a new one. A feed that never comes back inside the policy ends the session with
`MARKET_RECONNECT_TIMEOUT`, naming which ceiling was hit.

The **시장 데이터 연결** panel is read-only and shows: 연결됨 / 데이터 지연 / 재연결 중 n/10 /
연결 복구됨 / 연결 실패, plus the retry count, the last received time, the current and total
downtime, and the live listener, subscription, and reconnect-timer counts.

Each session seals a separate `market-connection.json` beside the event log, bound to the
manifest by hash. It records every outage's `disconnectedAt`, `reconnectAttemptCount`,
`recoveredAt`, `totalDowntime`, and `finalReconnectState`. A session that never dropped seals
`NEVER_DISCONNECTED` rather than claiming a recovery it never made. Nothing already in the
archive is rewritten.

## Stop and inspect

Use the existing owner **Stop Shadow session** action. Do not kill the process. Confirm the final
state is `COMPLETED`, the sampler reports zero active intervals/timeouts, and the safety counters
remain zero. Verify the existing Evidence archive with the normal A4 verifier and inspect the
diagnostic snapshots through the Shadow status/read-only UI. A writer, flush, sequence, private
API, credential, or mutation failure is a HALT and must remain visible for recovery review.

If the session is not `COMPLETED`, preserve the archive and collect the Electron main-process
logs, the final read-only diagnostics response, and the Evidence `verification.json`. Never
delete an incomplete archive or reset a safety blocker to continue.

---

# 30분 실관측 절차 (한국어)

이 절차는 **사용자 PC에서 직접** 수행합니다. 자동으로 실행되지 않으며, 자동 실행해서도 안 됩니다.

## 시작 전

```powershell
git pull --ff-only
node --version          # v24 이상이어야 함
pnpm run build
```

## 1) 관측 시작

```powershell
pnpm desktop
```

1. 안전진단 칸에서 **Run read-only check** 를 누릅니다
2. **`READY_FOR_OBSERVATION`** 이 나올 때까지 기다립니다
   - 시장 데이터가 준비 중(워밍업)이면 **기다렸다 다시** 누르세요. 우회하지 마십시오
   - 다른 판정이 나오면 **여기서 멈추고** 화면에 나온 코드를 알려주세요
3. Shadow **시작** 버튼을 누릅니다
4. **30분간 앱을 켜둡니다**

## 2) 관측 중 (10분마다 한 번씩 확인)

**장시간 진단** 칸에서 다음을 봅니다.

| 항목 | 정상 | 이상 |
| --- | --- | --- |
| 세션 번호 | 안 바뀜 | 바뀌면 세션이 재시작된 것 |
| 경과 시간 | 계속 증가 | 멈추면 이상 |
| 메모리 판정 | `MEMORY_STABLE` | **`MEMORY_GROWTH_SUSPECTED`** |
| 타이머 수 | 계속 같은 값 | 계속 늘어나면 누수 |
| 리스너·구독 수 | 계속 같은 값 | 계속 늘어나면 누수 |
| 신호·증거 수 | 늘거나 유지 | 줄어들면 이상 |
| 주문·체결·현금·포지션·브로커·Private API | **전부 0** | **하나라도 0이 아니면 즉시 중단** |

**메모리 판정 기준:** 표본 3개 미만이면 `INSUFFICIENT_SAMPLES` 입니다 — "안전"이 아니라 **"아직 판단할 수 없음"** 입니다. 표본이 3개 이상 쌓이고 사용량이 **한 번도 안 줄고 계속 증가**했을 때만 `MEMORY_GROWTH_SUSPECTED` 가 됩니다. 이건 누수의 **증거가 아니라 신호**이며, 표본 전체가 보관되니 그걸 보고 판단하시면 됩니다.

## 2-1) 인터넷이 잠깐 끊겼을 때

**아무것도 하지 마시고 화면만 보세요.** 앱이 알아서 다시 연결합니다.

**시장 데이터 연결** 칸에 이렇게 표시됩니다.

| 표시 | 뜻 | 할 일 |
| --- | --- | --- |
| **연결됨** | 정상 | 없음 |
| **데이터 지연** | 연결은 살아 있는데 데이터가 늦음 | 잠시 지켜보기 |
| **재연결 중 3/10** | 3번째 재시도 중 (최대 10번) | 기다리기 |
| **연결 복구됨** | 다시 붙었음 | 없음 |
| **연결 실패** | 재시도를 다 썼음 | 아래 참고 |

- 재시도 간격은 **1초 → 2초 → 4초 → … 최대 30초**로 점점 길어집니다. 무한 반복은 하지 않습니다.
- 끊긴 동안에는 **관측이 잠시 멈춥니다.** 세션이 실패한 게 아니라 **대기 상태**이고, **세션 번호는 그대로**입니다.
- 데이터가 다시 들어오고 안전 점검을 다시 통과하면 **같은 세션으로 알아서 재개**됩니다. 버튼을 누르실 필요가 없습니다.
- 10번 또는 10분 안에 못 붙으면 세션이 **`MARKET_RECONNECT_TIMEOUT`** 으로 종료됩니다. 이건 정상 동작입니다 — 증거 폴더는 그대로 두고 알려주세요.
- 끊긴 순간 만들어지던 1분봉은 **버립니다.** 끊기기 전 체결과 끊긴 후 체결을 한 봉에 섞으면 그건 1분간의 시장이 아니기 때문입니다.

## 3) 정상 종료

1. 30분이 지나면 Shadow **정지** 버튼을 누릅니다
   - **작업 관리자로 강제 종료하지 마십시오**
2. 상태가 **`COMPLETED`** 인지 확인합니다
3. 타이머·리스너 수가 **0으로 떨어지는지** 확인합니다
4. 안전 카운터가 **여전히 전부 0** 인지 확인합니다

## 4) 종료 후 확인

증거 폴더(`<앱 데이터 폴더>/shadow-evidence/<세션번호>/`)에서:

- `completed.marker` 가 있어야 합니다
- `verification.json` 의 `status` 가 `PASS` 여야 합니다

## 5) 문제가 생겼을 때

**증거 폴더를 지우지 마십시오.** 안전장치를 풀어서 계속 진행하지도 마십시오.

아래를 그대로 복사해 알려주시면 됩니다. **폴더 경로와 API 키는 넣지 마세요.**

```
- 최종 상태:
- 메모리 판정:
- 표본 개수:
- 타이머 / 리스너 / 구독 수 (시작 / 중간 / 종료):
- 주문·체결·현금·포지션·브로커·Private API 카운터:
- completed.marker 유무:
- verification.json 의 status:
```

## 절대 하면 안 되는 것

- ❌ 실거래 기능을 켜는 것
- ❌ API 키·시크릿을 넣는 것
- ❌ 강제 종료
- ❌ 증거 폴더 삭제
- ❌ 안전 판정이 나쁜데 무시하고 계속 진행
