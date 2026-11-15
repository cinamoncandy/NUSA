# NUSA Core design v5 (2026-11-15)

Status: PROPOSAL. Supersedes the target shape and phase plan of docs/NUSA_REDESIGN_PROPOSAL_2026-11-15.md (v4) where they
differ; v4 sections 7 to 9 (control plane, readiness, shared code) stay valid unless replaced here. Nothing here changes a
host, a limit or an authority. Fixed: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`,
`aiAuthority=ZERO_AUTHORITY`, Release=HOLD.

## 0. Summary for the owner (Korean, easy language)

- 오늘 검토에서 실패의 대부분은 **셸(bash) 스크립트의 함정**에서 나왔습니다. v5는 서버를 켜고 끄는 판단을 **시험 가능한 작은 프로그램 하나(`nusa-control`)**로 옮기고, 모든 경우의 결과를 **표 하나**로 정합니다. 표에 없는 경우는 전부 "꺼짐"입니다.
- 서버 상태는 **파일 하나**에 둡니다(원하는 모드, 지금 빌드, 검증된 빌드, 시도 횟수, 주문 허락). 쓰는 곳도 이 프로그램 하나뿐입니다.
- 릴리스는 **운영 데이터 사본에서 먼저 켜 본 뒤**에만 실제로 바꿉니다. 사본에서 실패하면 운영은 아무것도 바뀌지 않습니다. 이전 빌드가 새 데이터를 읽는지도 사본에서 증명합니다.
- 알림은 새 장치를 만들지 않고 **GitHub 앱 알림**(감시 작업이 실패하면 폰으로 옴)을 씁니다.
- 이 설계도 **서버 한 대가 죽는 것**과 **전략에 우위가 있는지**는 해결하지 못합니다(10장).

## 1. What "best" means (acceptance criteria)

1. Structural safety: every unknown, missing, expired or failed state ends in no orders, and a failed change ends in either "nothing changed" or STOPPED. Never "half started".
2. One source of truth per fact: one host state file, one writer, one mode rule, one composition root.
3. Decisions in a typed, table-driven program; shell only calls systemctl. Every row of the table is a test.
4. Prove before touching production: a release is rehearsed on a copy of production data first.
5. Owner terminal use: zero in routine operation; exactly one install, named.
6. Smaller after than before: each phase deletes more than it adds (workflows, scripts, units, apps).
7. Evidence-based: every claim has a command or test; numbers from `scripts/measure-repo-facts.js`.

## 2. Architecture

```
GitHub (request + audit only)            Host (decides and acts)
  phone workflow ──approve──▶ runner ──sudo──▶ nusa-control (root, pinned hash)
  release workflow ─────────▶ runner ──sudo──▶   │ reads/writes  /var/lib/nusa-control/state.json
  watch workflow (schedule) ◀── /health + `nusa-control status` (read-only)
                                                 │ writes        /etc/nusa/run-mode.env (one variable)
                                                 └ systemctl ──▶ nusa.service (one runtime process)
