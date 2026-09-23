/**
 * Owner password verification: the one credential a person can carry in their head.
 *
 * Every existing way onto this account requires retrieving something from a file -- the dashboard
 * token, an enrollment token, a ten-minute bootstrap token -- which is why the owner has been
 * locked out of their own PAPER server with the credential sitting in `/etc/nusa/cloud-runtime.env`
 * the whole time. A password is the only credential that survives a lost phone, a wiped app and no
 * computer, because it is not stored anywhere the owner has to reach.
 *
 * A password is also the weakest thing this server will ever accept, so the shape matters:
 *
 *   - Hashing is scrypt from Node's own crypto. No dependency: this repository pins its supply
 *     chain deliberately, and a login path is the worst place to add a package.
 *   - Cost parameters live inside the stored string, so they can be raised later without
 *     invalidating existing hashes; `needsRehash` says when a stored hash is below current policy.
 *   - Verification is constant-time over the derived key, and takes the same work whether the user
 *     exists or not -- `verifyOwnerPassword` on a null record still runs a full scrypt against a
 *     dummy hash, so response timing does not answer "is this account real".
 *   - Nothing here logs, returns, or embeds the password. The failure type says why, never what.
 *
 * Throttling is NOT here. A password on an internet-facing endpoint is brute-forceable and needs
 * per-account backoff, which is stateful and belongs with the store; this module stays pure so it
 * can be tested exhaustively. `ownerPasswordThrottle.ts` holds that half, and the HTTP route must
 * use both -- `tests/owner-password-credential.test.js` checks that the two are wired together.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Cost of one verification. Raise N over time; stored hashes carry their own and still verify. */
export interface ScryptCost {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/**
 * 32 MiB and roughly a fifth of a second on a developer machine, several times that on the small
 * ARM instance this runs on. Sized for a credential presented once per device, not per request.
 */
export const CURRENT_COST: ScryptCost = Object.freeze({ N: 32_768, r: 8, p: 1 });

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 256 * 1024 * 1024;

/** Shortest password this server will store. Length is the only strength rule worth enforcing here. */
export const MINIMUM_PASSWORD_LENGTH = 12;

/** Longer than any real passphrase, short enough that scrypt cannot be turned into a load generator. */
export const MAXIMUM_PASSWORD_LENGTH = 512;

export type PasswordRejection =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_NOT_A_STRING";

export type VerificationOutcome =
  | { readonly status: "ACCEPTED"; readonly needsRehash: boolean }
  | { readonly status: "REJECTED" };

const encodedCost = (cost: ScryptCost): string => `${cost.N}$${cost.r}$${cost.p}`;

function assertUsable(password: unknown): PasswordRejection | undefined {
  if (typeof password !== "string") return "PASSWORD_NOT_A_STRING";
  // Length in code points, not UTF-16 units: a passphrase of emoji or Hangul must not be counted
  // twice and let a short password through, nor counted long and refused.
  const length = [...password].length;
  if (length < MINIMUM_PASSWORD_LENGTH) return "PASSWORD_TOO_SHORT";
  if (length > MAXIMUM_PASSWORD_LENGTH) return "PASSWORD_TOO_LONG";
  return undefined;
}

/** Why a password cannot be stored, or undefined when it can. Never echoes the password. */
export function rejectionFor(password: unknown): PasswordRejection | undefined {
  return assertUsable(password);
}

const derive = (password: string, salt: Buffer, cost: ScryptCost): Buffer =>
  scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, { ...cost, maxmem: MAX_MEMORY });

/**
 * Encodes as `scrypt$N$r$p$<salt base64url>$<key base64url>`. Self-describing so a hash stored
 * under one cost still verifies after the policy is raised.
 */
export function hashOwnerPassword(password: string, cost: ScryptCost = CURRENT_COST): string {
  const rejection = assertUsable(password);
  if (rejection) throw new Error(rejection);
  assertCost(cost);
  const salt = randomBytes(SALT_LENGTH);
  return `scrypt$${encodedCost(cost)}$${salt.toString("base64url")}$${derive(password, salt, cost).toString("base64url")}`;
}

function assertCost(cost: ScryptCost): void {
  const powerOfTwo = Number.isSafeInteger(cost.N) && cost.N > 1 && (cost.N & (cost.N - 1)) === 0;
  if (!powerOfTwo) throw new Error("scrypt N must be a power of two greater than one");
  if (!Number.isSafeInteger(cost.r) || cost.r < 1 || !Number.isSafeInteger(cost.p) || cost.p < 1) {
    throw new Error("scrypt r and p must be positive integers");
  }
  if (cost.N < CURRENT_COST.N) throw new Error("scrypt N must not fall below current policy");
}

interface ParsedHash {
  readonly cost: ScryptCost;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parse(stored: string): ParsedHash | undefined {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return undefined;
  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  const cost = { N: Number(rawN), r: Number(rawR), p: Number(rawP) };
  const powerOfTwo = Number.isSafeInteger(cost.N) && cost.N > 1 && (cost.N & (cost.N - 1)) === 0;
  if (!powerOfTwo || !Number.isSafeInteger(cost.r) || cost.r < 1 || !Number.isSafeInteger(cost.p) || cost.p < 1) return undefined;
  // A stored hash could name a cost large enough to hang the process on every attempt; refuse it
  // rather than let a corrupted row become a denial of service.
  if (cost.N * cost.r * 128 > MAX_MEMORY) return undefined;
  const salt = Buffer.from(rawSalt, "base64url");
  const key = Buffer.from(rawKey, "base64url");
  if (salt.length !== SALT_LENGTH || key.length !== KEY_LENGTH) return undefined;
  return { cost, salt, key };
}

/** A hash of a value nobody knows, so a missing account costs the same work as a wrong password. */
const ABSENT_ACCOUNT_HASH = hashOwnerPassword(randomBytes(32).toString("base64url"));

/**
 * Verifies a candidate against a stored hash. `stored` may be undefined -- for an account with no
 * password, or no account at all -- and the work is the same either way.
 */
export function verifyOwnerPassword(stored: string | undefined, candidate: unknown): VerificationOutcome {
  const usable = typeof candidate === "string" && [...candidate].length <= MAXIMUM_PASSWORD_LENGTH;
  const parsed = parse(stored ?? ABSENT_ACCOUNT_HASH) ?? parse(ABSENT_ACCOUNT_HASH)!;
  // Always derive: returning early on a malformed or absent hash would leak account state through
  // response time, which is the one thing an unauthenticated caller can always measure.
  const derived = derive(usable ? candidate : "", parsed.salt, parsed.cost);
  const matches = timingSafeEqual(derived, parsed.key);
  if (!usable || stored == null || parse(stored) == null || !matches) return Object.freeze({ status: "REJECTED" });
  return Object.freeze({ status: "ACCEPTED", needsRehash: parsed.cost.N < CURRENT_COST.N });
}

/** True when a stored hash was made under a weaker policy and should be replaced on next login. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  return parsed == null || parsed.cost.N < CURRENT_COST.N;
}
