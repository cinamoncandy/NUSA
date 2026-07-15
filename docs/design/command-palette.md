# Command Palette

The renderer provides a keyboard-first command palette for existing Paper-only controls.

- Open with `Ctrl+K` or `Cmd+K`; close with `Escape`, the close button, or the backdrop.
- Arrow keys, `Home`, `End`, and `Enter` operate enabled results. `Tab` and `Shift+Tab` stay within the dialog: search moves to enabled results and the last result returns to search. The close control remains reachable with reverse tabbing. Focus returns to the element that opened the palette when closed.
- Commands reuse Focus Mode and existing strategy/auto-trade controls. Start and stop remain visible when unavailable, are disabled, and expose an `Unavailable` reason. Disabled results cannot be selected or executed.
- Order-related commands only focus quantity fields. The palette never creates a buy or sell path.
- Navigation commands focus their target after scrolling. Event, fill, and operations panels use programmatic-only `tabindex="-1"` targets, so normal tab order is unchanged.
- Recent command IDs are local-only, capped at five, de-duplicated, newest-first, and ignored when stored JSON or storage access fails.

Options are created with `createElement`, `textContent`, and `append`; the palette does not use HTML-string insertion. The component uses the existing renderer tokens, supports reduced motion, and remains within the viewport on compact windows.
