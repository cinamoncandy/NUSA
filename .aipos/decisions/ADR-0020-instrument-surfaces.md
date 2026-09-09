# ADR-0020: Instrument surfaces — authority, refusal, freshness

## Status

Accepted. Repository implementation only; no LIVE, real-money, credential, or
production-mutation surface is touched.

## Context

NUSA's balance is simulated, its order path has no live authority, and its AI is
deliberately powerless. A conventional trading-app presentation — a large
balance, a chart, a green buy button — therefore advertises capabilities the
product does not have, and says nothing about the property a user must actually
trust: that roughly forty gates refuse correctly, and say why.

That gap produced a concrete failure earlier in this work. The mobile enrollment
screen rendered `error.message` raw, so `USER_NOT_REGISTERED`, `USER_NOT_ACTIVE`
and `USER_IDENTITY_MISMATCH` all reached the operator as
`mobile session request rejected (403).` The operator spent days suspecting a
token that had in fact authenticated — a rejected credential is 401; 403 means
the credential passed and the account state refused it. The server knew the
reason, sealed it, and logged it; the UI discarded it one layer from the screen.

## Decision

Three surfaces, with their rules in a pure module
(`apps/mobile/src/instrumentState.ts`, no React Native imports) so the behaviour
is testable without a renderer, and the presentation in
`apps/mobile/src/instrumentSurfaces.tsx`.

1. **Authority spine.** A non-dismissible band at the top of every authenticated
   screen, mounted once in the app shell rather than per tab. Its left zone
   states standing authority (`PAPER · LIVE NONE · AI ZERO`) with no color: it is
   a fact, not a warning. Its right zone is three annunciator lamps (DATA, LINK,
   GATE) under the aviation "dark cockpit" rule — dark is nominal, so a lit lamp
   is itself the information. A lit lamp routes to the screen that can resolve it.

2. **Refusal record.** Four layers, none optional: the gate that refused, one
   sentence of what is true, what happens next, and the machine evidence left
   visible and selectable so it can be pasted into a support request. Every
   server refusal code resolves to all four, and an *unknown* code still resolves
   to all four rather than falling through to a status number.

3. **Freshness.** Values carry their age. Stages are fractions of the same 15s
   window `validatePersonalPaperOperationsSnapshot` enforces, so what the screen
   dims is what the server would reject, and a narrowed window narrows every
   stage with it. A derived value inherits its oldest input's stage. Expiry is
   struck through, not merely recolored.

## Safety invariants

- `liveAuthority=NONE`
- `productionMutationAllowed=false`
- AI remains ZERO_AUTHORITY; the spine states this on every screen.
- These surfaces are presentational. None of them admits an order, relaxes a
  gate, or changes what the server enforces.

## Consequences

Two details are load-bearing and easy to undo by accident:

- **Off lamps are not dimmed with opacity.** A 9px label behind 35% opacity is
  unreadable, and the on/off distinction is already carried by color, fill and
  weight. Dimming would buy nothing and spend contrast.
- **`borderStrong` (`#66728A`) is not a text color.** At 3.9:1 on the dark
  background it fails WCAG AA for text; it stays on borders, rules and the dots
  of unlit lamps, where the 3:1 non-text threshold applies. Meta text uses
  `textMuted` (`#A5AEC0`, 8.4:1).

`describeCredentialFailure` (`dashboardCredentialSession.ts`) now delegates to
`describeRefusal` rather than carrying its own copy of the session vocabulary, so
the taxonomy has one home. Converging them exposed a residual defect: that
function answered 401 and 403 with the same "the token expired, get a new one"
sentence. It is right for 401 and wrong for 403 — a 403 means the credential
authenticated and the account state refused it — and the wrong half is exactly
what sent the operator back to a token that was already correct. `NO_CREDENTIAL`
and `CREDENTIAL_REJECTED` joined the table so the session gate is complete, and a
status the gate does not speak in (a 418, say) still returns its number, since
that is the only evidence the operator can hand on.

The order ticket the design drew does not exist and must not be built.
`tradingView.tsx` states that production PAPER is a supervision surface: the
cloud runtime owns orchestration and mobile "never exposes manual BUY/SELL,
price, quantity, or submit controls". The refusal record therefore went to the
connection step in Settings — the surface where the 403 that motivated this work
actually lands — and a test asserts the trading route stays free of it.

