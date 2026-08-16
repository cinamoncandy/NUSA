import type { DashboardCredentialProvider } from "./dashboardCredentialSession";
import type { MobileSessionAccess } from "./personalPaperOperationsClient";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";

export interface CloudInvestmentAllocationClient {
  readonly load: () => Promise<number>;
  readonly save: (investmentPercent: number) => Promise<void>;
}

const context = async (credentialProvider: DashboardCredentialProvider | undefined, sessionProvider: MobileSessionAccess | undefined): Promise<{ endpoint: string; authorization: string; target: string }> => {
  const endpoint = getConfiguredPaperEndpoint();
  if (!endpoint || !isPaperConnectionVerified(endpoint)) throw new Error("NUSA Cloud origin is unavailable.");
  const authorization = sessionProvider ? await sessionProvider.authorizationHeader() : `Bearer ${(await credentialProvider?.() ?? "").trim()}`;
  if (!/^Bearer\s+\S+$/.test(authorization)) throw new Error("NUSA Cloud mobile session is unavailable.");
  return { endpoint, authorization, target: new URL("/api/settings/investment-allocation", `${endpoint}/`).href };
};
const assertStable = (endpoint: string): void => { if (getConfiguredPaperEndpoint() !== endpoint || !isPaperConnectionVerified(endpoint)) throw new Error("PAPER connection changed while investment allocation was being synchronized."); };
const normalizedPercent = (value: unknown): number => { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error("Cloud investment allocation response is invalid."); return Math.round(value * 100) / 100; };

export function createCloudInvestmentAllocationClient(options: { readonly credentialProvider?: DashboardCredentialProvider; readonly sessionProvider?: MobileSessionAccess; readonly request?: typeof fetch }): CloudInvestmentAllocationClient {
  const request = options.request ?? fetch;
  return Object.freeze({
    load: async (): Promise<number> => {
      const { endpoint, authorization, target } = await context(options.credentialProvider, options.sessionProvider);
      const response = await request(target, { method: "GET", headers: { authorization, accept: "application/json" } });
      assertStable(endpoint);
      if (!response.ok) throw new Error(`Cloud investment allocation load failed (${response.status}).`);
      const payload = await response.json() as Record<string, unknown>;
      return normalizedPercent(payload.investmentPercent);
    },
    save: async (investmentPercent: number): Promise<void> => {
      const value = normalizedPercent(investmentPercent);
      const { endpoint, authorization, target } = await context(options.credentialProvider, options.sessionProvider);
      const response = await request(target, { method: "PUT", headers: { authorization, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ investmentPercent: value }) });
      assertStable(endpoint);
      if (!response.ok) throw new Error(`Cloud investment allocation save failed (${response.status}).`);
    }
  });
}
