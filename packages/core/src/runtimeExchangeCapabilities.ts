/**
 * The one place the desktop process states which exchange capabilities it carries.
 *
 * These three values were previously written as literals in at least three unrelated places:
 * the pre-trade risk request built in paperOperationalPreflight.ts, the diagnostics safety block
 * in main.ts, and the pilot evidence CLI. The risk gateway genuinely blocks on
 * LIVE_CAPABILITY_DETECTED and PRIVATE_API_CAPABILITY_DETECTED, so a literal `false` at the call
 * site is not a description of the build -- it is a promise that the detector will never fire.
 * Today the promise happens to be true. The moment an authenticated order path lands, every one
 * of those literals has to be found and changed by hand, and the risk gate fails open if even
 * one is missed.
 *
 * Keeping the state here does not make it a measurement -- `scripts/build-deployment-descriptor.js`
 * is what actually measures the source tree, and CI runs it. What this does is give that
 * measurement a single runtime counterpart to contradict, instead of scattered constants that
 * quietly agree with each other.
 */
export interface RuntimeExchangeCapabilities {
  /** A path that can place or cancel a real exchange order. */
  readonly liveTrading: boolean;
  /** A path that calls an authenticated endpoint capable of mutating exchange state. */
  readonly authenticatedMutation: boolean;
  /** Persistence or retrieval of exchange credentials. */
  readonly credentialStorage: boolean;
}

/**
 * Paper-only build. Every field must stay false for as long as the release boundary is
 * Paper/Shadow; `scripts/build-deployment-descriptor.js` fails CI if the source tree grows a
 * capability that contradicts this.
 */
export const RUNTIME_EXCHANGE_CAPABILITIES: RuntimeExchangeCapabilities = Object.freeze({
  liveTrading: false,
  authenticatedMutation: false,
  credentialStorage: false
});
