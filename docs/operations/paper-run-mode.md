# PAPER run mode: stop and start the PAPER service from a GitHub button (R1)

Status: PROCEDURE for the owner. Part of docs/NUSA_REDESIGN_PROPOSAL_2026-11-15.md (R1). Safety is unchanged: PAPER_ONLY, `liveAuthority=NONE`,
`productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`. The only mode that can START the service is collection-only.

## What it is

Workflow `PAPER Run Mode` (`.github/workflows/paper-run-mode.yml`, dispatch only) calls the root-owned host helper `/opt/nusa/bin/nusa-release-step`:

| Mode | Helper verb | What happens |
| --- | --- | --- |
| `STOPPED` | `stop` | `systemctl stop nusa.service` under the activation lock. Nothing else is touched (autopilot, research timer, units, links stay). |
| `COLLECT_ONLY` | `start` | `systemctl start nusa.service` under the activation lock, ONLY if the one env file the unit reads (`/etc/nusa/cloud-runtime.env`) sets `NUSA_PAPER_ORDER_PATH` to exactly `OFF` (last plain assignment wins) and an active release exists. The file is read as text, never executed, and the way systemd reads it, not the way a shell does: a file that could be read two ways (a leading `export`, quotes, an inline comment, spaces, a carriage return, a trailing backslash, an unbalanced quote) makes the verb refuse and start nothing. It also refuses if the unit reads any other env file or sets the variable in `Environment=`. |

There is no mode that starts the PAPER order path. Stage B (orders) needs its own approval and its own change.
Both verbs share the release's activation lock and the workflow shares the release's concurrency group, so a mode change waits for a release.
A start takes between about 7 seconds and 5 minutes before `/health` answers; read it with `Oracle Host Diagnose`.
If `start` refuses, the run log names the reason (for example a backslash, both quote kinds on one line, or an order-path line that is not exactly `NUSA_PAPER_ORDER_PATH=VALUE`). The host env file must then be simplified; a refusal changes nothing on the host.

## One-time setup (owner)

1. **GitHub Environment, then the switch.** Settings, Environments, create `paper-host-control`, turn on "Required reviewers" and add the owner.
   Required reviewers are a GitHub setting that code can neither read nor enforce, so the workflow is DISABLED until you say so: its first job fails
   closed unless the repository variable `PAPER_RUN_MODE_ENABLED` is exactly `true` (Settings, Secrets and variables, Actions, Variables) and the actor is
   the repository owner. Set that variable ONLY AFTER the reviewers are in place. Until then the button cannot touch the host.
2. **Install the reviewed helper on the host.** The release refuses to run unless the installed helper is byte-identical to the reviewed source, so
   after this change merges the host helper must be replaced once, before the next release or the first button use. The exact command, commit and
   SHA-256 are given at merge time. It is the last shell step by design.
3. **Narrow the other host accounts.** The `sentinelx` account (Codex's host access) was able to run `systemctl stop`, `disable` and `enable` on
   `nusa.service`. Remove those permissions; Codex and any other agent request a mode through this workflow instead and may keep read-only commands.
   This is a host-side change outside the repository.

## Use

Actions, `PAPER Run Mode`, Run workflow, pick `STOPPED` or `COLLECT_ONLY`, approve the Environment gate. The run summary shows the service state.
Keep `deploy/health-watch.json` `expectedState` consistent with the mode you set (`STOPPED` or `RUNNING`) in a small reviewed PR, or the watch will report a mismatch.

## Not in scope

Changing the order path, the release, any limit or authority; starting the PAPER order path; waiting for readiness inside the verb (use `Oracle Host Diagnose`).