```

- **Runtime (one process).** One composition root; `NUSA_RUN_MODE` from `/etc/nusa/run-mode.env` only (`COLLECT_ONLY` or `PAPER_ORDERS`; anything else is COLLECT_ONLY, already true for the order path since R1). `/health` reports the selected `runMode`, `orderPathReady` (loop, lease and boundary really exist) and start-up `phase` with a progress counter.
- **Controller `nusa-control`.** A small Node program installed at `/opt/nusa-control/` (root-owned, outside every release, byte-pinned like today's helper). Verbs: `status`, `stop`, `collect`, `release <sha>`, and later `grant-orders <sha> <ttl>` (blocked until #3108). It is the only writer of the state file and the mode file, and the only caller of `systemctl` for NUSA units.
- **Host state file.** `/var/lib/nusa-control/state.json`, root 0600 in a root 0700 directory; written by write-temp, fsync, rename. Fields: `desired` (STOPPED | COLLECT_ONLY | PAPER_ORDERS), `active` (sha), `proven` (list of sha with the rehearsal evidence id), `attempt` ({sha, startedAt, count}), `grant` ({sha, expiresAt, used}). Unreadable or invalid file: the controller treats desired as STOPPED and refuses every verb except `status` and `stop`.
- **Units.** `nusa.service` with `EnvironmentFile=/etc/nusa/cloud-runtime.env` and `EnvironmentFile=/etc/nusa/run-mode.env`, `UnsetEnvironment=NUSA_PAPER_ORDER_PATH`, `StartLimitIntervalSec=20min`, `StartLimitBurst=3`, `RestartPreventExitStatus=78` (the runtime exits 78 when the persisted start ceiling is reached). The autopilot is not part of a PAPER release (separate unit, separate workflow).

## 3. The state table (the whole control logic)

| From | Event | Check | To | On failure |
| --- | --- | --- | --- | --- |
| any | `stop` | none | STOPPED: units stopped and disabled, verified | report NOT CONFIRMED, exit non-zero |
| STOPPED or COLLECT_ONLY | `collect` | active build proven; mode file written; `/health.runMode`=COLLECT_ONLY within the start bound | COLLECT_ONLY | STOPPED |
| any | `release <sha>` step 1: rehearse | candidate boots on a data copy (section 4) | unchanged, candidate marked rehearsed | unchanged (production untouched) |
| any | step 2: switch and start | rehearsed; backup younger than 24 h; lock held | candidate running in the previous desired mode (never PAPER_ORDERS without a valid grant) | if the previous build is proven and passed the copy test: restore it; else STOPPED |
| running | step 3: soak 180 s | `/health` healthy, mode matches, no restarts | candidate proven, recorded | same as step 2 failure |
| COLLECT_ONLY | `grant-orders` (after #3108) | grant for the exact active sha, expiry at most 24 h, unused, host clock synchronized | PAPER_ORDERS | stays COLLECT_ONLY |
| PAPER_ORDERS | grant expires or is used up | checked by the runtime before every order and by the controller | COLLECT_ONLY | STOPPED |
| any | mode on `/health` differs from `desired` | watch or controller check | STOPPED + alert | STOPPED + alert |

Every row is a unit test of the controller with a fake systemctl and a fake clock; a property test generates random event sequences and asserts that no sequence reaches PAPER_ORDERS without a valid grant and that every failure ends in "unchanged" or STOPPED.

## 4. Release = rehearse on a copy, then switch

1. CI builds the exact main commit (as today) and the controller verifies the artifact hash.
2. Online snapshot of the production database with the SQLite backup API into a scratch directory (disk headroom checked first). This is not the nightly backup; it is discarded afterwards.
3. Start the candidate in COLLECT_ONLY on a loopback port against the copy, migrations included. Wait for `phase=ready` with the progress rule of v4 section 8 (stall 120 s, ceiling 20 min).
4. Stop it, then start the previous build against the migrated copy and require it to read the ledger, recover and perform its required writes. Pass: the previous build becomes a valid restore target for this release. Fail: the release is still allowed, but the failure path is STOPPED instead of restore.
5. Only now switch the symlink and start in production; soak; mark proven.

Effect: the 2026-11-15 failure class (a build that cannot start in time, or a restore to a build that cannot open the data) is found on the copy, before production changes. The 50 min backup leaves the release (nightly job with a restore rehearsal; the release only checks its age).

## 5. Access

- After the install, no agent account has sudo for `systemctl`, the release helper or `nusa-control`. Only the runner account of the protected release and phone workflows may call `nusa-control`, and only its listed verbs.
- Audit list and proof by refusal as in v4 section 7 and 7a (sudo, polkit, cron, at, timers, transient units, SSH keys, file write permissions, runners). The owner keeps one emergency path outside agent accounts.

## 6. Phone and alerts

- Phone: one workflow, dispatch only from protected main, Environment with the owner as required reviewer; buttons `stop` and `collect`. `grant-orders` is absent until #3108 is merged and independently verified.
- Alerts: a scheduled read-only watch workflow (every 15 min) fails on: unit not in the desired state, mode mismatch, stale market events, any order while not granted, start ceiling reached. A failed run notifies the owner through the GitHub mobile app. No new service, no Cloudflare.

## 7. What gets deleted

| Removed | When |
| --- | --- |
| `deploy/oracle/nusa-release-step.sh` decision logic (only a thin sudo wrapper may remain) | after the controller's first successful release |
| Cloudflare worker, coordinator and its merge gate | S1 to S5, after the phone path works |
| retired auto-coding WIP and lease machinery | with the controller |
| `apps/desktop`, the unused part of `apps/execution` | after the shared code moves (v4 section 9) |
| workflows replaced by the controller, watch and phone workflows | as each replacement passes |

## 8. Phases

| Phase | Content | Owner action |
| --- | --- | --- |
| done | R1: fail-closed order path, runMode, production-entry tests | none |
| now | R2a (#3142): finish as the interim safety of the existing helper; no further investment in bash | none |
| C1 | Controller code, state file, state table tests, property test; runtime `phase` and `orderPathReady`; unit start limits | none |
| C2 | Rehearse-on-copy in the controller, tested in CI on a synthetic database; nightly backup job | none |
| C3 | Access audit (read-only, through the diagnose workflow), then one install of the controller and the sudo rule | one terminal session, approval |
| C4 | First release through the controller (COLLECT_ONLY) | release approval |
| C5 | Watch workflow and phone workflow | press stop and collect once |
| C6 | Deletions (section 7) and Cloudflare S1 to S5 | per phase |
| C7 | Strategy review: does any researched strategy have an edge (decides whether Stage B is worth preparing) | read the review |

## 9. Risks

- The controller is new privileged code: it is small, typed, table-driven, fully unit-tested, installed byte-pinned, and reviewed by a non-author before the install.
- The data copy needs disk and time on a 4 CPU host: the controller checks headroom first and refuses the release instead of filling the disk.
- Interim period: until C4 the existing helper with R2a is the only release path, and releases stay on HOLD until the owner approves one.

## 10. What this design does not solve

- A single host: hardware or disk loss stops NUSA. Mitigation only: verified nightly backup and a rehearsed restore.
- Strategy: the research readouts show mostly `FAIL_NO_EDGE` and `FAIL_EXCESSIVE_DRAWDOWN`. A safe runtime does not make a profitable one; C7 asks that question explicitly.
- Unknown host facts (sudoers, keys, drop-ins) until the C3 audit; the design assumes nothing about them.
