# Review Index

이 문서는 PR #1 owner handoff의 시작점입니다. 문서와 CI는 실제 운영 evidence나 owner approval을 대신하지 않습니다.

## 먼저 읽을 문서

1. [Owner review packet](./paper-trading-owner-review-packet.md)
2. [Paper release evidence runbook](../operations/paper-release-evidence-runbook.md)
3. [Evidence rehearsal](../implementation/evidence-rehearsal-v1.md)
4. [Repository architecture and safety rules](../../AGENTS.md)
5. [Project scope and boundaries](../../NUSA.md)

## 권장 검토 순서

1. PR 상태와 최신 Windows CI 결과 확인
2. Production entry points와 critical runtime flow 확인
3. SQLite migration, recovery, rollback 경계 확인
4. IPC와 Paper-only security boundary 확인
5. Scenario evidence schema와 replay/counter 정책 확인
6. 실제 운영 DB를 명시적으로 평가
7. 실제 Paper counts와 research reports 확인
8. Bundle export 및 independent verify 수행
9. Blocking reasons 확인
10. Owner가 PR Draft 유지 또는 후속 조치를 직접 결정

## 핵심 코드 맵

### Runtime

- `apps/desktop/src/main.ts`
- `apps/desktop/src/runtimeCommandService.ts`
- `apps/desktop/src/controlPlane.ts`
- `apps/desktop/src/strategyEngine.ts`
- `apps/desktop/src/paper/paperBroker.ts` (re-exported from `packages/core/src/paperBroker.ts`)
- `apps/desktop/src/exchange/upbitWebSocket.ts`

### Persistence

- `apps/desktop/src/desktopPersistenceStore.ts`
- `packages/storage/src/migrationRunner.ts`
- `apps/desktop/src/paperSessionStore.ts`
- `apps/desktop/src/controlSessionStore.ts`

### Evidence and release

- `apps/cloud/src/paperScenarioEvidenceLedger.ts`
- `apps/cloud/src/scenarioEvidenceBundle.ts`
- `apps/cloud/src/scenarioPaperValidation.ts`
- `apps/cloud/src/operatorEvidenceBundle.ts`
- `apps/cloud/src/releaseEvidenceAuthority.ts`
- `apps/desktop/src/evidenceOperator.ts`
- `apps/desktop/src/evidenceRehearsal.ts`

### Operator commands

- `scripts/evidence-cli.js`
- `scripts/evidence-rehearse.js`
- `pnpm evidence:status`
- `pnpm evidence:export`
- `pnpm evidence:verify`
- `pnpm evidence:rehearse`

## Review documents and tests

- Runtime persistence atomicity: `tests/runtime-command-service.test.js`
- SQLite safety and migrations: `tests/desktop-sqlite-safety.test.js`, `tests/storage-migrations.test.js`
- Scenario evidence: `tests/paper-scenario-evidence-ledger.test.js`, `tests/scenario-evidence-bundle.test.js`
- Fault drills: `tests/paper-fault-drill.test.js`
- Evidence export and authority: `tests/operator-evidence-bundle.test.js`, `tests/release-evidence-authority.test.js`
- Operator CLI contract: `tests/evidence-cli-contract.test.js`
- IPC boundary: `tests/desktop-ipc-boundary.test.js`
- Repository security/readiness: `tests/repository-hardening.test.js`, `tests/architecture-audit.test.js`

## Operational status

- Actual user evidence database: **not evaluated**
- Real Paper observation counts: **not evaluated**
- Actual research reports: **not evaluated**
- Actual evidence bundle: **not evaluated**
- Owner review: **not completed**
- Release status: **BLOCKED**

CI and rehearsal success are not operational evidence. The PR must remain Draft until real evidence and owner review are complete.

## Follow-up backlog

The following are intentionally outside this frozen PR unless a correctness or security defect makes them blockers:

- operator UX improvements
- performance and observability
- backup retention automation
- broader research coverage
- additional markets or strategies
- live trading
- private API integration
- automatic promotion
