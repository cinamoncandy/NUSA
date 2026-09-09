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

A value from the future is `STALE`, not `FRESH`: a negative age means the clocks
disagree, and reading it as fresh would hide exactly the condition worth showing.
