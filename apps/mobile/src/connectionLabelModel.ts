/**
 * Plain-Korean label for the HOME status capsule. Presentation only: it names the state the screen already
 * computed and cannot change it. Order matters: a recovering session and an old cached value are never shown as
 * "작동 중", and a setup problem is never softened.
 */
export interface ConnectionLabelInput {
  readonly recovering: boolean;
  readonly stale: boolean;
  readonly disconnected: boolean;
  readonly readOnlyError: boolean;
  readonly readyForPaperOperations: boolean;
}

export type ConnectionLabelKey = "RECOVERING" | "CACHED" | "SETUP" | "DEGRADED" | "ACTIVE" | "OBSERVING";

export const CONNECTION_LABEL_KO: Readonly<Record<ConnectionLabelKey, string>> = Object.freeze({
  RECOVERING: "재연결 중",
  CACHED: "이전 값",
  SETUP: "연결 필요",
  DEGRADED: "연결 불안정",
  ACTIVE: "작동 중",
  OBSERVING: "확인 중",
});

export function connectionLabelKey(input: ConnectionLabelInput): ConnectionLabelKey {
  if (input.recovering) return "RECOVERING";
  if (input.stale) return "CACHED";
  if (input.disconnected) return "SETUP";
  if (input.readOnlyError) return "DEGRADED";
  return input.readyForPaperOperations ? "ACTIVE" : "OBSERVING";
}

export const connectionLabel = (input: ConnectionLabelInput): string => CONNECTION_LABEL_KO[connectionLabelKey(input)];
