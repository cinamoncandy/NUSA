# Mobile App Shell v0.1

This slice defines the framework-independent navigation and safety state used by the future React Native application.

## Routes

- `AUTH`: signed out, authenticating, or expired sessions
- `APP`: authenticated mobile shell

## Tabs

- Home
- Market
- Portfolio
- Trading Control
- Settings

## Safety behavior

- Signed-out and expired sessions cannot refresh or open trading controls.
- Loading and decode-error dashboard states keep trading controls closed.
- Caution and blocked states surface visible warning or danger banners.
- Emergency stop is visible whenever a valid dashboard state is available, including blocked states.
- Future synchronization timestamps are rejected.

This module contains no React Native dependency and no exchange order path. It is compiled and tested by the existing root TypeScript and Node test pipeline. A later bootstrap can bind the state to Expo or bare React Native components without changing its safety semantics.
