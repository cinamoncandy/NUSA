# NUSA 브랜치 정리 정책

## 목표
- 556개 브랜치를 수렴 가능한 수준(~100개)으로 유지
- 불필요한 merge된 브랜치 자동 삭제
- AI 에이전트의 브랜치 폭증 방지

---

## 1. GitHub 자동 삭제 설정 (관리자용)

**설정 경로**: Repository Settings → Branches → "Automatically delete head branches"
- ✅ 이 옵션이 활성화되면 PR이 merge될 때 브랜치가 자동으로 삭제됨
- 효과: A그룹(merge된 브랜치) 누적 방지

---

## 2. 브랜치 생성 규칙 (모든 개발자 + AI)

### 명명 규칙
```
Format: <type>/<number>-<short-description>

Types:
  agent/    → AI 에이전트 작업
  feat/     → 새 기능
  fix/      → 버그 수정
  docs/     → 문서
  test/     → 테스트 추가
  chore/    → 리팩토링, 설정 변경
  ci/       → CI/CD 변경

Examples (Good):
  agent/issue-210-visual-redesign
  feat/upbit-live-integration
  fix/paper-broker-arithmetic

Examples (Bad - 피할 것):
  agent/ai-001-completion-final-v3-latest  ← 중복, 버전 남용
  agent/issue-210-home-visual-rebuild-attempt-2  ← 버전 남용
  quick-fix  ← 타입 없음
```

### 브랜치 재사용 규칙 (AI 에이전트용)
```
[작업 시작할 때]
1. 관련 이슈/PR에 기존 미merge 브랜치가 있는지 먼저 확인
2. 있으면 그 브랜치에서 계속 작업
3. 없으면 새 브랜치 생성

[PR을 open할 때]
- 브랜치명이 명확하고 이슈 번호를 포함하는지 확인
- 예: agent/issue-210-visual-redesign

[PR이 merge되었을 때]
✅ 즉시 원격 브랜치도 삭제
  git push origin --delete <branch-name>
✅ "Automatically delete head branches" 설정 켜져있으면 자동 삭제됨

[PR이 close(merge 안 됨)되었을 때]
✅ 아래 중 하나 선택:
   - 나중에 다시 쓸 예정 → 로컬에만 유지
   - 완전히 버릴 예정 → git push origin --delete <branch-name>
   - 아카이브 필요 → git tag archive/<branch-name> <branch-name> && git push origin --delete <branch-name>
```

---

## 3. 월간 정리 작업

**주기**: 매월 1일  
**담당**: 저장소 관리자

### 체크리스트
```bash
# 1. merge된 브랜치 수 확인
git branch -r --merged origin/main | grep -v 'origin/main$' | wc -l

# 2. 방치된 브랜치 수 확인 (30일+)
git for-each-ref --sort=committerdate refs/remotes/origin \
  --format='%(committerdate:short) %(refname:short)' | head -20

# 3. 전체 브랜치 수 확인
git branch -r | wc -l

# 4. 대시보드 값 업데이트 (README.md)
# README의 "Branch Statistics" 섹션 갱신
```

---

## 4. Claude Code(AI 에이전트) 작업 체크리스트

### 매 작업마다 따를 규칙
```markdown
[작업 시작]
☐ 이슈에 관련 미merge 브랜치가 있는지 먼저 확인
☐ 기존 브랜치 있음 → 그 브랜치에서 계속
☐ 없음 → 새 브랜치 생성 (규칙 따를 것)

[PR Open]
☐ 브랜치명이 <type>/<number>-<description> 형식
☐ PR 제목이 명확
☐ 관련 이슈 번호 링크

[PR Merge]
☐ CI 통과 확인
☐ 리뷰 승인 확인
☐ Merge 후 즉시: git push origin --delete <branch-name>

[PR Close(merge 안 함)]
☐ Close 사유 기록
☐ 필요시 아카이브: git tag archive/<branch-name> <branch-name>
☐ 원격 브랜치 삭제: git push origin --delete <branch-name>
```

