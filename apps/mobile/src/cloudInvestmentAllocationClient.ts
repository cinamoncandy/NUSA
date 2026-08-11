<<<<<<< HEAD
import type { DashboardCredentialProvider } from "./dashboardCredentialSession";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";

export interface CloudInvestmentAllocationClient {
  readonly load: () => Promise<number>;
  readonly save: (investmentPercent: number) => Promise<void>;
}

const context = async (credentialProvider: DashboardCredentialProvider): Promise<{ endpoint: string; token: string; target: string }> => {
  const endpoint = getConfiguredPaperEndpoint();
  if (!endpoint || !isPaperConnectionVerified(endpoint)) throw new Error("Verify the PAPER connection before using investment allocation.");
  const token = await credentialProvider();
  if (!token?.trim()) throw new Error("Cloud settings authentication is required.");
  return { endpoint, token: token.trim(), target: new URL("/api/settings/investment-allocation", `${endpoint}/`).href };
};
const assertStable = (endpoint: string): void => { if (getConfiguredPaperEndpoint() !== endpoint || !isPaperConnectionVerified(endpoint)) throw new Error("PAPER connection changed while investment allocation was being synchronized."); };
const normalizedPercent = (value: unknown): number => { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error("Cloud investment allocation response is invalid."); return Math.round(value * 100) / 100; };

export function createCloudInvestmentAllocationClient(options: { readonly credentialProvider: DashboardCredentialProvider; readonly request?: typeof fetch }): CloudInvestmentAllocationClient {
  const request = options.request ?? fetch;
  return Object.freeze({
    load: async (): Promise<number> => {
      const { endpoint, token, target } = await context(options.credentialProvider);
      const response = await request(target, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      assertStable(endpoint);
      if (!response.ok) throw new Error(`Cloud investment allocation load failed (${response.status}).`);
      const payload = await response.json() as Record<string, unknown>;
      return normalizedPercent(payload.investmentPercent);
    },
    save: async (investmentPercent: number): Promise<void> => {
      const value = normalizedPercent(investmentPercent);
      const { endpoint, token, target } = await context(options.credentialProvider);
      const response = await request(target, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ investmentPercent: value }) });
      assertStable(endpoint);
      if (!response.ok) throw new Error(`Cloud investment allocation save failed (${response.status}).`);
    }
  });
=======
import type { DashboardCredentialProvider } from "./personalPaperOperationsClient";
export interface CloudInvestmentAllocationClient { save(investmentPercent: number): Promise<void>; }
export function createCloudInvestmentAllocationClient(options: { readonly baseUrl: string; readonly credentialProvider: DashboardCredentialProvider; readonly request?: typeof fetch }): CloudInvestmentAllocationClient {
  return { async save(investmentPercent: number): Promise<void> { const token = await options.credentialProvider(); if (!token?.trim()) throw new Error("Cloud settings authentication is required."); const response = await (options.request ?? fetch)(`${options.baseUrl.replace(/\/+$/, "")}/api/settings/investment-allocation`, { method: "PUT", headers: { authorization: `Bearer ${token.trim()}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ investmentPercent }) }); if (!response.ok) throw new Error(`Cloud investment allocation save failed (${response.status}).`); } };
>>>>>>> e08cd51dae7c077f3b144de82a3893df39e4a7a9
}
