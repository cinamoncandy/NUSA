# Oracle PAPER health guard

This document is the source-controlled recovery contract for the existing Oracle PAPER health watchdog. It does not create a second scheduler or control plane. The owner remains the single `nusa-health-guard.timer` / `nusa-health-guard.service` pair.

## Why this guard exists

The public-market WebSocket client can exhaust its bounded reconnect attempts while the HTTP process remains alive. In that state `/health` can still answer HTTP 200 even though `runtimeHealth.workload.state` is `STALE` and `runtime.lastError` is `PUBLIC_MARKET_FAILED`.

The guard therefore distinguishes process health from workload health. It authorizes one PAPER restart only when all of the following hold:

- PAPER `/health` is reachable;
- workload state is `STALE`;
- the last runtime error is exactly `PUBLIC_MARKET_FAILED`;
- the last market-event timestamp is present;
- the same stale market timestamp has not already received a recovery attempt;
- the 15-minute restart cooldown has expired;
- no canonical Oracle release activation is running;
- Upbit public REST is reachable.

After the restart it waits for workload state `HEALTHY` with no runtime error. Failure stays fail-closed. An unhealthy PAPER HTTP endpoint is never blindly restarted, and MCP restart remains suppressed while its PAPER upstream is unavailable.

## Reviewed source

- `deploy/oracle/nusa-health-guard`
- `deploy/oracle/nusa-health-guard.service`
- `deploy/oracle/nusa-health-guard.timer`
- `tests/oracle-health-guard.test.js`

The deployed executable path remains `/usr/local/sbin/nusa-health-guard`. Keeping the privileged host path outside immutable release trees avoids allowing an ordinary release bundle to rewrite a root-owned watchdog implicitly.

## Explicit install / convergence

Only install a reviewed exact source. Do not edit the database, lease rows, release symlink, or runtime environment as part of this operation.

```bash
sudo install -o root -g root -m 0755 deploy/oracle/nusa-health-guard /usr/local/sbin/nusa-health-guard
sudo install -o root -g root -m 0644 deploy/oracle/nusa-health-guard.service /etc/systemd/system/nusa-health-guard.service
sudo install -o root -g root -m 0644 deploy/oracle/nusa-health-guard.timer /etc/systemd/system/nusa-health-guard.timer
sudo systemctl daemon-reload
sudo systemctl enable --now nusa-health-guard.timer
sudo systemctl start nusa-health-guard.service
```

When the runtime is healthy, installation acceptance requires the oneshot guard to return success **without changing the PAPER PID**.

```bash
before="$(systemctl show nusa.service -p MainPID --value)"
sudo systemctl start nusa-health-guard.service
after="$(systemctl show nusa.service -p MainPID --value)"
test "$before" = "$after"
systemctl --failed --no-pager
```

Also require byte identity between reviewed source and installed executable:

```bash
cmp --silent deploy/oracle/nusa-health-guard /usr/local/sbin/nusa-health-guard
```

## Recovery marker

The marker is `/var/lib/nusa-health-guard/public-market-restart`. The guard creates `/var/lib/nusa-health-guard` root-owned mode `0700` and creates each temporary marker atomically with `mktemp` before rename, so the unprivileged `nusa` runtime cannot pre-create or redirect the root write. The marker records only the stale market-event timestamp and bounded restart-at timestamp used to prevent repeated restart of the same outage. It is not trading state, market history, candidate evidence, or authorization state.

## Safety invariants

- `PAPER_ONLY`
- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- `aiAuthority=ZERO_AUTHORITY`
- no direct DB mutation
- no historical rewrite
- no Risk/Governance/Release bypass
- no duplicate scheduler/watchdog/control plane
- fail closed when the upstream condition is ambiguous
- an inactive PAPER supervisor is never restarted by this watchdog; the service unit owns its own failure restart policy
