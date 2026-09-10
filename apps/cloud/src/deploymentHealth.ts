/**
 * What `/health` says about which build is answering.
 *
 * The PAPER runtime used to answer `{ ok, observedAt }`, which cannot distinguish a host running
 * today's merged risk fixes from one running a build months old: the only way to tell was to hold
 * the dashboard token and read an authenticated surface. That makes a redeploy unverifiable by
 * the person who performed it, and it makes an automated update unable to check its own work or
 * decide to roll back. The autopilot Worker already answers this question unauthenticated
 * (`deploymentRevision`, plus the standing authority invariants), so this mirrors that contract
 * for the runtime that actually trades on paper.
 *
 * Only a 40-hex commit is echoed. Anything else -- unset, truncated, a branch name, a tag, an
 * operator's note -- reports UNVERIFIED rather than passing an arbitrary environment string
 * through to an unauthenticated response. A caller comparing against an expected SHA therefore
 * fails closed on a host that was deployed without recording what it deployed.
 */

const COMMIT_SHA = /^[0-9a-f]{40}$/;

export const UNVERIFIED_REVISION = "UNVERIFIED";

export interface DeploymentHealthPayload {
  readonly ok: true;
  readonly observedAt: string;
  /** The exact deployed commit, or UNVERIFIED when the host did not record one. */
  readonly deploymentRevision: string;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

/** The deployed revision a host may claim, or UNVERIFIED. Never echoes an unrecognized value. */
export function deployedRevision(env: NodeJS.ProcessEnv = process.env): string {
  const declared = (env.NUSA_SOURCE_COMMIT ?? env.GITHUB_SHA ?? "").trim().toLowerCase();
  return COMMIT_SHA.test(declared) ? declared : UNVERIFIED_REVISION;
}

export function deploymentHealthPayload(
  observedAt: string,
  env: NodeJS.ProcessEnv = process.env
): DeploymentHealthPayload {
  return Object.freeze({
    ok: true,
    observedAt,
    deploymentRevision: deployedRevision(env),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY"
  });
}
