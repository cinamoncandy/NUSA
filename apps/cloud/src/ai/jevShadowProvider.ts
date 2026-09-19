import type { JevShadowDecision } from "./jevShadowRouter";

const DEFAULT_ENDPOINT = "https://api.jev.ai/v1/classify";

export interface JevHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}
export type JevFetch = (url: string, init: {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}) => Promise<JevHttpResponse>;

export interface JevProviderOptions {
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: JevFetch;
}

const defaultFetch: JevFetch = async (url, init) =>
  fetch(url, { method: init.method, headers: { ...init.headers }, body: init.body, signal: init.signal });

const namedError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

export class JevShadowProvider {
  #apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: JevFetch;

  public constructor(options: JevProviderOptions) {
    this.#apiKey = options.apiKey.trim();
    this.endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).trim();
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    if (!this.#apiKey || !this.endpoint) throw new Error("Jev provider configuration incomplete");
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 10_000) throw new Error("Jev provider timeout invalid");
  }

  public async classify(input: Readonly<Record<string, unknown>>): Promise<JevShadowDecision> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: JevHttpResponse;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: Object.freeze({ Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" }),
        body: JSON.stringify({ input, authority: "ZERO_AUTHORITY", mode: "SHADOW" }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw namedError("TimeoutError", "Jev provider timed out");
      throw namedError("JevProviderUnavailableError", "Jev provider unavailable");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw namedError("JevProviderUnavailableError", `Jev provider HTTP failure ${response.status}`);
    let parsed: unknown;
    try { parsed = JSON.parse(await response.text()) as unknown; }
    catch { throw namedError("MalformedJevResponseError", "Jev provider response malformed"); }
    return parsed as JevShadowDecision;
  }
}

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";
const text = (value: string | undefined): string | null => value?.trim() || null;

export function createJevShadowProviderFromEnvironment(env: NodeJS.ProcessEnv = process.env): JevShadowProvider | null {
  if (!enabled(env.NUSA_JEV_SHADOW_ENABLED)) return null;
  const apiKey = text(env.NUSA_JEV_API_KEY);
  if (apiKey == null) return null;
  const endpoint = text(env.NUSA_JEV_ENDPOINT) ?? undefined;
  const rawTimeout = text(env.NUSA_JEV_TIMEOUT_MS);
  const timeoutMs = rawTimeout == null ? undefined : Number(rawTimeout);
  try { return new JevShadowProvider({ apiKey, endpoint, timeoutMs }); }
  catch { return null; }
}
