export interface NativeUpbitPublicQuotationResponse {
  readonly status: number;
  readonly body: string;
  readonly requestUrl: string;
  readonly userAgent: string;
  readonly contentType: string | null;
}

interface NusaUpbitPublicQuotationNativeModule {
  getTicker(timeoutMs: number): Promise<NativeUpbitPublicQuotationResponse>;
  getCandles(market: string, count: number, timeoutMs: number): Promise<NativeUpbitPublicQuotationResponse>;
}

interface ReactNativeBridge {
  readonly NativeModules: Readonly<Record<string, unknown>>;
  readonly Platform: Readonly<{ OS: string }>;
}

function loadReactNativeBridge(): ReactNativeBridge | null {
  try {
    const bridge = require("react-native") as Partial<ReactNativeBridge>;
    if (bridge.Platform == null || bridge.NativeModules == null) return null;
    return bridge as ReactNativeBridge;
  } catch {
    return null;
  }
}

function nativeModule(): NusaUpbitPublicQuotationNativeModule | null {
  const bridge = loadReactNativeBridge();
  if (bridge == null || bridge.Platform.OS !== "android") return null;
  const module = bridge.NativeModules.NusaUpbitPublicQuotation as Partial<NusaUpbitPublicQuotationNativeModule> | undefined;
  if (module == null || typeof module.getTicker !== "function" || typeof module.getCandles !== "function") return null;
  return module as NusaUpbitPublicQuotationNativeModule;
}

/**
 * Returns null only when the Android bridge is not available (Node tests, iOS, or an old native
 * binary). Once the native Android module exists, transport failures are deliberately propagated
 * rather than silently falling back to React Native fetch(), because that is the path real-device
 * evidence already proved can produce the Upbit HTTP 400 loop.
 */
export async function requestNativeAndroidUpbitTicker(timeoutMs: number): Promise<NativeUpbitPublicQuotationResponse | null> {
  const module = nativeModule();
  if (module == null) return null;
  return await module.getTicker(timeoutMs);
}

export async function requestNativeAndroidUpbitCandles(
  market: string,
  count: number,
  timeoutMs: number,
): Promise<NativeUpbitPublicQuotationResponse | null> {
  const module = nativeModule();
  if (module == null) return null;
  return await module.getCandles(market, count, timeoutMs);
}
