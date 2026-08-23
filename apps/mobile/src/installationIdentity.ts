type StringStorage = Readonly<{
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}>;

const INSTALLATION_KEY = "nusa.mobile.installation-id.v1";

function randomInstallationId(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?(target: Uint8Array): Uint8Array } }).crypto;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else {
    const seed = `${Date.now()}-${Math.random()}-${Math.random()}`;
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = seed.charCodeAt(index % seed.length) & 0xff;
  }
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
