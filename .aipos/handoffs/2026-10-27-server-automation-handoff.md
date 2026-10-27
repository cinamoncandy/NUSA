# Server automation handoff — 2026-10-27 (read-only host cannot be read after a successful release)

Author: CORE session. Scope: handoff only. No deploy, restart, cleanup or database change was made by this session beyond the one owner-authorised release dispatch listed below. `authority_impact: none`. PAPER_ONLY, `liveAuthority=NONE`, `productionMutationAllowed=false`, `aiAuthority=ZERO_AUTHORITY`.

Re-read live GitHub and a fresh `/health` before acting. This note is a snapshot.

## What happened

- The owner explicitly allowed one `Oracle PAPER Release` dispatch. Run `40448780153` (source `2a80488981d13f96552fae8d7c9161a6b3fcb1e9`, exact protected main) **succeeded**:
  - build 04:16:00Z to 04:17:43Z;
  - backup of persistent state 04:17:49Z to 06:12:57Z (about 1 h 55 min);
  - release switch 06:13:43Z to 06:15:13Z.
- The previous runtime was `c59b522410cb0ea62977382f15d253c331c690f8`. After this run the host should run `2a80488`, which contains #2885, #2875, #2879 (candle provenance, issue #2815) and #2892 (ORDER_INTENT reason codes in the `/health` `paperFunnel`). This has **not been read back**.
- `Oracle Host Diagnose` is the only read-only way this session has to read `/health`. Its runs:

  | run | started (Z) | result |
  | --- | --- | --- |
  | 40274396266 | 2026-10-26 05:28 | cancelled |
  | 40275442510 | 2026-10-26 05:39 | success (the only readable snapshot) |
  | 40283156761 | 2026-10-26 07:00 | cancelled |
  | 40447408790 | 2026-10-27 04:01 | cancelled after about 10 min |
  | 40462373697 | 2026-10-27 06:39 | cancelled after about 10 min, after the successful release, no step or log kept |

- The workflow sets a 5 minute timeout, yet the job ran about 10 minutes before being cancelled. The cause is **not established**. It is consistent with an unresponsive or overloaded host but that is not proven. No rerun was made (no blind retry).

## Not verified

- the runtime SHA the host now serves;
- whether `ORDER_INTENT:FAIL:*` reason codes appear in `/health` `paperFunnel`;
- whether `research_closed_candles` advance again after #2879;
- the order-book study result (due no earlier than 2026-10-29T03:30Z);
- disk headroom (last reading: `/` 90% used, 4.7 G free, 954 MB memory, one vCPU).

`EXACT_MAIN_RUNTIME_ACCEPTED=false`, `LEARNING_LOOP_VERIFIED=false`, `PERFORMANCE_IMPROVEMENT=UNPROVEN`.

## What the server owner needs to do (not a CORE action)

1. Find out why the read-only diagnosis hangs (journal, `df`, load, the diagnose job's own steps) before any further dispatch.
2. Confirm the runtime SHA and the active release directory by an approved read-only path.
3. Restore disk headroom through the approved cleanup path (old release directories). Do not delete backups without a restore check.
4. Then run `Oracle Host Diagnose` with `health_only=true` once and record: runtime SHA, `paperFunnel` ORDER_INTENT codes, candle freshness, `paperFillCount`.

## Then CORE can

- read the reason codes and decide whether `ORDER_INTENT:FAIL` has a code-level cause (writer-lease loss remains one unranked candidate);
- close #2815 only with the read-back candle evidence;
- re-enable the Android release workflow once, dispatch, and disable it again (owner order), so the phone gets the smaller wave from #2893.

## Exclusions

No synthetic fill, no gate or threshold relaxation, no manual candle or manifest insertion, no writer-lease change, no repeated release dispatch.
