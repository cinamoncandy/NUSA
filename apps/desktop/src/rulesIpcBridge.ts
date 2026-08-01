import type { RulesControlPlaneProjection } from "../../../packages/contracts/src/rules";

export const RULES_STATUS_CHANNEL = "rules:status:get" as const;

export type RulesStatusReadResult =
  | { readonly ok: true; readonly projection: RulesControlPlaneProjection }
  | { readonly ok: false; readonly status: "NO_DATA" | "UNAVAILABLE"; readonly message: "Rules status is not available" };

export interface RulesProjectionSource {
  current(): RulesControlPlaneProjection | null;
}

export interface RulesReadOnlyRegistrar {
  handle(channel: string, listener: () => unknown): void;
}

export class InMemoryRulesProjectionSource implements RulesProjectionSource {
  private projection: RulesControlPlaneProjection | null = null;

  publish(projection: RulesControlPlaneProjection): void { this.projection = projection; }
  clear(): void { this.projection = null; }
  current(): RulesControlPlaneProjection | null { return this.projection; }
}

export function registerRulesReadOnlyIpc(registrar: RulesReadOnlyRegistrar, source: RulesProjectionSource): void {
  registrar.handle(RULES_STATUS_CHANNEL, (): RulesStatusReadResult => {
    const projection = source.current();
    return projection == null
      ? { ok: false, status: "NO_DATA", message: "Rules status is not available" }
      : { ok: true, projection };
  });
}
