import { Plugin, PluginContext } from "../../core/src/pluginSystem";
import { AiposStore } from "./store";
import { RecoveryEngine } from "./recovery";
import { AiposValidator } from "./validator";

export interface AiposPluginOptions {
  readonly store: AiposStore;
  readonly servicePrefix?: string;
}

export class AiposPlugin implements Plugin {
  readonly id = "aipos";
  readonly version = "0.1.0";

  private context?: PluginContext;

  constructor(private readonly options: AiposPluginOptions) {}

  async register(context: PluginContext): Promise<void> {
    if (this.context) throw new Error("AIPOS plugin is already registered");
    this.context = context;

    const prefix = this.options.servicePrefix ?? "aipos";
    const validator = new AiposValidator();
    const recovery = new RecoveryEngine(this.options.store, validator);

    context.services.register(`${prefix}.store`, this.options.store);
    context.services.register(`${prefix}.validator`, validator);
    context.services.register(`${prefix}.recovery`, recovery);
  }

  async dispose(): Promise<void> {
    this.context = undefined;
  }
}
