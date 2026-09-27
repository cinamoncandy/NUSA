import type { JevShadowDecision } from "./jevShadowRouter";

interface JevHttpHeaders {
  get(name: string): string | null;
}

interface JevHttpBodyReader {
  read(): Promise<Readonly<{ done: boolean; value?: Uint8Array }>>;
  cancel(reason?: unknown): Promise<void> | void;
  releaseLock?(): void;
}

interface JevHttpBody {
  getReader(): JevHttpBodyReader;
}

export interface JevHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: JevHttpHeaders;
  readonly body?: JevHttpBody | null;
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

const MAX_RESPONSE_BYTES = 16 * 1024;

function responseTooLarge(): Error {
  return namedError("MalformedJevResponseError", "Jev provider response too large");
}

function declaredLength(response: JevHttpResponse): number | null {
  const raw = response.headers?.get("content-length");
  if (raw == null || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) throw namedError("MalformedJevResponseError", "Jev provider content length invalid");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw namedError("MalformedJevResponseError", "Jev provider content length invalid");
  return value;
}

async function readBoundedBody(response: JevHttpResponse, deadline: Promise<never>): Promise<string> {
  const length = declaredLength(response);
  if (length != null && length > MAX_RESPONSE_BYTES) throw responseTooLarge();

  const body = response.body;
  if (body?.getReader != null) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = "";
    try {
      for (;;) {
        const chunk = await Promise.race([reader.read(), deadline]);
        if (chunk.done) break;
        const value = chunk.value;
        if (!(value instanceof Uint8Array)) {
          throw namedError("MalformedJevResponseError", "Jev provider response chunk invalid");
        }
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel(responseTooLarge());
          throw responseTooLarge();
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } finally {
      reader.releaseLock?.();
    }
  }

  const text = await Promise.race([response.text(), deadline]);
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw responseTooLarge();
  return text;
}

export class JevShadowProvider {
  #apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: JevFetch;

  public constructor(options: JevProviderOptions) {
    this.#apiKey = options.apiKey.trim();
    this.endpoint = (options.endpoint ?? "").trim();
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    if (!this.#apiKey || !this.endpoint) throw new Error("Jev provider configuration incomplete");
    const parsedEndpoint = new URL(this.endpoint);
    if (parsedEndpoint.protocol !== "https:") throw new Error("Jev provider endpoint must use HTTPS");
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 10_000) throw new Error("Jev provider timeout invalid");
  }

  public async classify(input: Readonly<Record<string, unknown>>): Promise<JevShadowDecision> {
    const controller = new AbortController();
    let rejectDeadline: ((reason?: unknown) => void) | undefined;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const timer = setTimeout(() => {
      controller.abort();
      rejectDeadline?.(namedError("TimeoutError", "Jev provider timed out"));
    }, this.timeoutMs);
    let response: JevHttpResponse;
    try {
      response = await Promise.race([this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: Object.freeze({ Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" }),
        body: JSON.stringify({ input, authority: "ZERO_AUTHORITY", mode: "SHADOW" }),
        signal: controller.signal
      }), deadline]);
      if (!response.ok) throw namedError("JevProviderUnavailableError", `Jev provider HTTP failure ${response.status}`);
      const body = await readBoundedBody(response, deadline);
      let parsed: unknown;
      try { parsed = JSON.parse(body) as unknown; }
      catch { throw namedError("MalformedJevResponseError", "Jev provider response malformed"); }
      return parsed as JevShadowDecision;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw namedError("TimeoutError", "Jev provider timed out");
      if (error instanceof Error && (error.name === "JevProviderUnavailableError" || error.name === "MalformedJevResponseError")) throw error;
      throw namedError("JevProviderUnavailableError", "Jev provider unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";
const text = (value: string | undefined): string | null => value?.trim() || null;

export function createJevShadowProviderFromEnvironment(env: NodeJS.ProcessEnv = process.env): JevShadowProvider | null {
  if (!enabled(env.NUSA_JEV_SHADOW_ENABLED)) return null;
  const apiKey = text(env.NUSA_JEV_API_KEY);
  if (apiKey == null) return null;
  const endpoint = text(env.NUSA_JEV_ENDPOINT);
  if (endpoint == null) return null;
  const rawTimeout = text(env.NUSA_JEV_TIMEOUT_MS);
  const timeoutMs = rawTimeout == null ? undefined : Number(rawTimeout);
  try { return new JevShadowProvider({ apiKey, endpoint, timeoutMs }); }
  catch { return null; }
}