Inheritance is applied where it is literally true rather than everywhere a number
appears. Unrealized PNL is quantity x current price, so an expired quote drops it
to a neutral tone with a note saying the figure cannot be trusted — left in
profit green it states a gain nobody can act on. Realized PNL is exempt: it is
booked, not derived from a live quote, and dimming it would misreport a
settled fact. On the LOCAL PAPER path there is no server clock, so no stamp is
shown at all; inventing an age would be worse than admitting there is none.

Three surfaces shipped; a fourth was removed. `FreshValue` rendered a value with a
staleness stage, which presumes a governed window. Only the PAPER operations
contract defines one — public quotes have no such threshold anywhere in the
repository — so using it on MARKETS would have meant inventing a number nobody
specified, the same error as naming a stale quote from `health`. It was deleted
rather than given a fabricated threshold; `AgingValue` and the pure helpers cover
the surfaces that do have a contract.

The refusal record reaches Portfolio and AI as well as Settings, carried on the
operations result as an optional `refusal`. It is populated only where a gate
named the cause: a client-side condition (an unverified endpoint, an invalid
timeout) keeps its one-line notice, because attaching a gate to it would claim a
diagnosis nobody made.

The AI screen shows the signature on a proposal — model version, prompt version,
run time — beside the standing statement that the AI cannot act. Two answers that
differ while those match came from the same reasoning on different inputs; two
that match while they differ came from a build that changed underneath the
operator. Without them a proposal is an assertion with no way to audit it.

Motion discipline is now pinned by tests rather than only described: nothing
loops, a loading placeholder is a still block, motion asks the device before it
moves, and a figure is replaced rather than rolled — a number mid-roll is a value
that was never true.

A refusal must reach the control that clears it. `USER_NOT_ACTIVE` and
`USER_NOT_REGISTERED` are account state, and the owner-scoped user list in
Settings can read and change exactly that state — it lists every account with its
status and approves a pending one. The app nevertheless answered both with "이
계정을 서버에서 승인하세요", pointing at a machine the operator may not be able to
reach, while the control sat two sections below on the same screen. That is why a
solvable state read as an unsolvable one for days. Both now name the in-app panel
and carry a button that scrolls to it, using the section's own measured offset
rather than a guessed constant.

The accessibility floor is enforced by tests rather than reviewed by eye. Three
gaps existed in screens this work did not write: HOME's three QUICK ACCESS tiles
were tappable with no role and no label, its disabled LEARN tile only dimmed
without announcing that it was disabled, and its "AI 근거 상세 보기" link was an
11px line of text acting as its own hit target. Two more interactive styles sat
at 40px. The tests now walk every `<Pressable`, brace-aware so a style callback
cannot truncate the tag, and require a role, a `accessibilityState` wherever
`disabled` appears, and a 44px target.

A control that is small on purpose widens its target rather than its drawing: the
spine's lamps stay 22px, because a 44px lamp would turn a band into a toolbar,
and carry `hitSlop` past the floor instead. The floor test found those lamps in
this work's own code, which is the point of writing it as a test.

Two rules govern what a lamp or a stamp is allowed to claim.

**Only say what the field carries.** `health` collapses kill switches, halted
runtimes, offline transport, pending writes and failed research into
`FAIL_CLOSED` / `DEGRADED` / `HEALTHY`. Reporting any one of those as the cause —
an early draft of this work lit the DATA lamp with "the quote is stale" whenever
health was not HEALTHY — asserts more than the field supports, which is the same
error as answering a 403 with "your token expired". A degraded runtime is
reported as a degraded runtime, and staleness is measured separately from the
snapshot's own timestamp.

**The clock has to run.** Reading `Date.now()` during render freezes the age at
the last render, so a screen left open keeps saying "2초 전" while the data ages
out — worse than showing no age, because it asserts a freshness the data no
longer has. The tick lives in leaves (`AgingValue`, `AuthoritySpine`) rather than
in the screens: HOME renders a chart that is not memoized, and a clock in that
component would redraw the whole screen every second to move one line of text.

A value from the future is `STALE`, not `FRESH`: a negative age means the clocks
disagree, and reading it as fresh would hide exactly the condition worth showing.
