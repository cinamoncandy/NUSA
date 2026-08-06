import type { DashboardPrincipal } from "./mobileDashboardHttp";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";

/**
 * Reads the current dashboard state without inventing operational data.
 * Returning undefined means the state is not ready and must remain unavailable.
 */
export interface CloudDashboardStateProvider {
  read(principal: DashboardPrincipal): MobileDashboardApiInput | undefined;
  set(state: MobileDashboardApiInput): void;
  clear(): void;
}

/**
 * Explicit in-memory provider for composition and tests until durable cloud state exists.
 * It starts empty, so a fresh runtime remains fail-closed with HTTP 503.
 */
export class InMemoryCloudDashboardStateProvider implements CloudDashboardStateProvider {
  private state: MobileDashboardApiInput | undefined;

  public constructor(initialState?: MobileDashboardApiInput) {
    this.state = initialState;
  }

  public read(_principal: DashboardPrincipal): MobileDashboardApiInput | undefined {
    return this.state;
  }

  public set(state: MobileDashboardApiInput): void {
    this.state = state;
  }

  public clear(): void {
    this.state = undefined;
  }
}
