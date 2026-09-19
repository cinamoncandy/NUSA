# PAPER 서버 연결 런북

**대상**: `https://nusa-api.duckdns.org` (Oracle Cloud, #1949 추적 대상 호스트)
**목적**: 소유자가 휴대폰에서 PAPER 서버에 연결할 수 있게 만드는 것

## 안전 불변식 (전 과정 유지)

```
PAPER_ONLY
liveAuthority=NONE
productionMutationAllowed=false
aiAuthority=ZERO_AUTHORITY
```

LIVE 활성화 금지. 실제 주문/출금/이체 권한 생성 금지. branch protection / Audit / Release / Risk /
HOLD 게이트 우회 금지.

**토큰·비밀번호 값을 GitHub, 채팅, 로그, 커밋에 기록하지 마십시오.** 이 문서는 절차만 담습니다.

---

## 0단계 — 측정된 현재 상태 (2026-09-19T10:02Z)

`#1949`에 기록된 값은 **2026-09-17** 관측입니다. 그 값(디스크 96%, load 21, SSH 불통)을 근거로
"호스트가 죽었다"고 여러 번 서술됐지만, **2026-09-19에 바깥에서 측정한 결과는 다릅니다.**

| 측정 | 결과 | 의미 |
|---|---|---|
| DNS | `129.225.130.81` | 해석됨 |
| `/health` x10 | **10/10 HTTP 200** | 전부 성공 |
| 지연 | min 0.618s / avg 0.747s / max 0.876s | **편차가 작음 — 스래싱 아님** |
| TLS 인증서 | `notBefore 2026-09-19T10:01:36Z` | **측정 직전에 갱신됨** |

load 21에 가용 RAM 147Mi인 호스트는 지연이 널뛰거나 타임아웃이 납니다. 10회 연속 200에 편차
0.26초, 그리고 **인증서 자동 갱신이 방금 성공했다**는 것은 호스트가 예약 자동화를 정상 수행하고
있다는 뜻입니다.

> **판단**: 이 호스트는 현재 살아 있고 응답합니다. #1949의 "죽은 호스트" 전제는 재확인이
> 필요합니다. 디스크 여유는 바깥에서 측정할 수 없으므로 여전히 확인 대상입니다.

### 배포된 빌드는 구버전입니다

```
/health                       200  {"ok":true,"observedAt":...}   <- passwordSignIn/deploymentRevision 없음
/v1/mobile/session/password   404  <- 비밀번호 로그인 라우트 자체가 없음
/v1/mobile/pairing/start      400  <- 페어링은 존재
/api/operator/mobile-bootstrap 403
/api/paper-operations         401  <- 관측 엔드포인트, 자격증명 요구
/api/dashboard                401
/api/shadow-operations        401
/api/evolution-learning       401
/ready                        401
```

**서버는 살아 있지만 최근 작업이 아무것도 배포돼 있지 않습니다.** 구 빌드는 레거시 대시보드
토큰만 받습니다. 비밀번호 로그인도, 무인증 관측도 없습니다.

---

## 1단계 — 호스트 상태 확인 (사람만 가능)

SSH로 들어가 확인합니다. 아래 출력에는 비밀이 없으므로 공유해도 안전합니다.

```bash
uptime
free -h
df -h /
systemctl is-active sentinelx-cloud-core docker
```

**통과 기준**: 디스크 80% 이하, load 1분 평균 2 미만, 가용 RAM 300Mi 이상.

디스크가 여전히 90% 이상이면 재배포 전에 정리가 필요합니다 — 재생성 가능한 캐시부터:
`pnpm store prune`, `journalctl --vacuum-size=200M`, `rm -rf /tmp/NUSA-ci`. `docker system prune -f`는
가능하나 `-a`와 `--volumes`는 쓰지 마십시오(`sentinelx-cloud-core` 상태가 볼륨에 있을 수 있습니다).

---

## 2단계 — 병합 (소유자/Audit만 가능)

PR #1809이 비밀번호 로그인과 무인증 관측을 모두 담고 있습니다. 현재 **HOLD + REWORK + Draft**
입니다. 이 라벨 해제와 병합은 소유자와 Audit의 권한이며, 자동화나 AI가 우회할 수 없습니다.

병합 전 `mergeable_state`가 `behind`이면 main을 다시 병합해 최신화합니다(rebase 금지 — 다른
체크아웃이 무효화됩니다).

---

## 3단계 — 재배포 (사람만 가능)

```bash
# 호스트 셸에서
cd /opt/nusa/current
git fetch origin main
git checkout <merged-sha>
# 빌드/서비스 재시작은 이 호스트의 기존 배포 절차를 따릅니다
```

**검증** — 이것이 재배포가 실제로 일어났는지 확인하는 유일한 방법입니다:

```bash
curl -s https://nusa-api.duckdns.org/health
```

`deploymentRevision`이 배포한 정확한 40자리 커밋을 보고해야 합니다. `UNVERIFIED`가 나오면
반영되지 않은 것입니다. 구 빌드는 이 필드 자체가 없습니다.

---

## 4단계 — 소유자 비밀번호 설정 (1회, 사람만 가능)

```bash
node scripts/set-owner-password.js
```

비밀번호는 터미널에서 에코 없이 입력받습니다. **인자나 환경변수로 넘기지 마십시오** — 인자는
셸 히스토리와 `ps`에, 환경변수는 `/proc`에 남습니다. 스크립트는 비밀번호를 지문조차 출력하지
않습니다.

확인:

```bash
curl -s https://nusa-api.duckdns.org/health   # passwordSignIn 이 CONFIGURED 로
```

이 시점부터 **휴대폰에서 비밀번호만으로 로그인**할 수 있습니다. 파일에서 토큰을 꺼내올 필요가
없어집니다 — 소유자가 자기 서버에서 잠겨 있던 원인이 그것이었습니다.

---

## 5단계 — 무인증 관측 (선택, 사람만 가능)

학습·전략 화면을 자격증명 없이 보려면 서버에 플래그를 켭니다:

```
NUSA_CLOUD_ANONYMOUS_OBSERVATION=1
```

**기본값은 꺼짐입니다.** 켜지 않으면 관측 엔드포인트는 계속 401입니다.

열리는 것은 읽기 전용 projection 6개뿐입니다: `dashboard`, `paper-operations`,
`shadow-operations`, `live-readiness`, `engineering-operations`, `evolution-learning`.

**열리지 않는 것** — 이 분할이 핵심입니다:

| 유지 | 이유 |
|---|---|
| `/api/operator/*` | 세션 자격증명을 발급·승인합니다. 이걸 열면 나머지 잠금이 전부 무의미해집니다 |
| `/api/real-readonly-operations` | 실제 업비트 계좌 잔고. PAPER 데이터가 아닙니다 |
| `POST /api/paper-orders` | 외부 주문 주입이 가능해지면 자율 체결/손익 인증 증거가 위조 가능해집니다 |
| `/api/settings/investment-allocation` | 런타임 배분을 변경합니다 |

익명 principal은 `dashboard:read` 하나만 가지므로 `paper:trade`와 `telemetry:write`는 구조적으로
도달 불가입니다. Authorization 헤더가 **없는** 요청만 익명으로 처리되며, 토큰을 제시한 요청은
그 토큰으로 판정되고 익명으로 폴백하지 않습니다.

---

## 왜 AI가 1~5단계를 대신할 수 없는가

| 단계 | 막는 것 |
|---|---|
| 1, 3, 4, 5 | 호스트 셸 접근. 이 컨테이너에 SSH 키가 없고 포트 22가 차단돼 있습니다 |
| 2 | HOLD/REWORK 해제와 Release 권한. 우회는 금지된 행위입니다 |

자격증명을 채팅으로 받아 대신 연결하는 것도 하지 않습니다 — 토큰 값이 대화 기록에 남기
때문이며, 이는 소유자가 정한 제약입니다.

바깥에서 측정 가능한 것(0단계)은 AI가 할 수 있고, 위에 기록돼 있습니다.
