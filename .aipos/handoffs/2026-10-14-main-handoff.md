# AIPOS handoff 2026-10-14 (main Claude, CORE)

Provider-agnostic snapshot at the end of the 2026-10-14 session. Re-verify on GitHub before acting (No-Guess Rule). `AGENTS.md`, `CLAUDE.md` and `docs/CLAUDE_CENTERED_OPERATING_MODEL.md` §0 are authoritative.

## Safety (unchanged)
PAPER_ONLY, liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY. Spot consecutive-loss limit stays 3. Futures is PAPER-only with no credentials. Never merge or approve your own PR.

## Owner decisions made on 2026-10-14
- Design moves from ChatGPT to Claude; one Claude working session is CORE plus operations, research and records; a fresh session reviews code PRs (operating model revision 3, merged in #2698).
- Current repository and Worker token are kept; no machine account; #2644 owner-activity gate stays off.
- Paid GPT-4.1 overflow off (#2699); Codex kept disabled; review on request only.
- Design v1 accepted "all as recommended" (merged in #2700, `docs/NUSA_CLAUDE_DESIGN_V1.md`): slow-bar regime research, baseline strategy unchanged, Binance futures as a separate PAPER-only domain with limits 2x / isolated / liquidation distance >= 25% / 3 losses per KST day.

## Open PRs from this session (all drafts waiting for a non-author /grill-me review)
| PR | Work order | What |
|---|---|---|
| #2699 | WO-OPS-20261014-PAID-OVERFLOW-OFF | Enforce existing zero-credit mode (deploy var + wrangler var). After merge confirm Worker /health zeroCreditMode ENFORCED. |
| #2701 | WO-UI-20261014-NOW-LOSS-LIMIT | Now tab: consecutive-loss pause line and today's realized P&L (display only; new heartbeat fields lossLimit, todayRealized). |
| #2702 | WO-FUTURES-20261014-BINANCE-PUBLIC-PROBE | Manual read-only workflow probing Binance futures public endpoints from the PAPER host. After merge: dispatch once, record status codes (200 = proceed, 451/403 = stored-data research only). |
| #2703 | WO-FUTURES-20261014-PAPER-CORE | Futures contract, pure simulator and futures risk gate; not wired to runtime. |

## Facts found
- The forward regime study already runs on the host via `nusa-research.service` (`REGIME_FORWARD_STUDY` log lines, surfaced by `oracle-host-diagnose.yml`); design step A2 needs only the pending runtime-proof evidence, not new wiring. Earliest forward verdict 2026-12-13.
- Root `dist/` is git-ignored and `build/` holds only icons; no artifact cleanup needed.
- This sandbox cannot reach runtime /health, Worker /health or Binance (proxy 403).
- `node scripts/validate-architecture.js` writes `docs/audits/*-<date>.md`; delete them if they appear untracked after a local run.

## Next safe actions
1. Re-verify the four PRs; after review, the author marks them ready. Do not self-approve.
2. After #2702 merges, run the probe and record the result in its work order.
3. Design D (simplification) one work order at a time: archive old `state.yaml` entries (validators read it; check them first), merge the duplicate maps, merge near-identical workflows (not the restricted-live ones without an owner decision).
4. Design C remaining lines: learning status and Autopilot status on the Now tab.
5. Futures B4 research with funding in costs after the probe answer.
