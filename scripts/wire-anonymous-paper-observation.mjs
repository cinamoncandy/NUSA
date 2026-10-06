import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) throw new Error(`${label}: expected exactly one match`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const serverPath = "apps/cloud/src/server.ts";
let server = fs.readFileSync(serverPath, "utf8");
server = replaceOnce(server,
  'import { handlePublicUpbitQuotationHttp, isPublicUpbitQuotationPath } from "./publicUpbitQuotationHttp";\n',
  'import { handlePublicUpbitQuotationHttp, isPublicUpbitQuotationPath } from "./publicUpbitQuotationHttp";\nimport { anonymousObservationEnabled, createAnonymousObservationScope, hasBearerToken, isAnonymousObservationRoute, type AnonymousObservationScope } from "./observation/anonymousObservationScope";\n',
  "server import");
server = replaceOnce(server,
  '  const ownerDeviceCredentialService = options.ownerDeviceCredentialService ?? (ownedUserDb == null || mobileSessionService == null ? undefined : new OwnerDeviceCredentialService(ownedUserDb, userAccessRepository, mobileSessionService));\n\n  const ownerPrincipal = options.tokenVerifier.ownerPrincipal;',
  '  const ownerDeviceCredentialService = options.ownerDeviceCredentialService ?? (ownedUserDb == null || mobileSessionService == null ? undefined : new OwnerDeviceCredentialService(ownedUserDb, userAccessRepository, mobileSessionService));\n  const anonymousObservation: AnonymousObservationScope | null = anonymousObservationEnabled() ? createAnonymousObservationScope() : null;\n\n  const ownerPrincipal = options.tokenVerifier.ownerPrincipal;',
  "server scope");
const marker = '      const dashboardRequest: DashboardHttpRequest & { readonly body?: string } = Object.freeze({ method: req.method ?? "GET", headers: Object.freeze({ ...req.headers } as Record<string, string | undefined>), ...(body === undefined ? {} : { body }) });\n';
const wiring = `${marker}\n      const servedAnonymously = anonymousObservation != null && isAnonymousObservationRoute(req.url) && !hasBearerToken(dashboardRequest.headers);\n      const observationRequest: DashboardHttpRequest = servedAnonymously && anonymousObservation != null\n        ? Object.freeze({ ...dashboardRequest, headers: Object.freeze({ ...dashboardRequest.headers, authorization: \`Bearer \${anonymousObservation.sentinel}\` }) })\n        : dashboardRequest;\n      const observationTokenVerifier: DashboardTokenVerifier = Object.freeze({\n        ...(ownerPrincipal == null ? {} : { ownerPrincipal }),\n        verify(token: string) {\n          if (servedAnonymously && anonymousObservation != null && token === anonymousObservation.sentinel) { requestPrincipal = anonymousObservation.principal; return anonymousObservation.principal; }\n          return requestTokenVerifier.verify(token);\n        }\n      });\n`;
server = replaceOnce(server, marker, wiring, "server request wiring");
for (const route of ["paper-operations", "shadow-operations", "live-readiness", "engineering-operations", "evolution-learning", "dashboard"]) {
  const escaped = route.replaceAll("-", "_");
  const routeLiteral = `/api/${route}`;
  const line = server.split("\n").find((value) => value.includes(`req.url === "${routeLiteral}"`));
  if (!line) throw new Error(`missing route ${routeLiteral}`);
  const replacement = line.replaceAll("dashboardRequest", "observationRequest").replaceAll("requestTokenVerifier", "observationTokenVerifier");
  server = replaceOnce(server, line, replacement, `route ${escaped}`);
}
fs.writeFileSync(serverPath, server);

const appPath = "apps/mobile/App.tsx";
let app = fs.readFileSync(appPath, "utf8");
app = replaceOnce(app,
  'import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./src/personalPaperOperationsClient";\n',
  'import { loadPersonalPaperOperations, type PersonalPaperOperationsLoadResult } from "./src/personalPaperOperationsClient";\nimport { loadAnonymousPaperObservation } from "./src/observation/anonymousObservationClient";\n',
  "app import");
const oldBoundary = '      setRealReadOnlyOperations({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before REAL_READ_ONLY reads." });\n      setLiveReadinessOperations({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before LIVE readiness reads." });\n      return Promise.resolve();';
const newBoundary = '      setRealReadOnlyOperations({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before REAL_READ_ONLY reads." });\n      setLiveReadinessOperations({ status: "NOT_CONFIGURED", reason: "PAPER endpoint must be verified before LIVE readiness reads." });\n      const observation = (async () => {\n        const result = await loadAnonymousPaperObservation();\n        if (generation !== refreshGenerationRef.current) return;\n        const current = getConfiguredPaperEndpoint();\n        if (current != null && isPaperConnectionVerified(current)) return;\n        if (result.status === "READY") setOperations({ status: "READY", snapshot: result.snapshot });\n      })();\n      const clearObservation = () => { if (refreshInFlightRef.current === observation) refreshInFlightRef.current = null; };\n      refreshInFlightRef.current = observation;\n      void observation.then(clearObservation, clearObservation);\n      return observation;';
app = replaceOnce(app, oldBoundary, newBoundary, "app unverified-session boundary");
fs.writeFileSync(appPath, app);
