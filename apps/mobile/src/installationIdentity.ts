type StringStorage = Readonly<{
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}>;

const INSTALLATION_KEY = "nusa.mobile.installation-id.v1";

function randomInstallationId(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?(target: Uint8Array): Uint8Array } }).crypto;
  if (typeof cryptoApi?.getRandomValues !== "function") throw new Error("secure installation identity entropy is unavailable");
  cryptoApi.getRandomValues(bytes);
  return `nusa-install-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function getOrCreateInstallationId(storage: StringStorage): Promise<string> {
  const existing = (await storage.getItem(INSTALLATION_KEY))?.trim();
  if (existing && existing.length >= 8 && existing.length <= 256) return existing;
  const created = randomInstallationId();
  await storage.setItem(INSTALLATION_KEY, created);
  return created;
}

export { INSTALLATION_KEY };
