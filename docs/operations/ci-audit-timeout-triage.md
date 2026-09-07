# CI Security-Gate Audit Timeout Triage

Observed 2026-09-04: the `Security gate` step (`pnpm run security:gate`) failed
with `AUDIT_UNAVAILABLE:timeout` after 3 bounded attempts (120s each) on
several runs, then passed on reruns without code changes.

## Discrimination (transient flake vs real problem)

1. Read the failed step log. Transient flake reads exactly:
   `dependency audit transient failure N/3: AUDIT_UNAVAILABLE:timeout`.
2. Confirm `pnpm install` (tarball registry) works. If installs also fail, the
   outage is wider than the advisory endpoint.
3. Confirm main-branch CI is green in the same window. If main is green, the
   failure is per-runner egress flakiness, not the repository.
4. A dependency change that newly breaks the audit contract fails differently
   (parse errors, new advisory findings) — that is never this runbook.

## Response

- Rerun the failed job exactly once (`gh run rerun <run-id> --failed`).
- If it passes, no further action. Do not push empty commits or open follow-up
  PRs to "fix" it.
- If it fails twice in a row, stop remote churn, verify locally with
  `pnpm run security:gate`, and escalate as external infrastructure.
- Never weaken the gate (skip-on-unavailable, longer silent retries, or audit
  level changes) to make CI green. Fail-closed stands.

## Why not fixed in code

`pnpm audit` aborts internally after ~250s regardless of the gate's own
timeout knobs, so retry tuning cannot help. The gate already retries 3 times.
The only durable mitigation is a local advisory mirror, which is a supply-chain
decision for the owner, not a CI tweak.
