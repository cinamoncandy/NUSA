# DOKKAEBI — Operational Evidence Run #1

**Verdict: the required operational evidence was NOT collected. Release Gate remains `BLOCKED`.**

The Electron Paper Trading app could not be launched in this environment, so no operator
session exists. What this run *did* produce is a headless exercise of the real Paper Trading
core plus three concrete findings. Every number below was computed by the repository's own
code against real live Upbit public market data. Nothing here was fabricated, and nothing here
should be entered into the evidence database.

---

## 1. Run identity

| Field | Value |
|---|---|
| Commit SHA (exact) | `70cba678272d0374bb1920df6e28c29ae5f0cc08` |
| Branch | `agent/electron-upbit-paper-trading` (PR #1 HEAD) |
| Run start | 2026-07-26 16:30:04 KST (07:30:04 UTC) |
| Session executed | 2026-07-26 16:32:15 KST (07:32:15 UTC) |
| OS | Ubuntu 24.04.4 LTS — Linux 6.18.5 x86_64 |
| Node | v22.22.2 |
| pnpm / npm | 11.7.0 / 10.9.7 |
| Market data | Upbit **public** REST ticker, no credentials |
| Evidence location | `evidence-run-1/` |
| Session log | `evidence-run-1/session-1-log.json` |
| Session DB | `evidence-run-1/session-1.db` |

---

## 2. Why there is no operator session

The Electron app cannot run in this container. Three independent hard blockers:

1. **No display.** `DISPLAY` is unset; there is no X server or framebuffer.
2. **No dependencies installed.** `node_modules/` is empty (0 entries). `electron` and `ws`
   are both absent.
3. **Dependencies cannot be installed.** `pnpm install --frozen-lockfile` fails at
   `ERR_PNPM_EXOTIC_SUBDEP`: `@electron/node-gyp` is resolved via a git repository and is
   blocked by this workspace's supply-chain policy. This is a long-standing, pre-existing
   constraint of this environment, not a repository defect and not something this run
   introduced or could fix.

Additionally `node scripts/check-runtime.js` **fails here** — the repo requires Node ≥ 24 and
this container runs Node 22. CI runs Node 24 and passes. This is an environment gap, recorded
for completeness.

**Consequence:** requirements 1–3 of the "준비" section (launch the Electron app at PR #1 HEAD)
were not met, and therefore no requirement that depends on a running app was met either.

## 3. DB backup

**Nothing to back up.** There is no pre-existing operator database in this container:
`~/.config/dokkaebi` does not exist, and a filesystem-wide search for `dokkaebi.db` returned
no results. The Electron app stores its DB at `app.getPath("userData")/dokkaebi.db`
(`apps/desktop/src/main.ts:261`) — on the owner's Windows machine that is
`%APPDATA%/dokkaebi/dokkaebi.db`. **That file has never been touched by this run.**

The database created here (`evidence-run-1/session-1.db`) is a brand-new throwaway file.

---

## 4. What was actually executed

A headless driver (`evidence-run-1/drive-session.js`) constructed the **same objects with the
same constants** that `apps/desktop/src/main.ts` constructs — `PaperBroker`, `ControlPlane`,
`StrategyEngine`, `DesktopPersistenceStore`, `RuntimeCommandService`, with `INITIAL_CASH`
10,000,000 / `FEE_RATE` 0.0005 / the same `RISK_POLICY` and `FILL_MODEL` — and drove them with
live public prices.

**This is not an app session.** There is no Electron process, no BrowserWindow, no IPC, no
renderer, and no human at a GUI. It exercises the business/persistence core only.

| # | Step | Result | Observed value |
|---|---|---|---|
| 1 | Cold start, empty DB | PASS | `restoredFromDisk=false`, status `STOPPED` |
| 2 | **Auto-trade default OFF** | **PASS** | `autoTradeEnabled=false` |
| 3 | Live Upbit public price | PASS | KRW-BTC 94,108,000 |
| 4 | Session start | PASS | status `RUNNING` |
| 5 | Manual paper order #1 BUY | PASS | req 0.001 → filled 0.0009 @ 94,178,581, fee 42.38 |
| 6 | Manual paper order #2 SELL | PASS | req 0.0005 → filled 0.00045 @ 94,037,419, fee 21.16 |
| 7 | Portfolio reflects fills | PASS | cash 9,957,492.577 / equity 9,999,841.177 / realized −84.681 / 2 orders |
| 8 | App quit (store closed) | PASS | — |
| 9 | **Restart recovery** | **PASS** | cash, position qty 0.00045, avg 94,178,581, realized −84.681, 2 orders — all identical |
| 10 | **Kill Switch** | **PASS** | armed `canAutoTrade=true` → after `stop()`: `STOPPED`, `autoTradeEnabled=false`, `canAutoTrade=false` |
| 11 | **Orders blocked post-kill-switch** | **PASS** | `automaticSignal` → `SKIPPED`, order count unchanged at 2 |
| 12 | Market data re-fetch after kill switch | PASS | public REST ticker re-fetched OK |

Note on the fill model: both orders filled at 90% of requested quantity
(`FILL_MODEL.maxFillRatio = 0.9`) and at prices offset from the quote by spread/slippage.
That is the configured model behaving as designed, not a defect.

### Extra safety probe (raised by step 9)

Step 9 restored `status = RUNNING`. That is only safe if auto-trade can never come back armed,
so `evidence-run-1/probe-autotrade-persistence.js` armed auto-trade, ended the session
abruptly without `stop()`, and reloaded:

```
SESSION_A_BEFORE_CRASH: status=RUNNING  autoTradeEnabled=true   canAutoTrade=true
SESSION_B_AFTER_RESTART: status=RUNNING autoTradeEnabled=false  canAutoTrade=false
VERDICT: PASS — auto-trade cannot resume automatically across a restart
```

**Auto-trade fails closed across restart.** See OBS-1 below for the residual concern.

---

## 5. Evidence row verdict (the part that matters)

Read from the repo's own checker against the DB this session produced
(`node scripts/evidence-checklist.js --db <ABSOLUTE>/evidence-run-1/session-1.db`):

| Required evidence | Target | Actual | Status |
|---|---|---|---|
| 실제 세션 | 1 (of 20) | **0** | ❌ NOT COLLECTED |
| 완료된 Paper 주문 | ≥ 2 (of 50) | **0** | ❌ NOT COLLECTED |
| 재시작 복구 | 1 (of 3) | **0** | ❌ NOT COLLECTED |
| Kill Switch 검증 | 1 | **none** | ❌ NOT COLLECTED |
| 연결 재개 검증 | 1 | **none** | ❌ NOT COLLECTED (see below) |
| Represented regimes | 0 (of 3) | 0 | ❌ NOT COLLECTED |
| Duplicate checks | 0 (of 10) | 0 | ❌ NOT COLLECTED |
| 실행 화면 | — | none | ❌ IMPOSSIBLE HERE (no display) |
| Research reports | — | NOT_EVALUATED | ❌ |
| Owner review | — | NOT_COMPLETED | ❌ |

```
Release status: BLOCKED
Blocking reasons:
  - REAL_PAPER_EVIDENCE_REQUIRES_OPERATOR_REVIEW
  - RESEARCH_REPORTS_NOT_EVALUATED
  - OWNER_REVIEW_REQUIRED
```

**Why steps that passed still count as zero:** evidence rows are only recorded through
`PaperScenarioEvidenceRecorder`, which the Electron app wires into `RuntimeCommandService`.
The headless driver deliberately passed no recorder, so it wrote **no** evidence rows. This is
the gate working exactly as designed — functional correctness is not operational evidence, and
this run must not be allowed to look like it. **No evidence row was written, and none should
be back-filled by hand.**

**연결 재개 (reconnect):** only a public REST re-fetch was verified (step 12). The real
`UpbitWebSocket` reconnect path was **not** exercised — it requires the `ws` package, which is
not installable here. `tests/upbit-websocket.test.js` is one of the three test files excluded
in this environment for exactly this reason. This row is genuinely untested.

---

## 6. Findings

### BUG-1 — `evidence-checklist` reports `DATABASE_READ_FAILED` for a healthy DB given a relative path
**Severity: medium (operator-facing diagnostics).** Not a safety issue.

`assertSafeExistingDatabase` (`apps/desktop/src/evidenceOperator.ts:38`) intentionally rejects
non-absolute paths. But `readEvidenceStatus` catches that error and collapses it into the
generic `DATABASE_READ_FAILED`, and `scripts/evidence-checklist.js` collapses everything into
`"evidence checklist failed"`. An operator who passes a relative `--db` is told their database
is unreadable, which reads as *corruption* rather than *wrong path form* — during evidence
collection that is an expensive false alarm.

Reproduction (verified, same file, same run):
```bash
node scripts/evidence-checklist.js --db evidence-run-1/session-1.db
#   Database: not evaluated   /   DATABASE_READ_FAILED
node scripts/evidence-checklist.js --db "$PWD/evidence-run-1/session-1.db"
#   Database: evaluated       /   REAL_PAPER_EVIDENCE_REQUIRES_OPERATOR_REVIEW
```
`./`-prefixed relative paths fail identically. Suggested fix (not applied — this run is
evidence collection, not code change): surface the specific message, e.g.
`DATABASE_PATH_MUST_BE_ABSOLUTE`.

### OBS-1 — Control status restores to `RUNNING` after restart
**Severity: low / design question for the owner.** Not exploitable as-is.

After a restart the control plane reports `status = RUNNING` immediately, before any explicit
recovery gate. It is currently safe because `autoTradeEnabled` always restores to `false` and
`canAutoTrade()` requires both (verified in the probe above). But `DOKKAEBI.md`'s Recovery
rules say *"Never resume trading automatically before recovery is completed"*, and a restored
`RUNNING` status is one refactor away from violating that. Worth an explicit decision.

### ENV-1 — `check-runtime.js` fails on Node 22
**Severity: none (environment).** Repo requires Node ≥ 24; this container has 22. CI uses 24
and passes. Recorded only so the run log is complete.

---

## 7. Reproduction procedure for the owner (Windows, real app)

This is the procedure that will actually produce countable evidence. Steps 1–3 are what this
environment could not do.

```powershell
git fetch origin agent/electron-upbit-paper-trading
git checkout 70cba678272d0374bb1920df6e28c29ae5f0cc08   # exact PR #1 HEAD
node -v                                                  # must be >= 24
pnpm install --frozen-lockfile
pnpm run build

# BACK UP FIRST — do not skip
copy "$env:APPDATA\dokkaebi\dokkaebi.db" "$env:APPDATA\dokkaebi\dokkaebi.db.bak-<timestamp>"

pnpm desktop
```

In the app, per session: confirm auto-trade is OFF at launch → confirm the ticker connects →
place ≥ 2 manual paper orders → confirm the fills table and portfolio update → quit → relaunch
→ confirm position/orders/PnL restored → engage the Kill Switch → confirm orders are refused →
pull the network briefly and confirm the WebSocket reconnects. Screenshot each checkpoint with
the clock visible.

Then, **with an absolute path** (BUG-1):
```powershell
pnpm run evidence:checklist --db "$env:APPDATA\dokkaebi\dokkaebi.db"
```

Repeat until: 20 sessions, 50 completed orders, 3 regimes, 3 restart recoveries, 10 duplicate
checks, plus the fault drills and the Walk-Forward / Cost Stress / Integrity reports.

---

## 8. Next session must cover

1. A real Electron session on Windows — the only thing that increments `Observed sessions`.
2. **WebSocket reconnect** — the one row this run could not touch at all.
3. Duplicate-signal drill (0/10) — `ControlPlane.claimAutomaticSignal` idempotency under a
   real app, not a unit test.
4. Market-regime coverage (0/3) — needs sessions across genuinely different conditions.
5. Owner decision on OBS-1.
6. BUG-1 fix if evidence collection proves annoying in practice.

---

## 9. Attestations

- No live trading. No real orders. No withdrawals. No API keys or credentials were read,
  requested, or stored. The only network call was Upbit's **public** ticker endpoint.
- The operator's real database was never opened, read, modified, or backed up — it does not
  exist in this container.
- **No evidence row, session, order, fault scenario, report, or checksum was fabricated or
  inserted.** The evidence database reads all zeros, which is the true state.
- Functional results in §4 are explicitly labelled as a headless core exercise and are **not**
  offered as operational evidence.
- **Release Gate remains `BLOCKED pending real scenario evidence and owner review`.**

### Artifact checksums (this run's own files only — not an evidence bundle)

```
1343172ed6b9e2206fdd58bb17ff1820a8287111e5c329db7094b4ec0a0a0055  session-1.db
5314eccbdb16961f788b1e140629f08084316523a33141ccf4e68a84b8f8036c  session-1-log.json
03683c370cf26947a70798ee6153f8cedd685cf01f35edfe95ae0891ed0c13b7  probe-autotrade-result.json
cd995e2ee531e115b0c2cb3478a99fe73df66c092b2053161b05718d3f9f1669  upbit-ticker-probe.json
1cf88795892392acdd1a145d420a804dd1c2e5c41def21103ce40cf21f64856d  drive-session.js
6612aa511b451dc108d25782459a9cbcfb4119e3437335eb53c9ef9177e090af  probe-autotrade-persistence.js
```

These hash this run's local files for tamper-evidence of *this report*. They are **not** an
evidence bundle checksum and must never be presented as one.
