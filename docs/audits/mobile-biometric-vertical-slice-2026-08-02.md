# Mobile Biometric Authentication Vertical Slice

- Face ID, Touch ID, and fingerprint are selected through the native biometric platform port.
- PIN is attempted only when biometric authentication is unavailable or fails.
- Critical actions and session re-authentication use the same mandatory authentication boundary.
- Consecutive failures trigger configurable lockout; lockout cannot be bypassed by critical actions.
- Trusted Device management was not modified.

Verification:

- `CI=true pnpm.cmd run typecheck`: PASS
- `CI=true pnpm.cmd run build`: PASS
- `node --test tests/mobile-biometric.test.js tests/mobile-security.test.js tests/secure-session.test.js`: PASS, 11/11
- `git diff --check`: PASS
