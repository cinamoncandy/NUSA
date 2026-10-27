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

## Owner-requested implementation continuation (Codex)
- UI design stopped at the owner's request; no mockup applied to product code.
- PR2689 socket retirement fix merged47b6da7a; exact-head CI38495486276 and postCI38496114940 PASS. Release38495999097 Audit PASS, merge succeeded, but post-merge read failed with unexpected JSON EOF; entire Release run is FAIL, not claimed PASS.
- Later Oracle38508906721PASS/sourcec9b96f8e contains47b6da7a. Public health2026-10-14T05:15:33.952Z HEALTHY,lastErrornull; learningcycles0,ResearchholdoutPasses0. Physical initiating cause of prior staging outages remains UNVERIFIED.
- WO-OPS-20261014-RELEASE-API-READ-RECOVERY implements bounded GET-only recovery in existing Release step.19 focused/1217 isolated files and all recorded gates PASS at base785807df; fresh non-author P1 SHA-validation finding fixed. Latest-main synchronization/CI/Audit/Release pending; no approval, merge authority, paid overflow, LIVE or Risk-policy change.

## Afternoon update (2026-10-14, ~06:40 UTC)
Re-verify on GitHub before acting.

### Merged today
- #2698 operating model rev 3 + P2 documents, #2700 design v1, #2704 this handoff.
- #2699 paid GPT-4.1 overflow off. Another session widened it: zero-credit is now enforced unless explicitly `false` (missing/malformed values no longer allow paid calls). After the Worker deploy, record `/health` `zeroCreditMode=ENFORCED` in `WO-OPS-20261014-PAID-OVERFLOW-OFF` (not yet observed from this sandbox: proxy 403).
- #2702 Binance futures public data probe. Owner's run 38520735288 on `nusa-paper-host`: ping, premiumIndex, fundingRate and 4h klines all http=200, exchange time fresh. B0 passes; recorded in `WO-FUTURES-20261014-BINANCE-PUBLIC-PROBE`.
- #2701 Now tab consecutive-loss line.

### Open (all reviewed by a fresh session unless noted)
| PR | State | Next |
|---|---|---|
| #2703 futures contract/simulator/risk gate | ready, CI green on 3d90367 | Release bot merge. Then retarget #2705 to main, merge main, mark ready. |
| #2705 Safety tab futures rows (+20% margin row) | draft, stacked on #2703 | as above |
| #2706 Now tab today's realized P&L (fill-cap fail-closed) | ready, base main | Release bot merge |
| #2709 state entries per file under `.aipos/state.d/` | draft, **needs a fresh-session review** | review, then ready |

### Owner decisions today (in addition to the morning list)
- Keep the current calm design; add only the futures part. A full redesign is the owner's later task (mockup for reference only: https://claude.ai/artifact/RqBkk5mcs1pPFHYn3Rp9PU).
- Night autonomous development every day 01:07-08:07 KST (routine `trig_01H4VbjDAaYCmFqA621bm6DZ`); 08:xx run leaves a short Korean morning summary.
- Progress messages to the owner in Korean.

### Lessons recorded
- The RISK requalification test reads the committed HEAD blob: run it after committing, never before.
- CI coverage shards also run on Windows: path assertions must normalize separators.
- A `test` job failure on an old head after a newer push is the aggregate of a cancelled run, not a real failure.
- A passing guard test proves little until it is shown to fail on an injected violation.

### Next safe actions
1. Finish the stacks above as they merge (retarget, merge main, re-verify, mark ready).
2. After #2703 merges: futures B4 research on live public data with funding in costs (pre-register first; PAPER only, no keys, no orders).
3. Design C remaining: learning and Autopilot status lines on the Now tab (Autopilot needs a server-side read of the Worker health).
4. After #2709 merges: new state entries use `.aipos/state.d/`.
