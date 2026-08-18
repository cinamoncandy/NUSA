import path from "node:path";
import { app, safeStorage } from "electron";
import { DesktopCloudSessionClient } from "./desktopCloudSessionClient";
import { DesktopCloudSessionStore } from "./desktopCloudSessionStore";

const SESSION_FILE = "cloud-paper-session.v1.json";

/** Main-process-only factory. No credential or secure-storage primitive is exported to preload/renderer. */
export function createDesktopCloudSessionClient(): DesktopCloudSessionClient {
  if (!app.isReady()) throw new Error("Electron app must be ready before desktop cloud session initialization");
  const filePath = path.join(app.getPath("userData"), SESSION_FILE);
  return new DesktopCloudSessionClient(new DesktopCloudSessionStore(safeStorage, filePath));
}
