# NUSA Mobile UI/UX v5 — OBSIDIAN FINANCE

Status: CANONICAL DESIGN SPEC
Scope: Android-first React Native mobile UI/UX
Reference direction: premium mobile trading / wealth-management patterns inspired by strong Behance fintech work, adapted to NUSA rather than copied.

## 1. Product experience goal

NUSA should feel like a premium personal financial intelligence product, not an operations console.

Within 2–3 seconds of opening the app, the user should be able to answer:
1. How much is my PAPER portfolio worth?
2. Am I up or down?
3. How much cash is allowed to be invested, and how much is protected?
4. What market or position matters right now?
5. What is the next safe action?

Technical governance remains strict in runtime but visually quiet unless it changes the user's next action.

## 2. Visual identity — OBSIDIAN FINANCE

- Near-black graphite canvas, not blue-black.
- One cold mint signature accent for selection and primary action.
- Green/red only for actual financial gain/loss or buy/sell semantics.
- Avoid decorative gradients and neon glow.
- Prefer typography, contrast and negative space over cards and shadows.
- Financial numbers dominate screen titles.
- Default mobile horizontal padding: 20px.
- Minimum touch target: 48px.

Dark palette canonical intent:
- background: near-black obsidian
- surfaces: mineral graphite steps
- primary: pale cold mint
- text: warm off-white
- muted text: low-chroma gray-green

## 3. Information architecture

Primary bottom navigation:
- Home
- Markets
- PAPER
- Portfolio
- AI

Utility navigation:
- Order history
- Notifications
- Settings

Utility screens must never compete visually with the primary five destinations.

## 4. App shell

### Top chrome
Keep extremely small.

Show:
- compact NUSA mark/name
- one utility/menu affordance
- at most one quiet PAPER safety indicator when needed

Do not permanently repeat PAPER ONLY + LIVE NONE + investment percentage as a full-width strip on every screen.
Investment allocation belongs contextually in Home, Portfolio, PAPER and Settings.
Safety authority detail belongs in Settings / AI detail / blocking states.

### Bottom navigation
Five destinations only.
- 48px minimum touch area.
- Active destination indicated by mint and typography/indicator, not a large filled card.
- PAPER may receive slightly stronger emphasis but must not resemble LIVE trading authority.
- Labels remain visible; icon-only navigation is prohibited.

## 5. Home

Primary hierarchy:
1. Total PAPER equity — largest number on screen.
2. Total P&L directly below.
3. Cash allocation rail: investable vs protected cash.
4. Two high-value shortcuts: Markets, PAPER.
5. One compact AI insight block.
6. Operational/safety state only if it affects action.

Remove redundant dashboard metric cards and repeated system-state text.

## 6. Markets

Chart-first layout.

Hierarchy:
1. Market symbol / asset pair.
2. Current price and move.
3. Chart occupying the dominant visual region.
4. Time range / market controls.
5. Compact market stats.
6. Watchlist as rows, not large cards.

Never fabricate candle or performance data.
If chart data is unavailable, preserve layout and show a truthful inline unavailable state.

## 7. PAPER

The PAPER workspace should resemble a professional mobile order ticket while making PAPER authority unmistakable.

Flow:
1. Market + price.
2. BUY / SELL segmented control.
3. Market / Limit segmented control.
4. Price where applicable + quantity.
5. Buying power / allocation envelope.
6. Estimated order value and remaining investable cash.
7. Review.
8. Explicit final confirmation.

Cash allocation semantics:
- investmentPercent controls new BUY capacity.
- reservePercent remains protected from new BUY.
- 0% prevents new BUY.
- SELL / liquidation must not be blocked by reserve allocation.

Runtime authority remains:
- PAPER ONLY
- liveAuthority=NONE
- productionMutationAllowed=false

## 8. Portfolio

