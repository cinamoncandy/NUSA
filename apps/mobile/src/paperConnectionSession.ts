let configuredEndpoint: string | null = null;

/** Process-local mirror of the persisted non-secret PAPER endpoint. Credentials never enter this module. */
export function setConfiguredPaperEndpoint(value: string): void {
  const endpoint = value.trim().replace(/\/+$/, "");
  configuredEndpoint = endpoint || null;
}

export function getConfiguredPaperEndpoint(): string | null { return configuredEndpoint; }
export function clearConfiguredPaperEndpoint(): void { configuredEndpoint = null; }
