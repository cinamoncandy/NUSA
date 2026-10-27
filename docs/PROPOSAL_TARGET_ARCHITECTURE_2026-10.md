# Proposal: NUSA target architecture (2026-10)

Status: PROPOSAL. Needs formal validator review and owner approval before any phase starts. It does not change
`docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md`; it applies that principle ("the core remains stable while its capabilities
can continuously improve") to what the repository and the PAPER host actually show today.
Safety stays as is: PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.
Work order: `.aipos/work-orders/WO-ARCH-20261027-TARGET-ARCHITECTURE.yaml`.

## 1. What the evidence shows

Measured on `main` on 2026-10-27, unless stated otherwise.

| Area | Measurement |
| --- | --- |
| Product code (excluding tests) | cloud 50.5k lines (357 files), desktop 32.6k, scripts 26.8k, packages 23.3k, mobile 19.4k, autopilot 13.4k |
| Cloud modules reached in production | 165 of 301 top-level `apps/cloud/src` modules are reachable by static import from `runtime.ts` plus the 22 cloud files that scripts, deploy, workflows and other apps reference. **136 (about 45%) are not reached.** Static analysis only, so dynamic loading could reach a few more. |
| Persistence | 143 SQLite tables. PAPER account, fill ledger and writer lease share one file and one process with research raw data (more than 4.2M order-book samples and 876k trade ticks on 2026-10-26). |
| Host | 1 vCPU, 954 MB memory, `/` 90% used. The runtime, research collection, backups and the self-hosted diagnosis runner all run on it. |
| Process | 1,306 test files, 49 `validate-*` scripts, 39 workflows, 519 work orders, 681 AIPOS files, 396 docs. 639 workflow runs on 2026-10-27; each PR head update starts 6 PR workflows. |
| Outcome | Every order intent failed from 2026-10-18 to 2026-10-27 (4,824 of 4,824). Research candles were stale for more than a week because a collector error was swallowed (#2815). Neither was raised by the system. Fixes reached the host 9 days late. A release took about 2 h, and its result could not be read back. |

## 2. Diagnosis

1. **Most of the effort goes around the core loop, not into it.** About 45% of the cloud modules, many governance
   layers and parallel generations (`V10`, `10X-S`, stacked learning-chain PRs #2792–#2800) are never executed.
   Meanwhile the one loop that matters (market → decision → order → fill → learning) was broken for 9 days unnoticed.
   Unexecuted code still costs review, CI and agent attention on every change, and it invites a second truth source.
2. **One small host and one database carry everything.** Trading state, research raw data, backups and observability
   compete for one vCPU, one SQLite file and one process. This shows up as slow backups, event-loop stalls, a
   possible writer-lease loss (one candidate, not proven) and diagnoses that cannot run.
3. **Failures are silent and feedback is slow.** Errors are swallowed per stage, there is no invariant alarm, and the
   host can only be read through itself. A release is manual, takes hours and is not verified by reading the
   running SHA back.
4. **Learning is designed before it has data.** The governed learning chain (precommit, holdout, meta-OOS,
   supersession) is long and careful, but no PAPER fill since 2026-10-18 and no research manifest means it has
   nothing to learn from. The walking skeleton (one honest end-to-end cycle) is not running.

## 3. Target architecture

```
                    off-host append-only health record  <-- reader + alarms (issues)
                                   ^
 ┌────────────────── PAPER host ───┼───────────────────────────────────────────┐
 │                                 │                                           │
 │  trading-core (small, priority) │      research-collector (low priority)    │
 │  market feed → decision → risk  │      order book, trades, futures, candles │
 │  → PAPER execution → ledger     │      → research.db (append-only)          │
 │  → paper-state.db (small)       │                                           │
 │         │  public /health  ─────┘                                           │
 │         └──────────────┐                  ┌─────────────────────────────────┘
 │                        v                  v
 │                learning job (batch, read-only on both DBs)
 │                → candidate / evaluation records → promotion through the existing gates
 └──────────────────────────────────────────────────────────────────────────────┘
```

- **trading-core** holds only what PAPER trading needs: market feed, decision, the canonical risk gateway, PAPER
  execution, the ledger and the writer lease, in a small `paper-state.db`. It never waits on research.
- **research-collector** writes raw market data to its own `research.db` in a lower-priority process. If it fails,
  trading continues, and the failure shows up as a stage alarm.
- **learning job** runs in batches and reads both databases read-only. It writes candidate and evaluation records
  and promotes only through the existing governed gates. Learning never edits trading state.
- **Observability:** each stage exposes freshness and a first broken stage (#2899). An invariant alarm fires after 6 h
  (#2907). An off-host append-only record (#2902) lets the system be read when the host is busy. A release counts as
  done only when the running `sourceCommitSha` read off-host equals the released `main`.
- **Code:** one canonical engine per capability. Modules no production entry point reaches are moved to an
  `attic/` boundary (excluded from builds and required CI) after a per-module check, or deleted by a governed PR.
  Nothing is deleted on a guess.
- **Process:** gates in proportion to risk. Execution, risk, ledger and authority paths keep every gate. Display-only
  and documentation changes get a lighter required set. Safety and LIVE-blocking checks are never removed.

## 4. Migration (strangler, every phase reversible)

| Phase | Change | Exit evidence |
| --- | --- | --- |
| 0 | Observe: merge #2899, #2907, #2902; one approved release; read the running SHA and the first broken stage back | `/health` shows the real first broken stage; alarm lines appear in the journal |
| 1 | Fix the core loop first: root-cause `ORDER_INTENT_FAILING` from the coded reasons (#2892) and restore genuine PAPER fills; no synthetic fill, no gate relaxation | `paperFillCount` rises from real decisions |
| 2 | Split `research.db` from `paper-state.db` (WO-ARCH-20261027-STATE-DB-SPLIT) | release backup takes minutes; trading latency is unaffected by research load |
| 3 | Run research collection in its own low-priority process | a collector crash leaves trading running |
| 4 | Code census: list each unreached module with its owner and the reason it exists; attic or delete per module through governed PRs | build and required CI cover only reachable code plus kept libraries |
| 5 | Risk-proportional CI: required set per path class, with safety gates unchanged | fewer runs per PR with the same safety coverage |
| 6 | Walking-skeleton learning: one honest end-to-end cycle from real fills and a real manifest, then grow the governed chain on top | one recorded cycle with real evidence; performance stays UNPROVEN until measured |

## 5. Not in scope

LIVE trading or any real-money authority; relaxing risk, loss-limit, threshold, capital or writer-lease settings;
deleting or rewriting evidence; synthetic data; host changes from an agent session; a big-bang rewrite.
