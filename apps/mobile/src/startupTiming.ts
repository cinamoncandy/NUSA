/**
 * Read-only cold-start timing for the owner's advanced device card. Records the first time each
 * startup step happens in this process and reports where the wait went. No data leaves the device,
 * nothing here affects authentication or any decision. Dependency-free on purpose.
 */
/** The three middle marks split the sign-in wait: the stored session is read, the refresh answered, the new tokens saved (the identity check then ends at sessionVerified). */
export type StartupMark = "appStart" | "endpointReady" | "sessionRead" | "tokensRefreshed" | "tokensSaved" | "sessionVerified" | "firstData";

const marks: Partial<Record<StartupMark, number>> = {};

/** Records the first occurrence of a step; later calls are ignored so a resume never rewrites a cold start. */
export function markStartup(name: StartupMark, now: number = Date.now()): void {
  if (marks[name] === undefined && Number.isFinite(now)) marks[name] = now;
}

export function resetStartupTimingForTest(): void {
  for (const key of Object.keys(marks) as StartupMark[]) delete marks[key];
}

const seconds = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1)}초`;

/** e.g. "설정 0.2초 · 인증 1.9초 · 첫 데이터 0.9초 (합 3.0초)", or "측정 중" for steps not reached yet. */
export function startupTimingSummary(): string {
  const { appStart, endpointReady, sessionRead, tokensRefreshed, tokensSaved, sessionVerified, firstData } = marks;
  if (appStart === undefined) return "측정 전";
  const parts: string[] = [];
  if (endpointReady !== undefined) parts.push(`설정 ${seconds(endpointReady - appStart)}`);
  if (endpointReady !== undefined && sessionVerified !== undefined) {
    // The split is shown only when every step was seen in order on this start (a silent or retried sign-in skips some).
    const ordered = sessionRead !== undefined && tokensRefreshed !== undefined && tokensSaved !== undefined
      && endpointReady <= sessionRead && sessionRead <= tokensRefreshed && tokensRefreshed <= tokensSaved && tokensSaved <= sessionVerified;
    const split = ordered ? ` (읽기 ${(Math.max(0, sessionRead - endpointReady) / 1000).toFixed(1)} · 새로고침 ${(Math.max(0, tokensRefreshed - sessionRead) / 1000).toFixed(1)} · 저장 ${(Math.max(0, tokensSaved - tokensRefreshed) / 1000).toFixed(1)} · 신원 ${(Math.max(0, sessionVerified - tokensSaved) / 1000).toFixed(1)})` : "";
    parts.push(`인증 ${seconds(sessionVerified - endpointReady)}${split}`);
  }
  if (sessionVerified !== undefined && firstData !== undefined) parts.push(`첫 데이터 ${seconds(firstData - sessionVerified)}`);
  else if (endpointReady !== undefined && sessionVerified === undefined && firstData !== undefined) parts.push(`첫 데이터 ${seconds(firstData - endpointReady)}(인증 전)`);
  if (firstData === undefined) return parts.length === 0 ? "측정 중" : `${parts.join(" · ")} · 측정 중`;
  return `${parts.join(" · ")} (합 ${seconds(firstData - appStart)})`;
}
