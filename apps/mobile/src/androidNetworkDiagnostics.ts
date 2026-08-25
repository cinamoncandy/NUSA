/**
 * Read-only bridge onto NusaNetworkDiagnosticsModule.java. Exposes only what the native OkHttp
 * layer actually put on the wire for the last request -- URL, method, User-Agent -- so a failed
 * public quotation call can report the real value instead of what the JS caller assumed. There
 * is no write path: nothing in this file, or the native module it calls, can be used to inject
 * or alter a request.
 */
export interface NativeRequestDiagnostic {
  readonly requestUrl: string;
  readonly method: string;
  readonly userAgent: string | null;
  readonly capturedAtEpochMs: number;
}

interface NusaNetworkDiagnosticsNativeModule {
  getLastRequest(): Promise<NativeRequestDiagnostic | null>;
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
  } catch { return null; }
}

function nativeModule(): NusaNetworkDiagnosticsNativeModule | null {
  const bridge = loadReactNativeBridge();
  if (bridge == null || bridge.Platform.OS !== "android") return null;
  const module = bridge.NativeModules.NusaNetworkDiagnostics as Partial<NusaNetworkDiagnosticsNativeModule> | undefined;
  if (module == null || typeof module.getLastRequest !== "function") return null;
  return module as NusaNetworkDiagnosticsNativeModule;
}

/**
 * Best-effort only: a missing module, a platform without one, or a native call failure all
 * resolve to `null` rather than throwing, because this is diagnostic context for an error the
 * caller is already handling -- it must never become a second failure of its own.
 */
export async function readNativeRequestDiagnostic(): Promise<NativeRequestDiagnostic | null> {
  const module = nativeModule();
  if (module == null) return null;
  try {
    return await module.getLastRequest();
  } catch {
    return null;
  }
}
