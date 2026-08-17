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

## 5. 현재 현황 (2026-08-16)

| 항목 | 수량 |
|------|------|
| 총 브랜치 | 556개 |
| merge 완료 (삭제 대상) | 50개 |
| 최근 활동 (유지) | ~480개 |
| 90일+ 방치 | 0개 |

### A그룹 삭제 명령어 (관리자용)
```bash
# GitHub 웹에서:
# 1. cinamoncandy/NUSA → Branches
# 2. 정렬: "Last Commit" 
# 3. 아래 50개 브랜치 선택 후 trash 아이콘 클릭

# CLI 대안 (권한 필요):
git push origin --delete \
  agent/aipos-0053-visual-redesign-evidence \
  agent/aipos-final-main-sync \
  agent/design-system-v1-production \
  ... (총 50개)
```

---

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
