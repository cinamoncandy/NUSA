# Galaxy Physical Acceptance Checklist (human-only)

Status: **procedure only — changes nothing.** Record results in the table
at the bottom; attach screenshots per screen. Anything not observed stays
`NOT OBSERVED`, never PASS.

Related: `docs/operations/24h-paper-operations-runbook.md` (backend side),
`docs/ui/visual-system-spec.md` (visual contract).

## 0. Prerequisites (all must hold before starting)

- [ ] Stable APK downloaded from the `nusa-android` GitHub release
  (not a debug build, not a preview).
- [ ] Release provenance recorded: `source_sha`, `apk_sha256`,
  `versionName`, `versionCode` from `NUSA-Android.provenance.txt`
  and `NUSA-Android.apk.sha256`.
- [ ] Device: Galaxy physical hardware, system clock on automatic
  (Settings → General management → Date and time → Automatic),
  network available (Wi-Fi or mobile data).

## 1. Install + build identity (blocks everything below on FAIL)

1. Fresh-install the Stable APK.
2. Open More → Settings → build identity surface.
3. Verify and record:
   - [ ] `versionName` / `versionCode` match the release provenance.
   - [ ] displayed commit SHA short form matches release `source_sha`
         first 8 hex chars.
   - [ ] No `dev` / `unprepared` markers anywhere on the build screen.
   - [ ] With airplane mode ON, build screen still opens (local data).

## 2. Entry gate (first launch)

- [ ] Brand, PAPER-only explanation, LOCAL ENTRY / PAPER ONLY /
      LIVE NONE badges, start button, no-password disclaimer all visible.
- [ ] Tapping start enters HOME without asking for credentials.

## 3. HOME first viewport (portrait, default font)

Within 3 seconds, read without scrolling:
- [ ] Market/system status line present and truthful.
- [ ] Risk level visible with color + text (never color-alone).
- [ ] Freshness age visible when data exists; nothing invented when absent.
- [ ] Asset hero shows total + basis label (`누적`, never `오늘` on
      lifetime data).
- [ ] No dead controls (everything tappable visibly responds or is
      clearly disabled).

## 4. Screen flow (each: open, read, back — record anomalies)

- [ ] Markets: CHART/WATCHLIST segments switch; watchlist rows show
      price/change aligned; STALE chip appears only when data is stale.
- [ ] Chart: candles render; interval buttons (1m/5m/15m/1h) switch data;
      freshness text matches recency.
- [ ] PAPER: activity summary truthful (no activity → says so);
      order ticket 01→02→03 flow; confirm screen before submit;
      disabled submit explains why.
- [ ] Portfolio: PAPER summary first; REAL_READ_ONLY strictly separate
      with non-aggregation copy; absolute last-success timestamps.
- [ ] AI: NOW/WHY/RESULT/RISK/LEARNING sections; confidence shown only
      when calibrated; ZERO_AUTHORITY visible.
- [ ] Orders: search/filter/period/sort/pagination all function;
      absolute fill times.
- [ ] Notifications: empty state is honest (no fake alerts).
- [ ] Settings: 8 grouped sections; endpoint/token fields never
      display secrets back.

## 5. Failure injection (airplane mode ON, 60 seconds)

- [ ] Watchlist/Markets show STALE (not fresh-looking old data).
- [ ] PAPER order submit is blocked with a reason (fail-closed).
- [ ] AI shows unavailable/empty, not a neutral opinion.
- [ ] Airplane mode OFF → fresh data returns, STALE clears.

## 6. Display conditions

- [ ] Dark mode (system): surfaces separate, text contrast, risk/AI
      tones distinguishable, charts readable.
- [ ] Max font size (Settings → Display → Font size largest): hero
      values shrink (no clipping), rails wrap, nav labels intact,
      no overlaps.
- [ ] Small-screen sanity if a second device exists (optional).

## 7. Fake-data audit (every screen)

For each screen confirm ABSENCE of: fake balance, fake PnL, fake
positions, fake prices, fake regime, fake AI confidence, fake history,
fake "LIVE" status, fake freshness. Missing data must render as
explicit unavailable/empty/error — never as plausible numbers.

## 8. Result record

| # | Item | Result (PASS/FAIL/NOT OBSERVED) | Evidence (screenshot/note) |
|---|---|---|---|
| 1 | Install + identity match | | |
| 2 | Entry gate | | |
| 3 | HOME 3-second | | |
| 4 | Screen flow (8 screens) | | |
| 5 | Airplane-mode states | | |
| 6 | Dark mode | | |
| 7 | Max font | | |
| 8 | Fake-data audit | | |

**PRODUCT VERIFIED stays NO** until every row above is PASS with attached
evidence, plus 24h backend evidence and merged Audit PRs.
