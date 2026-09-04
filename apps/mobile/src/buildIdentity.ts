import { BUILD_SOURCE_SHA, CANONICAL_NUSA_ORIGIN } from "./generatedBuildConfig";

export interface BuildIdentity {
  readonly shortSha: string;
  readonly sealed: boolean;
  readonly label: string;
}

const VALID_SHA = /^[0-9a-f]{40}$/i;

/**
 * Describes the build sealed into this binary. An unsealed build (dev SHA or
 * non-HTTPS origin) must render as such wherever identity is shown, so a
 * stale or local APK can never be mistaken for a release.
 */
export function describeBuildIdentity(
  sourceSha: string = BUILD_SOURCE_SHA,
  canonicalOrigin: string = CANONICAL_NUSA_ORIGIN,
): BuildIdentity {
  const validSha = VALID_SHA.test(sourceSha.trim());
  const sealedOrigin = canonicalOrigin.trim().toLowerCase().startsWith("https://");
  const sealed = validSha && sealedOrigin;
  const shortSha = validSha ? sourceSha.trim().slice(0, 8) : "dev";
  return Object.freeze({
    shortSha,
    sealed,
    label: sealed ? `build ${shortSha}` : `dev build (${shortSha})`,
  });
}