Hierarchy:
1. Total equity.
2. P&L.
3. Optional truthful performance visualization only when real history exists.
4. Cash allocation rail.
5. Current position / holdings.
6. Realized and unrealized P&L.
7. Technical account detail last.

Avoid splitting every metric into a card.

## 9. AI

AI is research, never an execution surface.

Hierarchy:
1. One concise current thesis / insight.
2. Trusted confidence only when calibrated.
3. Top evidence.
4. Counter-evidence / disagreement.
5. Detail and diagnostics.
6. Authority boundary.

ECE/Brier/raw diagnostics belong below the fold or in detail, not in the first visual layer.
AI ZERO_AUTHORITY must remain explicit but visually secondary.

## 10. Settings

Order:
1. PAPER connection state and connection action.
2. Cash investment allocation.
3. Appearance.
4. Safety / authority.
5. Local data and personal-mode management.

Cash allocation must display both percentages and computed amounts when exchange cash is available.

## 11. Order history

Dense execution log, not repeated decorative cards.

Each row should prioritize:
- market
- BUY/SELL
- status
- quantity
- execution price
- timestamp

Secondary details may reveal order ID, fee and fills.

## 12. Notifications

If no real event source exists, show a simple truthful empty state.
Do not fabricate notification examples in production UI.

## 13. Responsive behavior

### Compact phones
- Single column.
- 20px horizontal padding, allowed to reduce only where safe-area constraints demand.
- No horizontal overflow.
- Large numbers use adjustsFontSizeToFit / controlled scaling.
- Navigation labels must remain readable.

### Large phones / foldables / tablets
- Preserve the same hierarchy.
- Markets: chart + watchlist may become two-column.
- Portfolio: position + detail may become two-column.
- AI: evidence / research details may become two-column.
- Do not turn the app into a desktop admin dashboard.

## 14. State UX

Loading:
- preserve expected layout where practical;
- avoid replacing the whole app with a giant card.

Error:
- inline notice near the affected capability;
- one clear recovery action.

Empty:
- truthful explanation;
- no fake content used for decoration.

Blocked:
- explain what is blocked and the safe next action.

## 15. Component rules

Cards:
- Use only for real grouping, confirmation, risk, or strong interactive grouping.
- Do not use cards as the default section container.

SegmentedControl:
- use for mutually exclusive options such as BUY/SELL, Market/Limit, timeframe, theme and allocation presets.

StatusChip:
- use sparingly;
- never create a row of chips when one sentence or contextual label is enough.

InlineNotice:
- errors, blocked conditions, safety implications and truthful empty/unavailable states.

Numbers:
- use tabular numeral alignment wherever supported.
- large financial values outrank labels.

## 16. Motion

Target motion: 150–220ms, functional only.
Allowed:
- selected tab transition
- segmented control selection
- chart timeframe transition
- allocation rail change
- confirmation state transition

No decorative looping motion.

## 17. Accessibility

- 48px touch targets minimum.
- explicit accessibilityRole for interactive controls.
- accessibilityState selected/expanded/disabled where applicable.
- color must never be the sole carrier of financial meaning.
- support large text without truncating critical monetary values or actions.

## 18. Safety invariants

Design changes must never weaken:
- PAPER ONLY
- liveAuthority=NONE
- productionMutationAllowed=false
- AI ZERO_AUTHORITY
- no real broker order/cancel/withdraw/transfer authority
- credential process-memory-only policy

## 19. Freeze criteria

UI/UX v5 is design-frozen only when:
- all primary five screens follow this hierarchy;
- utility screens follow the same visual language;
- cash allocation appears consistently in Home / PAPER / Portfolio / Settings;
- no stale v3/v4 card-heavy patterns remain in primary flows;
- compact Android and tablet layouts have explicit behavior;
- loading/error/empty/blocked states are coherent;
- accessibility contracts are preserved;
- design-system and UI contract tests encode the v5 canonical rules.

CI / APK provenance validation happens after this design freeze, on one immutable exact HEAD.
