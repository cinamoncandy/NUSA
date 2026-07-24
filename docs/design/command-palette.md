# Command Palette

The Electron renderer provides a keyboard-first command palette for Paper Trading operations.

## Access

- `Ctrl+K` on Windows/Linux or `Cmd+K` on macOS opens or closes the palette.
- `Escape`, the close button, or the backdrop closes it and restores the prior focus.
- Arrow keys, `Home`, `End`, and `Enter` operate the command list. `Tab` remains inside the dialog.

## Available commands

- Toggle Focus Mode.
- Start or stop the existing Paper strategy control.
- Toggle the existing Paper auto-trade control.
- Move focus to Paper order quantity, strategy quantity, events, fills, operations detail, or the top of the page.

The palette intentionally has no buy or sell command. It may only move focus to the order quantity field; the existing Paper order buttons and their safety controls remain the only order path.

## Safety and accessibility

- Commands reuse existing renderer controls and do not add IPC channels, exchange adapters, credentials, or live-trading behavior.
- Start and stop commands are hidden when their corresponding existing button is disabled.
- Results use semantic tokens and `role="dialog"`, `aria-modal`, listbox semantics, and a polite live region.
- Recent command identifiers are stored locally, capped at five, de-duplicated, and ignored safely when storage is malformed.
- Focus Mode is presentation-only and does not change strategy, risk, position, or execution state.
