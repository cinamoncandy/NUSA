# NUSA redesign proposal v2: "NUSA Core" (2026-11-15)

Status: PROPOSAL, not an approval. Nothing here changes code, a host, a workflow or a limit. Every phase is its own governed
PR. Safety stays fixed: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`,
Release=HOLD. A redesign may only REMOVE authority, never add.

v2 revises v1 (merged in #3135) after the independent design review (verdict UNSOUND). Accepted in substance: the default
was fail-open, the deployed build was never proven to support the mode, the phone path trusted a mutable workflow and the
owner's grant had no expiry, rollback and data compatibility were undefined, and the numbers were not reproducible.
Owner decisions D1 to D4 (approved) and D5 (apps/execution not used) stand; the order of phases changed (section 4).

## 0. Summary for the owner (Korean, easy language)

- v1의 큰 구멍 두 개를 인정합니다. **(1) 값이 없으면 "주문 켜짐"이 기본**이었습니다(지금 코드도 그렇습니다). **(2) 서버에 올라간 빌드가 "수집만" 모드를 진짜 지키는지 확인하지 않고** 폰 버튼부터 만들려 했습니다.
- v2는 순서를 바꿉니다. **먼저 안전장치(기본값 = 주문 꺼짐, 실제 입구 시험, 서버가 자기 모드를 /health에 보고)**, **그 다음에 폰 버튼**입니다. 안전장치가 증명되기 전에는 버튼은 꺼져 있습니다.
- 서버의 원하는 상태는 **서버 안의 한 파일(루트 소유)**이 정합니다. GitHub는 요청과 기록만 합니다. 모르는 값이면 **항상 꺼짐**입니다.
- "주문" 모드는 #3108이 닫히고 독립 검증이 끝나기 전에는 **아예 선택할 수 없습니다.** 사장님 허락도 **정확한 빌드 + 만료 시간**에 묶입니다.
- 릴리스는 데이터 호환(앞뒤로 되돌릴 수 있는) 방식으로, 느린 시작을 실패로 보지 않게, 백업은 따로 합니다. "15분"은 백업 제외 시간입니다.
- 사장님 터미널 사용은 0을 목표로 하되, **처음 한 번 설치는 터미널이 필요**합니다(예외로 명시).

## 1. What "best design" means here (criteria)

1. Structural safety: a mistake or an unknown value ends in "no orders", never in "orders".
2. Owner terminal use is zero in routine operation; any exception is named.
3. Cheap recovery: stop, start and roll forward take minutes, not an hour.
4. Stay small: remove code and workflows instead of adding layers; every new thing must delete more than it adds.
5. Evidence-based: each claim has a command that reproduces it (`node scripts/measure-repo-facts.js`).

## 2. Evidence

Measured with `scripts/measure-repo-facts.js` on origin/main (scope printed by the script: dist, node_modules, generated
platform folders, `.d.ts` and test files excluded from source counts).

| Fact | Value (scope) | Consequence |
| --- | --- | --- |
| TypeScript source lines | apps 127,701; packages 23,862; total 151,563 | Most code is in apps, not packages. |
| `apps/cloud` | 384 source files, 53,934 lines | One flat folder, no import boundary. |
| Other apps (source lines) | autopilot 16,294; desktop 29,960; execution 6,311; mobile 21,202 | desktop and execution are candidates to freeze. |
| Distinct `NUSA_*` tokens in cloud source | 91 (all identifier tokens; the earlier "54" counted only environment reads) | Configuration is scattered and unvalidated. |
| Workflows | 41 on main | Each is an attack and maintenance surface. |
| Work order YAML files | 620 (29 in `archive/`) | Audit trail; keep, archive more, do not delete the record. |
| Test files | 1,043 files under `tests/`, 1,004 named test or spec | Tests covered the inner start-up layer, not the production entry. |
| Two composition layers | `scripts/start-cloud-runtime.js` to `closedLearningProductionRuntime` to `startCloudRuntime` | The 2026-11-15 first failure was a production-entry versus test mismatch: the tests covered the inner layer; the entry verified a lease the switch never started. Fixed in #3133. |
| Default is fail-open | `isPaperOrderPathEnabled`: unset or exactly `ON` means orders enabled | A missing or garbled value starts the order path. Must be inverted. |
| Unit has no `UnsetEnvironment=` | `deploy/oracle/nusa.service` | A stray unit-level variable can override intent. |
| Release length | build 1 min, backup 48 to 51 min (throttled 1 MiB/s), stage 2 min, activate up to 13 min | The "under 15 min" target excludes the backup, which becomes a separate job. |
| Readiness hard cap 300 s | `scripts/oracle-readiness-check.js` | A cold start of about 300 s was judged a failure and rolled back to the defective build. |
| Desired state is not one datum | Codex held "stay stopped", the owner and Claude started; SentinelX could stop, disable, enable | Two agents fought for 25 minutes. |

## 3. Principles

1. **Fail closed by default.** The default mode is `STOPPED` for the host and "no orders" for the runtime. Unset, unknown, expired or unreadable means no order path, in both the unit and the process.
2. **The host owns the desired mode.** A root-owned record on the host (mode, who requested, for which release, expiry) is the effective state. GitHub only requests and audits. Unknown or unreadable record means `STOPPED`.
3. **The process proves its mode.** `/health` reports the effective `runMode` and the build identity. Start, restart, release and the health guard compare it with the record; a mismatch stops the service and alerts.
4. **Deploy is not run.** Staging changes no process; mode changes are separate actions.
5. **Proof before power.** The phone start button stays disabled until production-entry tests pass in CI, a build that supports the mode is deployed and verified (capability and version check), and mode-aware alerting exists.
6. **Least privilege.** A tiny dedicated sudo helper (`nusa-run-mode`, root-owned) with only `stop`, `start-collect-only`, `status`. The release helper stays unchanged. No general verb for any agent.
7. **Tests go through the production entry** in every mode and assert what exists and what does not (lease, order boundary, timers, writes, `/health` fields).
8. **Data-compatible releases.** Schema changes are expand then contract; a previous build can always open the data.

## 4. Target shape

1. **Runtime.** One composition root builds the runtime from a validated config and a typed `RunMode` (`STOPPED`, `COLLECT_ONLY`, `PAPER_ORDERS`). `PAPER_ORDERS` needs an explicit, unexpired owner grant bound to the exact release, and is unavailable until #3108 is merged and independently verified. Replaces `NUSA_PAPER_ORDER_PATH`.
2. **Host mode controller.** A small root-owned program owns the mode record and is read by boot, `Restart`, release and the health guard. The unit uses `UnsetEnvironment=` for mode variables so only the controller's value reaches the process.
3. **Phone workflow.** Runs only from the protected default branch (Environment branch policy and a pinned ref, not a mutable ref), on a dedicated runner group, behind an Environment with required reviewers. It calls `nusa-run-mode`. The one-time install of the helper is a documented, honest bootstrap exception that needs a terminal once.
4. **Release.** Backup is a scheduled, verified job with a restore rehearsal; a release requires a verified backup younger than 24 h. Readiness follows reported start-up phases (listening, recovering, collecting), not a fixed deadline. A progressing slow start is never rolled back. If a new build truly fails, fall back to a safe `STOPPED` or `COLLECT_ONLY` on a build known to open the data, and repair forward. "Last known good" is recorded only after a completed soak.
5. **Alerting.** Mode-aware owner alerts (unexpected stop, mode mismatch, stale market events, orders while not permitted) are a prerequisite for automatic start.
6. **Code.** Delete the retired auto-coding WIP and lease machinery instead of reimplementing it. Keep work orders as audit. Freeze, then delete unused code (`apps/execution`, desktop) in small reviewed PRs.

## 5. Phases (each one governed PR or a small group, each reversible)

| Phase | What | Gate to finish | Rollback |
| --- | --- | --- | --- |
| R0 | Stage A evidence: two readings, recorded | owner reads the record | none |
| R1 | Fail-closed default (unset means no orders), effective `runMode` in `/health`, `UnsetEnvironment=`, production-entry boot tests per mode in CI | CI boots the real entry in each mode; an unset or garbled value yields no lease and no timers | revert |
| R2 | Deploy a build with R1; capability and version check; verify `/health.runMode` on the host (read-only diagnose workflow) | diagnose output shows the expected mode and build | previous build |
| R3 | Host mode record and controller, `nusa-run-mode` helper, mode-aware alerting; refactor PR #3136 into this shape | alerts fire in a drill; helper tested with stub `systemctl` and the systemd-parser soundness test | remove workflow and helper |
| R4 | Phone workflow enabled (protected ref, runner group, Environment); owner presses stop and start once | sudo log shows only the helper; owner needs no terminal | disable the repo variable |
| R5 | Release redesign: separate backup, phase-aware readiness, expand and contract data, safe fallback, restore rehearsal | one full release under 15 min excluding backup; one deliberate failure ends safe | keep old workflow |
| R6 | Cloudflare removal S1 to S5 (docs/PROPOSAL_SIMPLIFICATION_2026-11-14.md) | per phase | per phase |
| R7 | Single config module and composition root; split `apps/cloud/src` with import-boundary lint; delete retired WIP; freeze then delete desktop and `apps/execution`; archive work orders | CI time and workflow count drop; no behaviour change | revert |

Order: R0, R1, R2, R3, R4, R5, then R6 and R7 with care for the merge gate. The phone start button never precedes R1 to R3.

## 6. Not in scope

- Stage B (orders ON): blocked on #3108, an independent verification, a release and fresh owner approval.
- Any change of risk limits, thresholds, capital or authority. LIVE trading of any kind.

## 7. Decisions

D1 to D4 approved (direction, R1 first with direct agent control removed, desktop frozen after the phone path is proven, phase order now revised as above). D5: `apps/execution` is not used, so it is frozen then deleted in R7. New for the owner: approve the v2 order (proof before the phone button) and the one-time helper install.

## 8. Risks

- Inverting the default can stop a service that relied on unset meaning ON: R1 ships with the unit and env file set explicitly, verified by the diagnose workflow before use.
- A bug in a control verb could stop a healthy service: every verb is tested against a stub `systemctl` and runs under the activation lock.
- The mode record is a new single point: unknown means `STOPPED`, and the diagnose workflow reads it.
- Large refactors (R7) wait for the R1 to R3 safety net. The Cloudflare gate is a required merge check and moves last.

## 9. Gaps checked in the repository (read-only, origin/main)

- Nothing in the repo sets `NUSA_PAPER_ORDER_PATH` (no unit, script or env template). Its only source on the host is `/etc/nusa/cloud-runtime.env`, which is outside version control. Consequence: R1 must make the value explicit in the host record and verify it through `/health.runMode`; the repo alone cannot prove what the host runs.
- `/health` and `server.ts` carry no `runMode` today. R1 adds it.
- 34 test files start the runtime or the daemon entry; only 4 mention the switch. Inverting the default means those tests must set the order path explicitly where they rely on ON. R1 lists them and changes only that line, with a control test that proves ON behaviour is unchanged when set explicitly.
- Stale or corrupt host mode record: the controller treats a missing, unparsable, expired or wrong-build record as `STOPPED` and the health guard alerts instead of restarting. The R3 drill must cover each case.
