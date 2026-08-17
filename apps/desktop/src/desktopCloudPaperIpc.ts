import type { IpcMain } from "electron";
import { CloudPaperAccessSession } from "./cloudPaperAccessSession";
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

function provisionFromEnvironment(session: CloudPaperAccessSession): void {
  const endpoint = process.env.NUSA_CLOUD_PAPER_ENDPOINT?.trim();
  const accessValue = process.env.NUSA_CLOUD_PAPER_ACCESS_TOKEN?.trim();
  try {
    if (!endpoint && !accessValue) return;
    if (!endpoint || !accessValue) throw new Error("Cloud PAPER endpoint and access credential must be supplied together.");
    session.connect(endpoint, accessValue);
  } finally {
    // The already-issued Cloud stable-user bearer may be injected by the launcher, but it is
    // not retained in process.env after bootstrap. The live copy remains only in the private
    // main-process session closure and is never returned through IPC.
    delete process.env.NUSA_CLOUD_PAPER_ACCESS_TOKEN;
  }
}

export function registerDesktopCloudPaperIpc(ipcMain: Pick<IpcMain, "handle">): DesktopCloudPaperIpcHandle {
  const session = new CloudPaperAccessSession();
  provisionFromEnvironment(session);
  const client = new CloudPaperClient({ session });
  const authority = new DesktopCloudPaperAuthority({ client });

  ipcMain.handle("cloud-paper:status", () => session.snapshot());
  ipcMain.handle("cloud-paper:snapshot", async () => authority.snapshot());
  ipcMain.handle("cloud-paper:order", async (_event, input: unknown) => {
    const { side, quantity } = readOrderInput(input);
    return authority.placeOrder(side, quantity);
  });
  ipcMain.handle("cloud-paper:automatic-unavailable", () => {
    throw new Error("Desktop automatic strategy execution is disabled in CLOUD_PAPER mode until the canonical strategy migration successor is merged.");
  });

  const snapshot = session.snapshot();
  return Object.freeze({ configured: snapshot.configured, endpoint: snapshot.endpoint });
}
