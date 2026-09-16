# Oracle Codex development runner

This runner is a **Development Plane** execution host for NUSA Codex work. It is intentionally separate from the Oracle PAPER runtime host.

## Boundaries

- GitHub trigger: manual `workflow_dispatch` only.
- Allowed actor: `cinamoncandy`.
- GitHub token permissions: `contents: read`.
- Codex sandbox: `workspace-write` inside the Actions checkout.
- No NUSA production credentials, exchange credentials, broker credentials, runtime database, deployment authority, or Money Plane authority are installed.
- The workflow never commits, pushes, opens/reopens PRs, merges, deploys, or triggers remote CI.
- Results return as a seven-day patch/log artifact for independent review and integration.

The standing invariants remain `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.

## Recommended Oracle host

Use an isolated Ubuntu 24.04 ARM64 `VM.Standard.A1.Flex` host sized at 2 OCPU / 12 GB RAM. The existing 1 GB E2 Micro host remains dedicated to the PAPER runtime.

Run `scripts/oracle/bootstrap-codex-dev-runner.sh` as root/cloud-init with a short-lived repository runner registration token in `GITHUB_RUNNER_TOKEN`.

## First activation

1. Confirm the runner is online with label `nusa-codex-dev`.
2. Dispatch `Oracle Codex Dev Runner` with `mode=status`.
3. Dispatch `mode=login` and complete the device code at `https://auth.openai.com/codex/device`.
4. Re-run `mode=status` and require `Logged in using ChatGPT`.
5. Dogfood only a low-risk task first. Review the returned patch/log artifact before integrating it through the normal branch/PR/CI path.
