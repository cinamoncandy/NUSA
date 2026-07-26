import { timingSafeEqual } from "node:crypto";

/**
 * This server ships with no session/login system -- single-user, local-first design (see
 * rateLimiter.ts's own doc comment for the same theme). A single operator-configured shared
 * secret, checked on every /api/ request via `Authorization: Bearer <key>`, is the whole auth
 * model here; rateLimiter.ts's request-volume guard remains the other half of abuse protection
 * and applies unconditionally, whether or not a key is configured.
 *
 * Entirely opt-in: no configured key means every request is authorized, which is today's
 * existing (unauthenticated) behavior, unchanged -- adding this feature never breaks an
 * existing single-user deployment that hasn't opted in.
 */
export function isAuthorized(authorizationHeader: string | undefined, configuredKey: string | undefined): boolean {
  if (!configuredKey) return true;
  if (!authorizationHeader) return false;
  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return false;
  const provided = authorizationHeader.slice(prefix.length);
  // Constant-time comparison -- a naive `===`/string comparison returns as soon as the first
  // mismatched character is found, and that timing difference is enough in principle to
  // brute-force the key one character at a time via repeated requests.
  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configuredKey);
  if (providedBuffer.length !== configuredBuffer.length) return false;
  return timingSafeEqual(providedBuffer, configuredBuffer);
}
