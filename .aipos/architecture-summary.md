# NUSA Architecture Summary

- Domain and application logic remain outside the renderer.
- Exchange-specific behavior is behind existing Upbit adapter contracts.
- Paper execution owns deterministic order, fill, balance, position, and PnL behavior.
- Persistence and recovery use existing storage and Evidence paths.
- Risk and kill-switch gates precede Paper execution.
- Electron main process owns privileged operations; preload exposes validated methods.
- The current UI slice adds a replaceable renderer view-model and DOM shell only.
- No live mutation capability is introduced by the UI work.
