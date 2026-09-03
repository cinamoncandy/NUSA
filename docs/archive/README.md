# docs/archive — 정책

`COMPLEXITY_REDUCTION_PROPOSAL.md` §4에 따른 역사 문서 보관소.

## 규칙

- 활성 증거로 참조되는 파일(`.aipos/*.yaml`, work-order, CI 업로드 글로브가 가리키는 최신본)은
  `docs/audits/`에 유지한다. 이동 금지.
- 30일 이상 경과 + 어디에서도 참조되지 않는 감사 문서는 월간 정리 시
  `docs/archive/audits-YYYY-MM/`로 `git mv`한다 (히스토리 보존).
- 아카이브 문서는 읽기 전용 역사 기록이다. 수정하지 말고, 필요하면 새 문서를 만든다.

## 이력

- 2026-09-03: `audits-2026-08/`에 2026-08-01/02 미참조 감사 문서 21건 이동.
  (`.aipos`·work-order·CI·tests 어디에서도 참조 없음 확인済)
