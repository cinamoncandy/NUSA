/**
 * What this deployment can do, read before asking the owner for anything.
 *
 * `/health` needs no credential, so the app can find out whether password sign-in has been set up
 * before showing a password field. Without this the owner typing into a server nobody has
 * configured would read the same rejection as a wrong password -- the opaque failure that kept
 * them locked out of their own PAPER server for weeks.
 *
 * Everything here fails soft. A server that is old, unreachable, or answering something else is
 * reported as UNKNOWN rather than throwing: not being able to describe the server is not a reason
 * to stop the owner from trying to sign in.
 */

export type PasswordSignInAvailability = "CONFIGURED" | "NOT_CONFIGURED" | "UNKNOWN";

export interface ServerCapabilities {
  readonly passwordSignIn: PasswordSignInAvailability;
  /** The exact build answering, or null when the host did not record one or is too old to say. */
  readonly deploymentRevision: string | null;
}

export const UNKNOWN_CAPABILITIES: ServerCapabilities = Object.freeze({ passwordSignIn: "UNKNOWN", deploymentRevision: null });

const COMMIT = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 8_000;

const secureEndpoint = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/i.test(trimmed)) throw new Error("cloud endpoint must be https.");
  return trimmed;
};

export async function readServerCapabilities(baseUrl: string, request: typeof fetch = fetch): Promise<ServerCapabilities> {
  let endpoint: string;
  try {
    endpoint = secureEndpoint(baseUrl);
  } catch {
    return UNKNOWN_CAPABILITIES;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await request(`${endpoint}/health`, { method: "GET", signal: controller.signal });
    if (!response.ok) return UNKNOWN_CAPABILITIES;
    const body = await response.json() as Record<string, unknown>;
    if (body == null || typeof body !== "object" || Array.isArray(body)) return UNKNOWN_CAPABILITIES;
    // An older server has no such field. Reporting UNKNOWN rather than NOT_CONFIGURED matters:
    // NOT_CONFIGURED would tell the owner to go run a setup script that this build does not have.
    const declared = body.passwordSignIn;
    const passwordSignIn: PasswordSignInAvailability =
      declared === "CONFIGURED" ? "CONFIGURED" : declared === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNKNOWN";
    const revision = typeof body.deploymentRevision === "string" && COMMIT.test(body.deploymentRevision) ? body.deploymentRevision : null;
    return Object.freeze({ passwordSignIn, deploymentRevision: revision });
  } catch {
    return UNKNOWN_CAPABILITIES;
  } finally {
    clearTimeout(timer);
  }
}
