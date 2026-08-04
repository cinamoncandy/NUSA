import { RuntimeCompositionRoot } from "../../../packages/core/src/runtimeCompositionRoot";
import type { EngineState } from "../../../packages/core/src/engineRegistry";
import { startMobileBridge, type MobileBridgeHandle, type MobileBridgeOptions } from "./mobileBridge";
import { createPaperCommandEngine, PaperRuntimeIntegration } from "./paperRuntimeIntegration";
import { RuntimeCommandService } from "./runtimeCommandService";

export interface DesktopCompositionRootOptions {
  readonly commands: RuntimeCommandService;
  readonly getMonitorOptions?: () => MobileBridgeOptions | undefined;
  readonly monitorStarter?: (options: MobileBridgeOptions) => MobileBridgeHandle;
}

/** Desktop host adapter over the shared, transport-agnostic RuntimeCompositionRoot. */
export class DesktopCompositionRoot {
  private readonly commands: RuntimeCommandService;
  private readonly runtime: RuntimeCompositionRoot;
  private readonly getMonitorOptions: (() => MobileBridgeOptions | undefined) | undefined;
  private readonly monitorStarter: (options: MobileBridgeOptions) => MobileBridgeHandle;
  private monitor: MobileBridgeHandle | undefined;
  readonly paperRuntime: PaperRuntimeIntegration;

  constructor(options: DesktopCompositionRootOptions) {
    this.commands = options.commands;
    this.runtime = new RuntimeCompositionRoot([createPaperCommandEngine(this.commands)]);
    this.paperRuntime = new PaperRuntimeIntegration(this.runtime);
    this.getMonitorOptions = options.getMonitorOptions;
    this.monitorStarter = options.monitorStarter ?? startMobileBridge;
  }

  async startRuntime(): Promise<void> {
    try {
      await this.runtime.start();
    } catch (error) {
      this.commands.markUnavailable();
      throw error;
    }
  }

  async stopRuntime(): Promise<void> {
    try {
      await this.runtime.stop();
    } finally {
      this.commands.markUnavailable();
    }
  }

  startMonitor(): MobileBridgeHandle | undefined {
    if (this.monitor) return this.monitor;
    const options = this.getMonitorOptions?.();
    if (!options) return undefined;
    this.monitor = this.monitorStarter(options);
    return this.monitor;
  }

  async stopMonitor(): Promise<void> {
    const monitor = this.monitor;
    this.monitor = undefined;
    await monitor?.stop();
  }

  commandService(): RuntimeCommandService {
    return this.paperRuntime.commandService();
  }

  isRuntimeStarted(): boolean {
    return this.paperRuntime.isStarted();
  }

  engineStates(): readonly { id: string; state: EngineState }[] {
    return this.runtime.engineStates();
  }
}
