import type { Engine, EngineState } from "./engineRegistry";
import { NusaRuntime } from "./runtime";

/**
 * The production entry point for constructing and operating one NusaRuntime.
 * It registers engines during composition but starts no engine until start() is called.
 */
export class RuntimeCompositionRoot {
  private readonly runtime: NusaRuntime;
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;

  constructor(engines: readonly Engine[]) {
    this.runtime = new NusaRuntime();
    for (const engine of engines) this.runtime.engines.register(engine);
  }

  async start(): Promise<void> {
    if (this.stopPromise) throw new Error("runtime composition is stopping");
    if (this.runtime.isStarted()) return;
    if (!this.startPromise) {
      this.startPromise = this.runtime.start().finally(() => { this.startPromise = undefined; });
    }
    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    const starting = this.startPromise;
    this.stopPromise = (async () => {
      await starting?.catch(() => undefined);
      await this.runtime.stop();
    })().finally(() => { this.stopPromise = undefined; });
    return this.stopPromise;
  }

  resolve<T>(service: string): T {
    return this.runtime.services.resolve<T>(service);
  }

  isStarted(): boolean {
    return this.runtime.isStarted();
  }

  engineStates(): readonly { id: string; state: EngineState }[] {
    return this.runtime.engines.list();
  }
}
