export interface OwnerDeviceCredentialStatus {
  readonly available: boolean;
  readonly canCreate: boolean;
  readonly hardwareBacked: boolean;
  readonly status: string;
  readonly credentialId: string | null;
}

export interface OwnerDeviceCredentialNative {
  getStatus(): Promise<OwnerDeviceCredentialStatus>;
  createCredential(): Promise<Readonly<{ credentialId: string; publicKeySpki: string; hardwareBacked: boolean }>>;
  signChallenge(credentialId: string, challengeBase64: string, promptMessage: string): Promise<string>;
  deleteCredential(credentialId: string): Promise<void>;
  getSilentDeviceStatus(): Promise<OwnerDeviceCredentialStatus>;
  createSilentDeviceCredential(): Promise<Readonly<{ credentialId: string; publicKeySpki: string; hardwareBacked: boolean }>>;
  signSilentChallenge(credentialId: string, challengeBase64: string): Promise<string>;
  deleteSilentDeviceCredential(credentialId: string): Promise<void>;
}

interface ReactNativeBridge {
  readonly NativeModules: Readonly<Record<string, unknown>>;
  readonly Platform: Readonly<{ OS: string }>;
}

function bridge(): ReactNativeBridge | null {
  try {
    const value = require("react-native") as Partial<ReactNativeBridge>;
    return value.NativeModules != null && value.Platform != null ? value as ReactNativeBridge : null;
  } catch { return null; }
}

function nativeModule(): OwnerDeviceCredentialNative | null {
  const value = bridge();
  if (value == null || value.Platform.OS !== "android") return null;
  const module = value.NativeModules.NusaOwnerDeviceCredential as Partial<OwnerDeviceCredentialNative> | undefined;
  if (module == null || typeof module.getStatus !== "function" || typeof module.createCredential !== "function" || typeof module.signChallenge !== "function" || typeof module.deleteCredential !== "function" || typeof module.getSilentDeviceStatus !== "function" || typeof module.createSilentDeviceCredential !== "function" || typeof module.signSilentChallenge !== "function" || typeof module.deleteSilentDeviceCredential !== "function") return null;
  return module as OwnerDeviceCredentialNative;
}

/** iOS and web deliberately fail closed until they have an equivalent native credential adapter. */
export function ownerDeviceCredential(): OwnerDeviceCredentialNative | null { return nativeModule(); }
