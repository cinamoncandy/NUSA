const MAX_TOKEN_LENGTH = 4096;
let sharedToken: string | null = null;

export type UpbitCredentialProvider = () => Promise<string | null>;

export function clearUpbitCredentialSession(): void { sharedToken = null; }

/**
 * Process-memory-only credential for the personal Upbit bridge.
 * The token is never persisted to AsyncStorage or bundled into the APK.
 */
export class InMemoryUpbitCredentialSession {
  public connect(value: string): void {
    const token = value.trim();
    if (token.length < 16 || token.length > MAX_TOKEN_LENGTH) throw new Error("Upbit bridge credential is invalid.");
    sharedToken = token;
  }
  public clear(): void { clearUpbitCredentialSession(); }
  public isConfigured(): boolean { return sharedToken !== null; }
  public readonly credentialProvider: UpbitCredentialProvider = async () => sharedToken;
}
