# PAPER Run Mode: stop or collect from the GitHub app (no terminal)

The workflow `PAPER Run Mode` (`.github/workflows/paper-run-mode.yml`) calls the host controller's `stop` or `collect`. It replaces the pasted
`sudo /opt/nusa-control/nusa-control.sh collect` line the owner had to run after every stop.

## What it does

| Action | Effect |
|---|---|
| `status` | `nusa-control status`: read-only, changes nothing. Use it first to check the setup (approval click, runner, sudo rule). |
| `stop` | `nusa-control stop`: the desired state becomes STOPPED, every unit is stopped, the boot start is disabled. |
| `collect` | `nusa-control collect`: the desired state becomes COLLECT_ONLY, the controller starts the runtime through its start gate. Orders stay OFF. It restarts a runtime that is already running (a short gap in the collected data), so it is not a test. |

There is no action that starts the PAPER order path. Stage B needs its own written approval (naming "Stage B") and its own change.
The host needs no change: the runner's sudo rule already allows exactly `nusa-control status`, `stop` and `collect`.

## One-time owner setup (GitHub, about two minutes, no terminal)

1. Repository **Settings, Environments, New environment**: name it exactly `paper-host-control`. Under **Required reviewers** add yourself, save.
   (This is what makes every run wait for your approval click. Code cannot check this setting, and an agent that dispatches through your account looks
   like you, so without it the button would not be protected.)
2. Repository **Settings, Secrets and variables, Actions, Variables, New repository variable**: name `PAPER_RUN_MODE_ENABLED`, value `true`.
   Do this only after step 1. Until then the workflow's first job fails on purpose.

## Use

GitHub app or web: **Actions, PAPER Run Mode, Run workflow**, choose `stop` or `collect`. A notification asks for your approval; approve it. The job prints the
controller's answer and the controller status. A start takes between 7 seconds and 5 minutes before `/health` answers; read it with **Oracle Host Diagnose**.

## Limits

It shares the concurrency group of the release: an action waits for a running release. The controller's own lock serialises them as well. The workflow has
a read-only token, uses no secret and no third-party action, and is pinned by `tests/paper-run-mode-workflow.test.js`.
