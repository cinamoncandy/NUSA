# Oracle Codex development runner

This runner is a **Development Plane** execution host for NUSA Codex work. It is intentionally separate from the Oracle PAPER runtime host.

## Boundaries

- GitHub trigger: manual `workflow_dispatch` only.
- Allowed actor: `cinamoncandy`.
- GitHub token permissions: `contents: read`.
- Codex sandbox: `workspace-write` only inside a per-task isolated git worktree under `RUNNER_TEMP`; the shared Actions checkout is never the Codex write target.
- No NUSA production credentials, exchange credentials, broker credentials, runtime database, deployment authority, or Money Plane authority are installed.
- The workflow never commits, pushes, opens/reopens PRs, merges, deploys, or triggers remote CI.
- Results return as a seven-day patch/log artifact for independent review and integration.

The standing invariants remain `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.

## Recommended Oracle host

Preferred: use an isolated Ubuntu 24.04 Oracle host sized for concurrent Codex work. The bootstrap auto-detects x64 or arm64.

Current fallback: the existing 1 GiB Oracle PAPER host may be used only for a single-worker bootstrap/status/login/low-risk smoke while concurrency remains 1 and host/CI pressure is measured. Do not raise WIP on that host until telemetry proves safe headroom; disk-I/O-heavy work must be conflict-key serialized. A separate development host remains the preferred steady-state worker-pool target.

Run `scripts/oracle/bootstrap-codex-dev-runner.sh` as root/cloud-init with a short-lived repository runner registration token in `GITHUB_RUNNER_TOKEN`.

## First activation

1. Confirm the runner is online with label `nusa-codex-dev`.
2. Dispatch `Oracle Codex Dev Runner` with `mode=status`.
3. Dispatch `mode=login` and complete the device code at `https://auth.openai.com/codex/device`.
4. Re-run `mode=status` and require `Logged in using ChatGPT`.
5. Dogfood only one low-risk task first and verify the task created a unique worktree/branch, produced an artifact, and cleaned the worktree/branch deterministically.
6. Record RAM/swap/load/disk pressure and GitHub queue/CI timing before considering any WIP increase.
7. Review the returned patch/log artifact before integrating it through the normal branch/PR/CI path.
