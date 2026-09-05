# 24h PAPER Operations Runbook (owner/operator)

Status: **procedure only — changes no code, no thresholds, no behavior.**
All commands and strings below were verified against the repository at
main `239ce472`. Values marked `NOT OBSERVED` were never seen; they are
not zero.

Related: `deploy/cloud-paper/README.md` (install),
`NUSA_CONSTITUTION.md` (supreme purpose + fail-closed order).

---

## 0. Non-negotiable prerequisites

| # | Check | Exact command | Required result |
|---|---|---|---|
| 1 | Node toolchain | `node --version && pnpm --version` | Node 24+, pnpm 11.7.0 |
| 2 | **NTP synchronized** | `timedatectl show -p NTPSynchronized` → `yes`. Then compare host clock to exchange time: `curl -s 'https://api.upbit.com/v1/ticker?markets=KRW-BTC'` (`timestamp` field, ms) vs `date +%s%3N` | **\|delta\| < 30,000 ms.** A ~80s-fast sandbox host rejects every market tick (`FEED_STALE`) while the runtime correctly stays killed — observed, not theoretical. Timezone is irrelevant; epoch delta is what matters |
| 3 | Safety env | `/etc/nusa/cloud-paper.env` (`0600`): `NUSA_MODE=PAPER`, `NUSA_LIVE_MUTATION=PROHIBITED`, 32+ byte dashboard token, durable `NUSA_CLOUD_STATE_DB_PATH` (never `:memory:`) | Supervisor refuses anything else at startup (`assertPaperOnly`) |
| 4 | No private exchange keys | env must not contain `UPBIT_ACCESS_KEY`/`UPBIT_SECRET_KEY` | Supervisor strips them and logs the strip; public market-data only |

Do NOT "fix" a clock-skewed host by widening the 30s stale window, accepting
future timestamps, or bypassing freshness. Fix NTP instead.

## 1. Start / stop / restart

```bash
systemctl enable --now nusa-cloud-paper      # start (supervisor entrypoint)
systemctl is-active nusa-cloud-paper         # expect: active
systemctl stop nusa-cloud-paper              # graceful SIGTERM, 30s timeout
```

Controlled restart proof (24h requirement): record `cash`, `positions`,
realized/unrealized PnL, last order/fill IDs, risk state, and
`/var/lib/nusa/supervisor.json` (`restartCount`, `lastExit`) before and
after `systemctl restart`. Expect identical accounting, incremented
`restartCount`, no duplicate order/fill IDs.

Abandoned writer lease (crash/kill only, never routine):
`node scripts/reset-paper-writer-lease.js` — refuses while a runtime
answers or the lease is valid; touches lease row only.

## 2. Health verification (read-only, no trading authority needed)

```bash
BASE=https://<your-host>; T=<dashboard-token>
curl -sSf $BASE/health
curl -sS -H "Authorization: Bearer $T" $BASE/api/paper-operations | head -c 2000
node scripts/nusa.js verify paper-runtime
```

Healthy steady state: `mode: PAPER`, `health` not `FAIL_CLOSED`,
`killSwitchActive: false`, `decisions` present, heartbeat counters
(`eventCount`, `decisionCount`, `paperOrderCount`, `paperFillCount`)
advancing, `lastError: null`.

## 3. Incident table (symptom → diagnosis → action)

| Symptom | Diagnosis | Action |
|---|---|---|
| `killed=true`, issues `Market data unavailable` | No ticks at all: Upbit unreachable, WS blocked, or markets misconfigured | Check egress (`curl` ticker), env `NUSA_CLOUD_UPBIT_*`, restart; stays killed until ticks flow |
| `heartbeat.lastError: PUBLIC_MARKET_EVENT_REJECTED` | Tick arrived but failed validation, most often feed older than the 30s window vs host clock: suspect **host clock skew** first (a pending improvement suffixes the exact reason) | Step 0.2 (NTP + delta). Do not widen the window |
| `...:FUTURE_MARKET_TIMESTAMP` | Exchange timestamps ahead of host beyond 5s allowance | Check NTP from the other side; treat data as untrusted until resolved |
| `PAPER_WRITER_CLOCK_REGRESSION` / `PAPER_WRITER_CLOCK_ANOMALY`, or `The lease is still valid` from the reset script | Second writer attempted while a live lease is held, or clock moved backwards: normal protection, not a crash | Find the duplicate starter; never force-take. Reset script clears only provably abandoned leases |
| `executor_unavailable` / HTTP 4006 from Audit path | Cloudflare Workers AI daily neuron quota exhausted | Wait for quota reset or fund the account; never treat as code defect; see issue #1545 |
| Mobile shows `업데이트 필요` (build screen) | Installed SHA older than Stable target | Install current Stable APK; verify identity matches |
| `STORED_RECORD_CORRUPT:*` in logs | Persisted JSON row failed to parse | Fail-closed by design; restore from backup, investigate disk/host |

## 4. 24h evidence checklist (all must be real counters, else NOT OBSERVED)

Runtime duration, cycles, market observations, accepted updates, stale
rejects (with reject codes from §3), decisions, signals, orders, fills,
partial fills, fees, slippage, cash, positions, realized/unrealized PnL,
risk halts, kill-switch events, restarts, successful recoveries,
duplicate-prevention events, learning ingestion count.

Collection: `node scripts/verify-cloud-paper-production.js` with
`NUSA_PRODUCTION_BASE_URL`, `NUSA_CLOUD_DASHBOARD_TOKEN`,
`NUSA_SOURCE_COMMIT=<exact-sha>` (writes
`artifacts/operational-evidence/cloud-paper-production-proof.json`).
A short PASS is not a 24h claim; the claim needs the full window plus
restart/replay/reconciliation evidence with LIVE mutation at zero.

## 5. What this runbook does NOT authorize

LIVE activation, real orders, withdrawals, transfers, credential
provisioning beyond the dashboard token, threshold changes, or treating
CI green / short soaks as 24h proof.
