# Command Palette

The renderer provides a keyboard-first command palette for existing Paper-only controls.

- Open with `Ctrl+K` or `Cmd+K`; close with `Escape`, the close button, or the backdrop.
- Arrow keys, `Home`, `End`, and `Enter` operate results. `Tab` remains within the dialog and focus returns to the trigger when closed.
- Commands reuse Focus Mode and existing strategy/auto-trade controls. Start and stop are unavailable whenever their existing controls are disabled.
- Order-related commands only focus quantity fields. The palette never creates a buy or sell path.
- Recent command IDs are local-only, capped at five, de-duplicated, and ignored when stored JSON is malformed.

The component uses the existing renderer tokens, supports reduced motion, and remains within the viewport on compact windows.
