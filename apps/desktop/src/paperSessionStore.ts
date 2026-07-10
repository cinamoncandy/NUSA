import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PaperBrokerState } from "./paperBroker";

export class PaperSessionStore {
  constructor(private readonly filePath: string) {}

  load(): PaperBrokerState | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as PaperBrokerState;
      if (parsed.version !== 1) throw new Error("unsupported paper session version");
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      throw error;
    }
  }

  save(state: PaperBrokerState): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }
}
