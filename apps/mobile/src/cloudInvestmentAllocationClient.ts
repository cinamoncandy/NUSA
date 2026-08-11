import type { DashboardCredentialProvider } from "./dashboardCredentialSession";
import { getConfiguredPaperEndpoint, isPaperConnectionVerified } from "./paperConnectionSession";

export interface CloudInvestmentAllocationClient { readonly save: (investmentPercent: number) => Promise<void>; }

export function createCloudInvestmentAllocationClient(options: { readonly credentialProvider: DashboardCredentialProvider; readonly request?: typeof fetch }): CloudInvestmentAllocationClient {
  return Object.freeze({
    save: async (investmentPercent: number): Promise<void> => {
      if (!Number.isFinite(investmentPercent) || investmentPercent < 0 || investmentPercent > 100) throw new Error("Investment allocation must be between 0 and 100%.");
      const endpoint = getConfiguredPaperEndpoint();
      if (!endpoint || !isPaperConnectionVerified(endpoint)) throw new Error("Verify the PAPER connection before changing investment allocation.");
      const token = await options.credentialProvider();
      if (!token?.trim()) throw new Error("Cloud settings authentication is required.");
      const target = new URL("/api/settings/investment-allocation", `${endpoint}/`).href;
      const response = await (options.request ?? fetch)(target, {
        method: "PUT",
        headers: { authorization: `Bearer ${token.trim()}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ investmentPercent })
      });
      if (getConfiguredPaperEndpoint() !== endpoint || !isPaperConnectionVerified(endpoint)) throw new Error("PAPER connection changed while investment allocation was being saved.");
      if (!response.ok) throw new Error(`Cloud investment allocation save failed (${response.status}).`);
    }
  });
}
