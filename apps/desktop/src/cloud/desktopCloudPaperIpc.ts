import type { IpcMain } from "electron";
import type { DesktopCloudSessionClient } from "./desktopCloudSessionClient";
import { CloudPaperClient } from "./cloudPaperClient";
import { DesktopCloudPaperAuthority } from "./desktopCloudPaperAuthority";

export interface DesktopCloudPaperIpcHandle {
  readonly configured: boolean;
  readonly endpoint: string | null;
}

function readOrderInput(input: unknown): Readonly<{ side: "BUY" | "SELL"; quantity: number }> {
  if (input == null || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid Cloud PAPER order input");
  const candidate = input as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(",") !== "quantity,side" ||
    (candidate.side !== "BUY" && candidate.side !== "SELL") ||
    typeof candidate.quantity !== "number" || !Number.isFinite(candidate.quantity) || candidate.quantity <= 0
  ) throw new Error("invalid Cloud PAPER order input");
  return Object.freeze({ side: candidate.side, quantity: candidate.quantity });
}

export async function provisionDesktopCloudPaperSession(
  session: DesktopCloudSessionClient,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const endpoint = env.NUSA_CLOUD_PAPER_ENDPOINT?.trim();
  const bootstrapToken = env.NUSA_CLOUD_PAPER_BOOTSTRAP_TOKEN?.trim();
  const prohibitedLegacyAccessToken = env.NUSA_CLOUD_PAPER_ACCESS_TOKEN?.trim();
  try {
    if (prohibitedLegacyAccessToken) throw new Error("Legacy Cloud PAPER access-token injection is prohibited; use the one-time Desktop bootstrap boundary.");
    if (bootstrapToken) {
      if (!endpoint) throw new Error("Cloud PAPER endpoint is required with the one-time Desktop bootstrap token.");
      await session.bootstrap(endpoint, bootstrapToken);
      return;
    }
    await session.restore();
  } finally {
    // Bootstrap and legacy bearer material must never remain in the long-lived Electron
    // environment. Refresh persistence is owned exclusively by Electron safeStorage.
    delete env.NUSA_CLOUD_PAPER_BOOTSTRAP_TOKEN;
    delete env.NUSA_CLOUD_PAPER_ACCESS_TOKEN;
  }
}

const rendererSafeStatus = (session: DesktopCloudSessionClient): Readonly<{
  configured: boolean;
  endpoint: string | null;
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
}> => {
  const snapshot = session.snapshot();
  return Object.freeze({
    configured: snapshot.connected,
    endpoint: snapshot.endpoint ?? null,
    ...(snapshot.accessExpiresAt == null ? {} : { accessExpiresAt: snapshot.accessExpiresAt }),
    ...(snapshot.refreshExpiresAt == null ? {} : { refreshExpiresAt: snapshot.refreshExpiresAt })
  });
};

export function registerDesktopCloudPaperIpc(
  ipcMain: Pick<IpcMain, "handle">,
  session: DesktopCloudSessionClient,
  env: NodeJS.ProcessEnv = process.env
): DesktopCloudPaperIpcHandle {
  let initializationError: Error | undefined;
  const initialization = provisionDesktopCloudPaperSession(session, env).catch((error) => {
    initializationError = error instanceof Error ? error : new Error("Cloud PAPER secure session initialization failed.");
  });
  const requireInitialized = async (): Promise<void> => {
    await initialization;
    if (initializationError) throw initializationError;
  };

  const client = new CloudPaperClient({ session });
  const authority = new DesktopCloudPaperAuthority({ client });

  ipcMain.handle("cloud-paper:status", async () => {
    await initialization;
    return rendererSafeStatus(session);
  });
  ipcMain.handle("cloud-paper:snapshot", async () => {
    await requireInitialized();
    return authority.snapshot();
  });
  ipcMain.handle("cloud-paper:order", async (_event, input: unknown) => {
    await requireInitialized();
    const { side, quantity } = readOrderInput(input);
    return authority.placeOrder(side, quantity);
  });
  ipcMain.handle("cloud-paper:automatic-unavailable", () => {
    throw new Error("Desktop automatic strategy execution is disabled in CLOUD_PAPER mode until the canonical strategy migration successor is merged.");
  });

  const snapshot = rendererSafeStatus(session);
  return Object.freeze({ configured: snapshot.configured, endpoint: snapshot.endpoint });
}
