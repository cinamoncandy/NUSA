# Autopilot 완료 영수증 설계 (이슈 #2595 항목 6·8)

상태: **설계 제안**. 코드·설정·권한 변경 없음 (`authority_impact: none`). 구현은 이 문서의 열린 결정이 확정된 뒤 별도 작업지시서로 진행합니다.

## 1. 목적
"오토파일럿이 실제로 쓸모 있는 일을 끝냈다"는 주장을 **하나의 불변 기록**으로 묶습니다. 이 기록이 없으면
`AUTOPILOT_VERIFIED_COMPLETION_LOOP`를 `true`로 올릴 수 없습니다. 영수증은 증명할 뿐 권한을 주지 않으며,
Audit·Release·병합을 대신하거나 우회하지 않습니다.

## 2. 새로 만들지 않는 것 (이미 있는 부품을 조립)
새 큐, 스케줄러, 러너, 감사, 릴리스, 병합 엔진을 만들지 않습니다(#2595 항목 5). 영수증은 아래 기존 부품의 출력을 읽어 묶기만 합니다.

| 영수증 항목 | 이미 있는 출처 |
|---|---|
| 실패 분류·재시도 판단 (`VALID_NO_ACTION` / `FAILED_TO_REMEDIATE` / `FAILED_CLOSED`) | `codingRunnerRemediation.ts`의 `decideCodingRunnerNoAction`, `codingRunnerFailureClass.ts` |
| 대상 저장소·head SHA·워크플로 실행·실행 ID·중복 방지 키 | `codingExecutionEvidence.ts`의 `request` |
| 변경 파일·브랜치·커밋 SHA·PR 번호/URL·검증된 워크스페이스 | 같은 증거의 `outcome` |
| 실행 상태 흐름 (`PR_OPEN → CI_PASSED → AUDIT → MERGE_READY → MERGED → FINALIZED`) | `autonomousExecutionState.ts` |
| 병합 신원·병합 후 CI·런타임 배포 출처 | `releaseCompletion.ts`의 `evaluateReleaseCompletion`, `githubReleaseCompletionResolver.ts` |

## 3. 영수증 형태 (제안)
읽기 전용 값 객체이며 `schemaVersion: 1`, 안전 필드는 항상 `liveAuthority: "NONE"`, `productionMutationAllowed: false`,
`aiAuthority: "ZERO_AUTHORITY"`로 고정합니다.

```
receiptId        = sha256(executionId + dedupeKey + mergedSha)      // 같은 입력은 같은 영수증 (재생 안전)
task             { executionId, dedupeKey, workOrderId|null, issue|null }
trigger          { failedRunId, failedHeadSha, reason, failureClass }
remediation      { outcome, attempts, retryBudget }                 // 항목 4의 고정 예산 사용
change           { baseSha, headSha, branch, changedFiles[], pullRequestNumber }
validation       { focusedChecks[]: {name, conclusion}, ciRunId, ciHeadSha }   // ciHeadSha == change.headSha 필수
audit            { authority, verdict, auditedHeadSha }             // 독립 Audit, auditedHeadSha == change.headSha 필수
release          { status, appId, mergedSha }                       // ReleaseCompletionStatus == RELEASE_COMPLETE 필수
runtime          { required, deployedRevision|null, healthOk|null } // 런타임 영향이 있는 변경에만 required=true
classification   VERIFIED_USEFUL_COMPLETION | VALID_NO_ACTION | FAILED_TO_REMEDIATE | BLOCKED | INCOMPLETE:<빠진 항목>
```

## 4. 분류 규칙 (결정적, 위에서 아래로)
1. 권한·운영 변경 흔적이 있는 입력이면 `BLOCKED`(영수증 발급 안 함).
2. `remediation.outcome == VALID_NO_ACTION` → 분류 `VALID_NO_ACTION`. **생산성 집계에 넣지 않습니다**(항목 8).
3. `FAILED_TO_REMEDIATE` 또는 예산 소진 → 분류 `FAILED_TO_REMEDIATE`, 증거 첨부.
4. 변경이 있으면 아래 **모두**가 참일 때만 `VERIFIED_USEFUL_COMPLETION`:
   - `validation.ciHeadSha == audit.auditedHeadSha == change.headSha`, CI 성공
   - Audit 판정이 독립 Audit의 통과이고, 구현 주체가 스스로 낸 판정이 아님
   - `release.status == RELEASE_COMPLETE`이고 `appId`가 신뢰된 릴리스 앱 ID와 같음
   - `runtime.required`면 배포 리비전이 병합 SHA의 후손이고 건강 검사 통과
5. 그 밖에 하나라도 빠지면 `INCOMPLETE:<이름>`. 추정으로 채우지 않습니다.

## 5. 저장·재생 안전
- 저장소: 기존 영속 실행 조정자(`persistent execution coordination`)의 실행 기록에 붙입니다. 새 저장소를 만들지 않습니다.
- 같은 `receiptId`는 한 번만 기록(멱등). 같은 PR/패치를 다시 처리해도 영수증이 두 개 생기지 않습니다.
- 한 번 `VERIFIED_USEFUL_COMPLETION`이 된 영수증은 수정하지 않습니다. 이후 문제가 생기면 새 영수증(회귀)으로 기록합니다.

## 6. 승인 기준 (구현 시)
- 분류 규칙 각 항목에 대한 결정적 단위 테스트(빠진 필드, SHA 불일치, 자기 승인, 앱 ID 불일치, 중복 재생).
- `VALID_NO_ACTION`이 어떤 경로로도 `VERIFIED_USEFUL_COMPLETION`이 되지 않는다는 테스트.
- 생산성 지표 `>0`은 **실제 영수증 1건 이상**이 있을 때만 주장합니다(이슈 승인 기준). 합성 영수증은 쓰지 않습니다.

## 7. 결정 (소유자, 2026-10-12 채팅에서 추천 기본값 승인)
기본값은 모두 "기존 부품 재사용, 새 권한 없음, 건수만 노출"입니다. 구현은 별도 작업지시서로 진행하며, 이 문서가 구현을 승인하는 것은 아닙니다.

1. **저장 위치**: 기존 영속 실행 조정자의 실행 기록에 붙입니다. 새 저장소를 만들지 않습니다(#2595 항목 5). 이유: 중복 실행 방지와 영속 저장이 이미 있어 같은 영수증이 두 번 생기는 것을 막기 쉽습니다.
2. **런타임 증거 범위**: `scripts/autopilot-worker-deploy-scope.js`가 `worker_runtime_changed=true`로 판정한 변경만 `runtime.required=true`로 봅니다. 문서·테스트만 바꾼 변경에는 배포 확인을 요구하지 않습니다. 이유: 새 규칙 없이 기존 판정을 재사용하고, 전체 필수로 하면 영수증이 영영 나오지 않습니다.
3. **독립 Audit 판정의 출처**: 신뢰된 릴리스 앱(`TRUSTED_RELEASE_AUTH_APP_ID`)이 남기는 승인 상태를 씁니다. 구현 주체의 자체 판정은 인정하지 않습니다. 이유: 자체 승인이 불가능하고, Audit 결과 형식이 바뀌어도 영수증이 깨지지 않습니다.
4. **노출**: 처음 구현에서는 노출하지 않습니다. 실제 영수증이 한 건 이상 생긴 뒤 건수 하나만 상태 화면에 올리고, SHA·파일·PR 같은 내용은 올리지 않습니다.

## 8. 한계 (정직한 범위)
- 이 문서는 설계이며, 영수증은 아직 발급되지 않았고 `AUTOPILOT_VERIFIED_COMPLETION_LOOP`는 `false`입니다.
- 2026-10-12 오토파일럿이 GitHub 502 배포 실패를 감지해 러너를 호출하고 `FAILED_CLOSED`로 멈춘 것은 관찰됐지만, 코드 수리가 아니었으므로 영수증 대상이 아닙니다.
