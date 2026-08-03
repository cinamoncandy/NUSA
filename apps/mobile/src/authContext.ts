import { createContext, useContext } from "react";
import type { SecureStoragePort } from "./mobileSecurity";

export type AuthStatus = "CHECKING" | "SIGNED_OUT" | "SIGNED_IN";

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly secureStorage?: SecureStoragePort;
  readonly signIn: () => void;
  readonly signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("useAuth must be used within AuthContext");
  return value;
}