---

## 5. 현재 현황 (2026-09-10 측정)

수치는 `node scripts/branch-cleanup-report.js`로 언제든 다시 만들 수 있습니다. 아래 표는
그 출력이며, 손으로 적은 숫자가 아닙니다 — 이 문서의 8월 수치(556개)가 그 뒤로 계속
낡아 있었던 것이 표를 스크립트로 바꾼 이유입니다.

| 항목 | 수량 |
|------|------|
| 총 원격 브랜치 | 1,154개 |
| 커밋 패치가 이미 main에 있음 (즉시 삭제 가능) | 182개 |
| 고유 커밋 보유 | 972개 |
| 그 중 30일 이상 방치 + 오픈 PR 없음 | 173개 |
| 오픈 PR 보유 (삭제 금지) | 12개 |
| 가장 오래된 브랜치 | 61일 |

8월에 세운 556개가 3개월 만에 두 배가 되었고, 90일을 넘은 브랜치는 하나도 없습니다.
즉 1,154개 전부가 최근 3개월에 만들어졌습니다. 정책이 막으려던 폭증이 그대로 일어났고,
브랜치가 오래되어 쌓인 것이 아니라 생성 속도가 삭제 속도를 앞선 결과입니다.

### 판정 기준

삭제 가능 여부는 `git cherry origin/main <branch>`로 판정합니다. 조상 관계가 아니라
패치 동일성을 보므로, squash merge나 cherry-pick으로 main에 들어간 작업도 인식합니다.

다음 두 신호는 **단독으로 신뢰하지 않습니다**:

- **main의 병합 커밋에 브랜치 이름이 있음.** 이 저장소는 브랜치를 여러 PR에 걸쳐
  재사용하므로, 한 번 병합된 브랜치가 지금은 미병합 작업을 담고 있을 수 있습니다.
  실제로 그런 브랜치가 9개 있었고 그 중 하나는 미병합 커밋 24개를 갖고 있었습니다.
- **PR 목록 API의 `merged` 필드.** 이 엔드포인트에서는 채워지지 않습니다. 가장 최근
  닫힌 PR 100건이 전부 `merged: false`로 보고되며, 그 중에는 main에 병합 커밋이
  분명히 있는 것도 포함됩니다.

### 즉시 삭제 (182개)

```bash
# 목록 확인
node scripts/branch-cleanup-report.js --list

# 삭제 (오픈 PR 보유 브랜치는 NUSA_OPEN_PR_BRANCHES로 반드시 보호할 것)
node scripts/branch-cleanup-report.js --list | xargs -n 20 git push origin --delete
```

1,154 → 972개가 됩니다. 나머지 972개는 고유 커밋이 있어 기계적으로 판정할 수 없고,
PR이 닫힌 채 버려진 작업인지 살아 있는 작업인지는 사람이 정해야 합니다.

### 가장 큰 지렛대

`Automatically delete head branches`가 여전히 꺼져 있습니다. 병합된 PR이 1,251건인데
브랜치가 1,154개 남아 있는 것이 그 증거입니다. 이 설정 하나가 위 182개를 앞으로
자동으로 0으로 만듭니다 — 정책 1항이 8월에 이미 지적한 내용입니다.

## 6. 목표

### 6개월 계획
- **즉시 (August)**: "Automatically delete head branches" 활성화
- **월말**: A그룹 50개 삭제 → 506개로 감소
- **3개월 (November)**: 방치된 브랜치 아카이브 → 300개대로 수렴
- **6개월 (February 2027)**: 일상적 정리로 ~150개 유지

---

## 참고

- [GitHub: Automatically delete head branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/deleting-and-restoring-branches-in-a-pull-request#deleting-a-branch-used-for-a-pull-request)
- [Git Tag 사용법](https://git-scm.com/book/en/v2/Git-Basics-Tagging)
