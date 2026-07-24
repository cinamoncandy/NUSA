# Application State UI

## Purpose

The application state surface gives the operator one honest summary of whether Dokkaebi can observe, decide, or perform a local Paper action. It does not claim profitability and never implies that a directional opinion overrides safety controls.

## Operational states

- `LOADING`: initial Paper and connection state is still being read.
- `RECONNECTING`: an established public market-data connection is being restored.
- `OFFLINE`: current public market data is unavailable; new Paper decisions and orders are blocked.
- `NO_DATA`: no valid first price has arrived.
- `STRATEGY_STOPPED`: the strategy is not producing automatic Paper actions.
- `PAPER_DISABLED`: the strategy may run, but automatic Paper execution is not authorized.
- `READY`: public market data and local Paper controls are available.

## Decision-ready states

These states prepare the UI for the Decision Domain without implementing committee calculation yet:

- `NO_QUORUM`
- `ABSTAIN`
- `DISAGREEMENT`
- `SAFETY_BLOCKED`
- `APPROVED_PAPER_ACTION`

Decision states take visual precedence because they communicate why the system did or did not authorize a Paper candidate. Risk, persistence, integrity, and execution gates remain authoritative.

## Accessibility

The surface uses `role="status"` and `aria-live="polite"`. State changes do not steal keyboard focus. Meaning is expressed through title and text rather than color alone. Motion is limited to a 120 ms color transition and disabled under `prefers-reduced-motion`.

## Integration contract

The current renderer adapter derives operational state from existing DOM values so trading, IPC, storage, and strategy logic remain unchanged. The future Decision Domain may set `document.body.dataset.decisionState` to one of the decision-ready values after a persisted decision record is available.
