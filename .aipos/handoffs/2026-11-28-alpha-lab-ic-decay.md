# AIPOS handoff — Alpha Lab IC decay (2026-11-28)

## Current work

- Work order: WO-RESEARCH-20261128-ALPHA-LAB-CODEX-IC-DECAY, status IN_PROGRESS.
- Repository: cinamoncandy/NUSA.
- Branch: codex/alpha-lab-ic-decay-20261128, created from protected main 11058d27b50e518f764fe7ffb17e5be2e498a14b.
- Draft PR: [#3349](https://github.com/cinamoncandy/NUSA/pull/3349). Always fetch the current PR head before reviewing or validating; AIPOS bookkeeping may advance the branch after the recorded code/result commit 33c34c2a344a87a8bc419b74680fdd0a416760ec.
- Implementation commit: 5c19230b936492ba7a4443239a487139918291bc.

## Measurement evidence

- The script freezes three sourced signals, four horizons, the 56-market 2026-11-24 discovery cohort, and a 20-day circular moving-block bootstrap before data access.
- One successful historical data measurement ran on 2026-11-28. The first invocation failed before receiving candle data because Node did not use the environment proxy; the successful invocation used NODE_USE_ENV_PROXY=1.
- Public Upbit daily candles only, from 2017-01-01 through 2026-11-04 UTC inclusive. The request's exclusive upper bound is 2026-11-05; the parser rejects any later candle. No order-book endpoint or values were requested.
- Results and per-market OHLCV SHA-256 manifest: docs/research-data/alpha-lab-ic-decay-2026-11-28.json.
- Short descriptive note: docs/ALPHA_LAB_IC_DECAY_RESULT_2026-11-28.md.
- Frozen script SHA-256: d69a349cad545fd0fa3f5866f1e7ae5d2fa30253a52a16e78068a90c597d9059.
- Frozen spec SHA-256: d7476a8c3b26638fb81f94231348addb1e702d60764c3b37cbe077e6e39ae141.
- Manifest SHA-256: 6b696bba6647b3ed8eb16ef5b1485456df9d71235137fcb0d73b7fcfb148afb7.
- JSON file SHA-256: d0d0b87577ac61a066db466f716baf43275ce17a95147a1c9065491b74a6e8b5.
- Measurement is descriptive on already-read history only. It does not choose a winner or hold period, register a signal, authorize PAPER/production behavior, or imply profitability.

## Verification

- node --check scripts/alpha-lab/ic-decay.js: PASS.
- node scripts/alpha-lab/ic-decay.js --self-test: PASS; synthetic horizon-5 IC 0.05 is covered by the interval and the deterministic random-signal interval includes zero.
- pnpm run preflight: PASS, including strict AIPOS YAML validation.
- node scripts/validate-aipos-yaml.js: PASS.
- git diff --check: PASS.
- Recomputed manifest/payload/file hashes and verified all 56 market manifest entries end on or before 2026-11-04: PASS.

## Disclosed gaps

- The work order references section 7 of docs/ALPHA_LAB_V3_CROSS_SECTION_EVALUE_DESIGN_2026-11-27.md, but that file currently contains sections 1-6 only. Candidate definitions and sources are pinned in the script and disclosed in the result note.
- The result-note renderer initially read fetch timestamps from the wrong nested fields. The checked-in note was corrected from the hash-verified JSON manifest without another fetch or analysis. The frozen analysis script was not edited after the successful measurement.
- PR review and exact-head GitHub CI have not yet been completed. Keep the PR draft until a non-author CORE review is complete. Do not merge or release.

## Owner-supplied review follow-up (2026-11-28)

- The independent report supplied by the owner reviewed the prior head `b487e1bcd1476889f7184589248540115344705b` as `ACCEPT WITH P2` (0 P0/P1, 2 P2); it did not independently rerun the analysis.
- The reviewer reported that the full result JSON and source hashes could not be independently inspected in that session; the prior local hash verification recorded above remains the available evidence.
- The result note now states that its interval is conditional on the fixed 20-observation block length and that the hashed manifest does not preserve raw candles for exact reconstruction.
- This is a documentation-only clarification. The frozen script, result JSON, and hashes are unchanged; the one-time historical analysis was not rerun.
- Updated documentation head `284e5b734061454a51db5e8819ac79232052cb4c` passed exact-head CI #15003 and Actual PAPER evidence #10648. The corresponding AIPOS state update is evidence-only; fetch the latest PR head and its CI before review.
- Obtain a fresh non-author review of the latest head. Keep PR #3349 in draft; no winner selection, signal registration, or trading.

## Safety and next action

PAPER_ONLY / liveAuthority=NONE / productionMutationAllowed=false / realOrderAuthority=false / realTransferAuthority=false / aiAuthority=ZERO_AUTHORITY / FAIL_CLOSED.

No server, service, workflow, release, risk gate, threshold, capital, or authority was changed. Next action: CORE performs a read-only non-author review of the latest PR head. Any new historical analysis or re-run requires a new work order.
