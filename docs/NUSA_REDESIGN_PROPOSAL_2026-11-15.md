# NUSA redesign proposal: "NUSA Core" (2026-11-15)

Status: PROPOSAL, not an approval. Nothing here changes code, a host, a workflow or a limit. Every phase is its own governed
PR and the owner approves the direction first. Safety stays fixed: PAPER_ONLY, `liveAuthority=NONE`,
`productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`, Release=HOLD. A redesign may only REMOVE authority, never add.

## 0. Summary for the owner (Korean, easy language)

- 오늘 서버 재시작이 **세 번 실패한 이유**는 코드 한 줄이 아니라 **구조** 때문이었습니다.
  1. 서버를 켜는 입구가 **두 개**인데 스위치를 한 입구만 시험했습니다.
  2. 릴리스는 **배포와 시작이 한 덩어리**이고, 한 번에 75분(백업만 50분)이 걸립니다. 실패하면 **결함 있는 옛 빌드로 되돌립니다.**
  3. 서버의 "켜져 있어야 하나, 꺼져 있어야 하나"를 정하는 곳이 **한 군데가 아닙니다.** Codex와 Claude가 서로 반대로 움직였습니다.
  4. 사장님이 **터미널**을 여러 번 쓰셔야 했습니다.
- 재설계의 핵심은 **서버의 원하는 상태(꺼짐/수집만/주문)를 하나의 값으로 정하고, 모두가 그 값만 따르게** 하는 것입니다. 사장님은 **폰에서 버튼 한 번**으로 바꾸고, 터미널은 쓰지 않습니다.
- 코드는 **한 입구, 한 설정, 한 폴더 구조**로 줄이고, **실제 입구를 부팅하는 시험**을 CI에 넣습니다.
- Cloudflare와 데스크톱 앱은 단계적으로 걷어냅니다(이미 승인된 계획).

## 1. What the repository and today showed (evidence)

| Fact | Where | Consequence |
| --- | --- | --- |
| Two start-up entry points compose the PAPER runtime: `startCloudRuntime` (`apps/cloud/src/runtime.ts`, 1012 lines) and `startClosedLearningProductionRuntime` (`apps/cloud/src/closedLearningProductionRuntime.ts`, 623 lines, the one production runs) | code | The switch `NUSA_PAPER_ORDER_PATH` was tested only through the first; the first restart crash-looped on `PAPER_WRITER_LEASE_NOT_STARTED` (release run 43665972913). Fixed in #3133. |
| `apps/cloud/src` is one flat folder (452 source files); 54 distinct `NUSA_*` environment variables are read there; 5 apps, about 143,600 non-test TypeScript lines | `find`, `grep` | No module boundary says which code may touch the lease, the order path or the database. |
| A release is about 75 min: build 1 min, state backup 48 to 50 min (throttled to 1 MiB/s on purpose), stage and preflight 2 min, activate up to 13 min | runs 43665972913 and 43676568638 | A failed attempt costs more than an hour. |
| Activate waits at most 300 s for `/ready` (hard cap in `scripts/oracle-readiness-check.js`); the second attempt needed about 300 s once and 7 s on the next start | release run 2 and the manual starts | The release gave up a few seconds early and "restored" the previous build, which was the defective one. |
| Release means deploy AND start (`activate` restarts the service) | `deploy/oracle/nusa-release-step.sh` | There is no way to deploy without running, or to run without a 75 min release. |
| Desired host state (stopped, collecting, ordering) is not one datum. A Codex session held "keep nusa.service stopped until P0" while the owner and Claude restarted it; the SentinelX account could `stop`, `disable` and `enable` the unit | host sudo log 2026-11-15 | Two agents fought for 25 minutes. Access called read-only could change service state. |
| The owner had to open a shell about ten times today | session | Unacceptable operating cost for a one-person owner. |
| The merge gate (`/control-plane/release-check`) lives in a Cloudflare Worker, a separate failure domain | `apps/autopilot` | Already decided to remove in stages (docs/PROPOSAL_SIMPLIFICATION_2026-11-14.md). |
| 41 workflows, 1016 tests, 204 scripts, 104 docs, 606 work orders | `ls` | Governance volume is large; much of it protects code paths that will be frozen. |

## 2. Principles

