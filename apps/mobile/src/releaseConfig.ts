import { NativeModules, Platform } from "react-native";
import { normalizePaperEndpoint } from "./settings";

interface NusaBuildConfigNativeModule {
  readonly apiBaseUrl?: string;
}

const nativeConfig = (): NusaBuildConfigNativeModule | undefined => {
  if (Platform.OS !== "android") return undefined;
  const value = NativeModules.NusaBuildConfig as NusaBuildConfigNativeModule | undefined;
  return value;
};

/** Non-secret endpoint compiled into the Android build. Credentials are never exposed here. */
export function getReleasePaperEndpoint(): string {
  return normalizePaperEndpoint(nativeConfig()?.apiBaseUrl);
}

/** User override wins; otherwise use the physical-device release gateway. */
export function resolveRuntimePaperEndpoint(explicitEndpoint: string | undefined): string {
  const explicit = normalizePaperEndpoint(explicitEndpoint);
  return explicit || getReleasePaperEndpoint();
}
