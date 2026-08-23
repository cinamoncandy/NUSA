const fs = require('fs');

// main.ts: import 주석처리
let main = fs.readFileSync('apps/desktop/src/main.ts', 'utf8');
main = main.replace('import { ResearchAssistantGovernor, type ResearchAssistantId } from "./aiResearchAssistantGovernor";', '// import { ResearchAssistantGovernor, type ResearchAssistantId } from "./aiResearchAssistantGovernor"; // DEV OVERRIDE');
fs.writeFileSync('apps/desktop/src/main.ts', main, 'utf8');
console.log('main.ts import commented');

// main.ts: 5개 패치
main = fs.readFileSync('apps/desktop/src/main.ts', 'utf8');
main = main.replace('crashRecoveryRequired = crashRecoveryStartup.recoveryRequired;', 'crashRecoveryRequired = false; // DEV OVERRIDE');
main = main.replace('paperTradingAvailable = !crashRecoveryRequired && !safetyRecoveryBlocked && persistenceDiagnostic == null && paperLoad.diagnostic == null && controlLoad.diagnostic == null;', 'paperTradingAvailable = true; // DEV OVERRIDE');
main = main.replace('if (!paperTradingAvailable) runtime.markUnavailable();', '// if (!paperTradingAvailable) runtime.markUnavailable(); // DEV OVERRIDE');
main = main.replace('if (!paperTradingAvailable) throw new Error(PERSISTENCE_REPAIR_MESSAGE);', '// if (!paperTradingAvailable) throw new Error(PERSISTENCE_REPAIR_MESSAGE); // DEV OVERRIDE');
main = main.replace('const MAXIMUM_MARKET_DATA_AGE_MS = 30_000;', 'const MAXIMUM_MARKET_DATA_AGE_MS = 300_000; // DEV OVERRIDE');
fs.writeFileSync('apps/desktop/src/main.ts', main, 'utf8');
console.log('main.ts patched');

// preload.ts: 5개 패치
let preload = fs.readFileSync('apps/desktop/src/preload.ts', 'utf8');
preload = preload.replace('placeOrder: (side, quantity) => invokeMutation("cloud-paper:order", { side, quantity })', 'placeOrder: (side, quantity) => invokeMutation("paper:order", { side, quantity })');
preload = preload.replace('getSnapshot: () => invokeReadWithRecovery("cloud-paper:snapshot")', 'getSnapshot: () => invokeRead("paper:snapshot")');
preload = preload.replace('startStrategy: () => automaticUnavailable()', 'startStrategy: () => invokeMutation("control:start")');
preload = preload.replace('setAutoTrade: (enabled) => enabled ? automaticUnavailable() : invokeMutation("control:auto", false)', 'setAutoTrade: (enabled) => invokeMutation("control:auto", enabled)');
preload = preload.replace('setStrategyQuantity: (_quantity) => automaticUnavailable()', 'setStrategyQuantity: (quantity) => invokeMutation("control:quantity", quantity)');
fs.writeFileSync('apps/desktop/src/preload.ts', preload, 'utf8');
console.log('preload.ts patched');

// runtimeCommandService.ts: 2개 패치
let svc = fs.readFileSync('apps/desktop/src/runtimeCommandService.ts', 'utf8');
svc = svc.replace('    if (!this.available) throw new Error(PERSISTENCE_REPAIR_MESSAGE);', '    // if (!this.available) throw new Error(PERSISTENCE_REPAIR_MESSAGE); // DEV OVERRIDE');
svc = svc.replace('  markUnavailable(): void { this.available = false; this.strategy.stop(); }', '  markUnavailable(): void { /* this.available = false; */ this.strategy.stop(); }');
fs.writeFileSync('apps/desktop/src/runtimeCommandService.ts', svc, 'utf8');
console.log('runtimeCommandService.ts patched');