1. **One composition root.** One function builds the runtime. Every mode is a value passed to it, never a second path.
2. **Desired state is data.** A single `RunMode` value (`STOPPED`, `COLLECT_ONLY`, `PAPER_ORDERS`) says what the host should do. Anything unknown means `STOPPED`. The mode can only be raised by the owner. Agents, workflows, the health watch and the host helper all read the same value.
3. **Deploy is not run.** Staging a build changes no running process. Starting, stopping and changing mode are separate, owner-approved actions.
4. **Start-up is observable and phase-aware.** The process listens first and reports phases; readiness checks follow the reported phase, not a fixed 5 minute deadline.
5. **Tests go through the production entry.** CI boots the real entry in every mode and asserts what exists and what does not (lease, order boundary, timers, writes).
6. **Fail closed and least privilege.** An agent never gets a general shell verb on a service. It requests a named, audited action.
7. **No terminal for the owner.** Every routine owner action is a button in GitHub (phone) with an approval gate.

## 3. Target shape

1. **Core runtime (one process).** Modules with import boundaries, in `packages/`: `platform` (config, logging, lifecycle, `RunMode`), `collector` (market data, research collection), `paper` (account, execution loop, lease; loaded only in `PAPER_ORDERS`), `research` (experiments, learning), `api` (read-only HTTP for the phone). State in SQLite as today.
2. **Host control without a shell.** Extend the root-owned helper `nusa-release-step` with verbs `mode <STOPPED|COLLECT_ONLY|PAPER_ORDERS>`, `start` and `stop`, all under the activation lock and all recorded. A workflow `paper-run-mode.yml` calls them behind a GitHub Environment that needs the owner's approval. The `SentinelX` account loses `stop`, `disable`, `enable`; it can read and request through the workflow.
3. **Release in two parts.** Nightly verified backup is a separate job; a release only checks that a verified backup younger than 24 h exists. Activate no longer takes the 50 min backup. The rollback target becomes "last known good" (a build that completed a start and a soak), recorded after each passing soak.
4. **One verification path.** All checks in GitHub Actions only (the Cloudflare removal S1 to S5 already planned).
5. **Clients.** Mobile (Android) only, reading the host at the canonical origin. Desktop moves behind `attic/`.

## 4. Phases (each one PR or one small group, each reversible)

| Phase | What | Gate to finish | Rollback |
| --- | --- | --- | --- |
| R0 | Finish Stage A evidence: two readings one hour apart; record them | owner reads the record | none needed |
| R1 | Host control without shell: helper verbs, workflow, narrowed SentinelX | owner presses the button for stop and start once, from the phone, and the sudo log shows only the helper | remove the workflow |
| R2 | Start-up contract tests: boot the real daemon entry in `STOPPED`, `COLLECT_ONLY`, `PAPER_ORDERS` in CI (the #3133 test covers one mode with a stand-in) | CI red if any mode creates something it must not | revert the test |
| R3 | Single composition root and a typed `RunMode` (replaces `NUSA_PAPER_ORDER_PATH`); one config module that validates the 54 variables | R2 stays green; ON behaviour byte-equal on pre-change code (as measured in #3133) | revert |
| R4 | Release redesign: decouple backup, phase-aware readiness, last known good | one full release under 15 min, one deliberate failure restores the last known good | keep the old workflow |
| R5 | Cloudflare removal S1 to S5 (existing plan) | per docs/PROPOSAL_SIMPLIFICATION_2026-11-14.md | per phase |
| R6 | Split `apps/cloud/src` into the packages above | no behaviour change; import-boundary lint | revert |
| R7 | Freeze desktop (and audit `apps/execution`, 81 files) into `attic/`; archive old work orders | CI time and workflow count drop | move back |

Order: R0, R1, R2, R3 first (they remove today's failure modes), then R4, then R5 to R7 in parallel with care for the merge gate.

## 5. Not in scope

- Stage B (orders ON). It stays blocked on the #3108 permit fix, a release and fresh owner approval. `PAPER_ORDERS` mode exists in the type but is unreachable until then.
- Any change of risk limits, thresholds, capital or authority.
- LIVE trading of any kind.

## 6. Decisions for the owner

- **D1.** Approve the direction (one runtime, one `RunMode`, buttons instead of a shell, release split in two).
- **D2.** Approve R1 first: agents (Codex included) lose direct service control and go through the workflow.
- **D3.** Confirm the desktop app may be frozen (R7) after the phone path is proven (S1).
- **D4.** Confirm the order: R0, R1, R2, R3, then R4 and the Cloudflare phases.
- **D5.** Say whether `apps/execution` (certification and burn-in harnesses) is still used; if not it is frozen too.

## 7. Risks

- Changing the host helper needs a one-time install on the host (a terminal step, by design the last one).
- A bug in a new control verb could stop a healthy service: every verb is tested with a stub `systemctl` first (as `tests/oracle-release-o1-mechanics.test.js` does) and runs under the activation lock.
- Splitting the folder (R6) is large: it waits until R2 and R3 give a safety net.
- The Cloudflare gate is a required merge check; it moves last (S3).
