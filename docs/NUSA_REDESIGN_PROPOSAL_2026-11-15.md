# NUSA redesign proposal v4: "NUSA Core" (2026-11-15)

Status: PROPOSAL, not an approval. Nothing here changes code, a host, a workflow or a limit. Every phase is its own governed
PR. Safety stays fixed: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`,
Release=HOLD. A redesign may only REMOVE authority, never add.

v4 revises v3 after the third review (UNSOUND: access removal came after the first deploy; `UnsetEnvironment=` cannot remove one source of a variable; grant consumption undefined; restart loops could reset the readiness limits; D5 contradicted the shared-code finding; the measurement script lacked the main SHA). See sections 5, 7, 8, 10.

v3 revised v2 after the second review (UNSOUND: v2 deployed the new build through the unsafe old release before fixing the release; direct agent access was not removed concretely; `UnsetEnvironment=` use was ambiguous; the grant was checked only at start; R7 would delete apps that cloud and Research still import). Section 5 reorders the phases, sections 7 to 9 add the control plane, readiness bounds and shared-code move.

v2 revised v1 (merged in #3135) after the independent design review (verdict UNSOUND). Accepted in substance: the default
was fail-open, the deployed build was never proven to support the mode, the phone path trusted a mutable workflow and the
owner's grant had no expiry, rollback and data compatibility were undefined, and the numbers were not reproducible.
Owner decisions D1 to D4 (approved) stand; D5 is corrected in section 10 (apps/execution is still imported by cloud); the order of phases changed (section 5).

## 0. Summary for the owner (Korean, easy language)

- v1의 큰 구멍 두 개를 인정합니다. **(1) 값이 없으면 "주문 켜짐"이 기본**이었습니다(지금 코드도 그렇습니다). **(2) 서버에 올라간 빌드가 "수집만" 모드를 진짜 지키는지 확인하지 않고** 폰 버튼부터 만들려 했습니다.
- v2는 순서를 바꿉니다. **먼저 안전장치(기본값 = 주문 꺼짐, 실제 입구 시험, 서버가 자기 모드를 /health에 보고)**, **그 다음에 폰 버튼**입니다. 안전장치가 증명되기 전에는 버튼은 꺼져 있습니다.
- 서버의 원하는 상태는 **서버 안의 한 파일(루트 소유)**이 정합니다. GitHub는 요청과 기록만 합니다. 모르는 값이면 **항상 꺼짐**입니다.
- "주문" 모드는 #3108이 닫히고 독립 검증이 끝나기 전에는 **아예 선택할 수 없습니다.** 사장님 허락도 **정확한 빌드 + 만료 시간**에 묶입니다.
- **v4 추가:** 에이전트의 직접 서비스 제어를 **첫 배포 전에** 끊습니다(계정, 키, cron, 타이머까지 점검). 모드 값은 서버의 **한 파일에서만** 정합니다. 주문 허락은 재시작해도 한 번만 쓰이고 주문마다 만료를 확인합니다. 재시작 반복으로 시간 제한이 초기화되지 않게 **시도 전체**에 묶습니다. D5 정정: execution은 cloud가 아직 씁니다.
- **v3 추가:** 새 코드를 서버에 올리는 것은 **릴리스를 안전하게 고친 뒤**에만 합니다(그 전에는 실패해도 자동 되돌림 없이 "꺼짐"으로 끝). 에이전트의 직접 서비스 제어 권한은 계정별로 점검해 **실제로 제거**합니다. 데스크톱·execution은 아직 쓰이는 코드를 옮긴 **다음에** 지웁니다.
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
| `apps/cloud` | 384 source files, 53,934 lines | Many subfolders but no internal import boundary (the existing validator checks boundaries between apps). |
| Other apps (source lines) | autopilot 16,294; desktop 29,960; execution 6,311; mobile 21,202 | desktop and execution are candidates to freeze. |
| Distinct `NUSA_*` tokens in cloud source | 91 (all identifier tokens; the earlier "54" counted only environment reads) | Scattered, unvalidated (91 is an identifier token count, not a count of configuration reads). |
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
8. **Data-compatible releases.** Schema changes are expand then contract; the previous build must open the migrated data within the range proven by the R2 compatibility test (ledger reads, recovery, required writes); outside that range there is no automatic rollback.

## 4. Target shape

1. **Runtime.** One composition root builds the runtime from a validated config and a typed `RunMode` (`STOPPED`, `COLLECT_ONLY`, `PAPER_ORDERS`). `PAPER_ORDERS` needs an explicit, unexpired owner grant bound to the exact release, and is unavailable until #3108 is merged and independently verified. Replaces `NUSA_PAPER_ORDER_PATH`.
2. **Host mode controller.** A small root-owned program owns the mode record and is read by boot, `Restart`, release and the health guard. The unit uses `UnsetEnvironment=` for mode variables so only the controller's value reaches the process.
3. **Phone workflow.** Runs only from the protected default branch (Environment branch policy and a pinned ref, not a mutable ref), on a dedicated runner group, behind an Environment with required reviewers. It calls `nusa-run-mode`. The one-time install of the helper is a documented, honest bootstrap exception that needs a terminal once.
4. **Release.** Backup is a scheduled, verified job with a restore rehearsal; a release requires a verified backup younger than 24 h. Readiness follows reported start-up phases (listening, recovering, collecting), not a fixed deadline. A progressing slow start is never rolled back. If a new build truly fails, fall back to a safe `STOPPED` or `COLLECT_ONLY` on a build known to open the data, and repair forward. "Last known good" is recorded only after a completed soak.
5. **Alerting.** Mode-aware owner alerts (unexpected stop, mode mismatch, stale market events, orders while not permitted) are a prerequisite for automatic start.
6. **Code.** Delete the retired auto-coding WIP and lease machinery instead of reimplementing it. Keep work orders as audit. Freeze, then delete unused code (`apps/execution`, desktop) in small reviewed PRs.

## 5. Phases (each one governed PR or a small group, each reversible)

v4 order. No production deploy of new code, and no phone button, before R1 to R3 are complete. Until then the only host action is the existing owner-approved manual path, restricted by R2 (section 7: the old release workflow cannot activate or roll back).

| Phase | What | Gate to finish | Rollback |
| --- | --- | --- | --- |
| R0 | Stage A evidence: two readings, recorded (done, PR #3138) | owner reads the record | none |
| R1 | Code only, not deployed: fail-closed default (unset or unknown means no orders), effective `runMode` and build identity in `/health`, production-entry boot tests per mode in CI (real entry, not a stand-in) | CI boots the real entry in each mode; unset or garbled value yields no lease, no timers, no order boundary | revert |
| R2 | Release safety before any deploy: the old activate and rollback verbs are disabled for agents; compatibility test on a migrated data copy with the previous build covering ledger reads, recovery and the required writes; no automatic rollback to an unproven build; failure ends in `STOPPED` with an alert; release-attempt-wide readiness bounds (section 8); backup as a separate verified job with a restore rehearsal | one rehearsal on a data copy: new build, previous build and a deliberate failure each end safe | keep old workflow, manual path only, nothing activated by agents |
| R3 | Single control plane before the first deploy: complete start and stop path inventory, removal of every agent path, audit evidence (section 7) | audit evidence attached; the sudo journal shows no direct unit control by an agent account | no agent grant is ever restored; a human-owner emergency path outside agent accounts (owner console or key held by the owner only) is the only fallback |
| R4 | Deploy the R1 build through the R2 path. Transition mode delivery: a root-owned `/etc/nusa/run-mode.env` containing `NUSA_RUN_MODE=COLLECT_ONLY`, written once by the owner-approved release step, is the only definition; the controller of R5 later takes over writing it | `/health.runMode` and build identity verified through the read-only diagnose workflow | stay stopped, fix forward |
| R5 | Host mode controller, `nusa-run-mode` helper, mode-aware alerting tested to the owner phone; PR #3136 refactored into this | alert drill reaches the phone; helper tested with stub `systemctl` and the systemd-parser soundness test | remove helper |
| R6 | Phone workflow enabled (protected ref, runner group, Environment); owner presses stop and start once | settings evidence (section 7) | disable the repo variable |
| R7 | Cloudflare removal S1 to S5 (docs/PROPOSAL_SIMPLIFICATION_2026-11-14.md) | per phase | per phase |
| R8 | Single config module and composition root; split `apps/cloud/src`; delete retired WIP; archive work orders; move the shared code (section 9), then freeze and delete what is really unused | CI time and workflow count drop; Research and cloud build and run unchanged | revert |

The phone start button never precedes R1 to R5.

## 6. Not in scope

- Stage B (orders ON): blocked on #3108, an independent verification, a release and fresh owner approval.
- Any change of risk limits, thresholds, capital or authority. LIVE trading of any kind.

## 7. Single control plane (enforced, not decided)

- Inventory every way a process can start, stop or restart `nusa.service`, `nusa-research`, `nusa-autopilot`: systemd units and `Restart=` policies, timers (health guard), transient units (`systemd-run`), root and user cron and `at`, every Actions runner and workflow that calls the release helper, sudoers entries, SSH keys and accounts including root login, `loginctl` lingering users, and the release helper itself.
- Exact allowed verbs after R3: `nusa-release-step` verbs stage, switch, preflight and the owner-approved activate only from the Environment-protected release workflow; `nusa-run-mode status|stop|start-collect-only` from R5. No other path. If the release helper can start the service, the sudoers rule for it is limited to the release workflow's runner account and that workflow's pinned ref, and no agent account can call it.
- Evidence: `sudo -l` per account, `authorized_keys` and sshd root-login setting, `crontab -l`/`atq` per user, `systemctl list-timers` and transient units, runner registrations, and the sudo journal, all read through the diagnose workflow; attached to the R3 PR. `sudo -l` alone is not proof; any path not listed fails the gate.
- Mode delivery under systemd: the new mode variable is defined in one place only, the root-owned `EnvironmentFile`. A check fails the unit if it appears in `Environment=`, a drop-in, or a second file (`systemctl show -p Environment -p EnvironmentFiles` including drop-ins). `UnsetEnvironment=` is used only for the retired `NUSA_PAPER_ORDER_PATH`; it never names the new variable (it removes a name from the final environment regardless of source). `/health.runMode` must equal the record after every start; mismatch stops the service and alerts.
- Workflow boundary evidence: Environment branch policy limited to the protected default branch, required reviewers, runner group restricted to this repository and that workflow, and a test that a dispatch from another ref is refused. Settings export attached to the R6 PR.
- Order grant: maximum validity 24 h, bound to the exact release; "single use" means one mode entry into `PAPER_ORDERS`; its used and expired state is stored atomically on the host and survives restarts; the clock is trusted only if the host reports synchronized time, otherwise no orders; expiry is checked before every order is executed and expiry ends orders without a restart. The grant never replaces the per-order canonical permit of #3108; both must pass. Unavailable until #3108 is merged and independently verified.

## 7a. Conditions from the fourth review (SOUND WITH CONDITIONS)

- R3 rollback never restores an agent grant. After R3 each agent account is tested directly: `systemctl`, the release helper, `sudo`, `systemd-run`, polkit and D-Bus actions, writes to unit files, drop-ins, environment files and helper files, and any host-access workflow or Actions token must all be refused. The R3 PR attaches those refusal results, not only `sudo -l` and the sudo journal.
- R4 adds `EnvironmentFile=/etc/nusa/run-mode.env` to the unit explicitly. A validator reads every file named by `EnvironmentFile=`, plus `Environment=`, `PassEnvironment=` and drop-ins, and fails if the new variable is defined more than once or anywhere else; `systemctl show -p EnvironmentFiles` alone is not enough because it lists paths, not contents.
- Restart loop ends by systemd, not by hope: the service exits with a dedicated code (`RestartPreventExitStatus=` for that code) when the persisted attempt ceiling is reached, and `StartLimitIntervalSec`/`StartLimitBurst` are set so the unit enters `failed` and stays there. A regression test starts a stub service that always fails and asserts it stops restarting and writes the alert.
- R8 completion also requires the full CI, every validator and a script and reference search that finds no remaining path to a deleted app.

## 8. Readiness and alerts

Phases: listening, recovering, collecting, ready. A start is progressing only if a counter of real recovery or collection work advances (rows recovered, events collected), not a heartbeat. It fails on a stall of 120 s or a ceiling of 20 min. The ceiling and the attempt counter belong to the release attempt, not the process: they are persisted on the host, so `Restart=on-failure` loops cannot reset them; after three failed starts or the ceiling the service ends in `STOPPED` (restart policy off for that attempt), data untouched, with an owner alert. The alert drill must deliver to the owner phone, not only write a log line.

## 9. Shared code before deleting apps

Cloud imports `apps/execution` (the HTTP rate limiter) and the Research worker loads `apps/desktop` replay modules. R8 first lists the transitive dependencies, build and test scripts of both apps, moves exactly the used code into a kept package, builds and runs cloud and Research from the new location, then freezes, then deletes the rest. Deletion without this is blocked.

## 10. Decisions

D1 to D4 approved (direction, R1 first with direct agent control removed, desktop frozen after the phone path is proven, phase order revised as above). D5 (corrected, needs the owner's confirmation): `apps/execution` is NOT unused today because cloud imports its rate limiter; the unused remainder (certification and burn-in harnesses) is frozen and deleted in R8 after the rate limiter moves. New for the owner: approve the v4 order (access removal and release safety before the first deploy, proof before the phone button) and the one-time helper install.

## 11. Risks

- Inverting the default can stop a service that relied on unset meaning ON: R1 ships with the unit and env file set explicitly, verified by the diagnose workflow before use.
- A bug in a control verb could stop a healthy service: every verb is tested against a stub `systemctl` and runs under the activation lock.
- The mode record is a new single point: unknown means `STOPPED`, and the diagnose workflow reads it.
- Large refactors (R7) wait for the R1 to R5 safety net. The Cloudflare gate is a required merge check and moves last.

## 12. Gaps checked in the repository (read-only, origin/main)

- No unit, script or env template in the repository sets `NUSA_PAPER_ORDER_PATH` (documents describe manual host settings). The unit reads `/etc/nusa/cloud-runtime.env`, which is outside version control; whether a host drop-in or another source also sets it is NOT verifiable from the repository and is part of the R3 audit. Consequence: R1 must make the value explicit in the host record and verify it through `/health.runMode`; the repo alone cannot prove what the host runs.
- `/health` and `server.ts` carry no `runMode` today. R1 adds it.
- The script counts 34 test files that mention the runtime or daemon entry functions and 4 that mention the switch (textual matches, not proof that each executes that path). Inverting the default means those tests must set the order path explicitly where they rely on ON. R1 lists them and changes only that line, with a control test that proves ON behaviour is unchanged when set explicitly.
- Requirement (R5, when the controller exists; not an observed fact): a stale or corrupt host mode record is treated a missing, unparsable, expired or wrong-build record as `STOPPED` and the health guard alerts instead of restarting. The R5 drill must cover each case.
