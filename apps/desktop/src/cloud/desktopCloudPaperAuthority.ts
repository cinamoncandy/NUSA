import { randomUUID } from "node:crypto";
import type { PersonalPaperOrderSide } from "../../../../packages/contracts/src/personalPaperOrderCommand";
import type { PaperAccountSnapshot, PaperOrder } from "../paper/paperBroker";
import { CloudPaperClient } from "./cloudPaperClient";
import { projectCloudPaperOrder, projectCloudPaperSnapshot } from "./cloudPaperProjection";

export interface DesktopCloudPaperAuthorityOptions {
  readonly client: CloudPaperClient;
  readonly market?: string;
  readonly now?: () => number;
  readonly createId?: () => string;
}

export interface DesktopCloudPaperOrderResult {
  readonly order: PaperOrder;
  readonly snapshot: PaperAccountSnapshot;
}

/**
 * Thin Desktop-side adapter over the canonical Cloud PAPER command/query contract.
 * It has no PaperBroker reference, so Cloud failure cannot silently become a local fill.
 */
export class DesktopCloudPaperAuthority {
  private readonly market: string;
  private readonly now: () => number;
  private readonly createId: () => string;

  public constructor(private readonly options: DesktopCloudPaperAuthorityOptions) {
    this.market = options.market ?? "KRW-BTC";
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  public async snapshot(): Promise<PaperAccountSnapshot | null> {
    const result = await this.options.client.loadOperations();
    if (result.status !== "READY") throw new Error(result.reason);
    return projectCloudPaperSnapshot(result.value);
  }

  public async placeOrder(side: PersonalPaperOrderSide, quantity: number): Promise<DesktopCloudPaperOrderResult> {
    const idempotencyKey = `desktop:${this.now()}:${this.createId()}`;
    const result = await this.options.client.submitOrder(Object.freeze({
      schemaVersion: 1,
      authority: "PAPER_ONLY",
      productionMutationAllowed: false,
      idempotencyKey,
      market: this.market,
      side,
      orderType: "MARKET",
      quantity
    }));
    if (result.status !== "READY") throw new Error(result.reason);
    const canonical = result.value;
    if (canonical.status === "BLOCKED" || canonical.status === "REJECTED") {
      throw new Error(canonical.reason ?? `Cloud PAPER order ${canonical.status.toLowerCase()}.`);
    }
    if (canonical.order == null || canonical.snapshot == null) {
      throw new Error("Cloud PAPER order result is missing canonical state.");
    }
    const snapshot = projectCloudPaperSnapshot(canonical.snapshot);
    if (snapshot == null) throw new Error("Cloud PAPER account projection is unavailable.");
    return Object.freeze({ order: projectCloudPaperOrder(canonical.order), snapshot });
  }
}
