// @vitest-environment jsdom
// Executes apps/desktop/renderer/control-room.js (pure derive functions) and
// command-palette.js (filter/recent/palette), both previously 0% in the
// unified baseline: loaded via <script> and asserted on as source text only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("control room derivation", () => {
  beforeEach(() => {
    delete window.NUSAControlRoom;
    window.eval(read("apps/desktop/renderer/control-room.js"));
  });

  it("exposes a frozen health vocabulary", () => {
    const room = window.NUSAControlRoom;
    expect(room.HEALTH).toContain("HEALTHY");
    expect(room.HEALTH).toContain("EMERGENCY_STOP");
    expect(room.HEALTH_LABEL.HEALTHY).toBe("정상");
    expect(room.STAGES.map((stage) => stage.key)).toContain("riskGateway");
  });

  it("derives health from market status without diagnostics", () => {
    const room = window.NUSAControlRoom;
    expect(room.deriveHealth(null, "HEALTHY")).toBe("HEALTHY");
    expect(room.deriveHealth(null, "STALE")).toBe("WARNING");
    expect(room.deriveHealth(null, "DISCONNECTED")).toBe("OFF");
    expect(room.deriveHealth(null, null)).toBe("OFF");
  });

  it("marks every stage NOT_CALLED without diagnostics", () => {
    const room = window.NUSAControlRoom;
    const stages = room.derivePipeline(null);
    expect(stages.length).toBe(room.STAGES.length);
    for (const stage of stages) expect(stage.status).toBe("NOT_CALLED");
  });

  it("labels known blockers and passes unknown codes through", () => {
    const room = window.NUSAControlRoom;
    expect(room.describeBlocker("KILL_SWITCH_ACTIVE")).toContain("Kill Switch");
    expect(room.describeBlocker("MARKET_DATA_DISCONNECTED")).toContain("연결");
    expect(room.describeBlocker("SOMETHING_NEW:detail")).toContain("SOMETHING_NEW");
  });
});

describe("command palette execution", () => {
  function api() {
    delete window.NUSACommandPalette;
    window.eval(read("apps/desktop/renderer/command-palette.js"));
    return window.NUSACommandPalette;
  }

  function mount(commands) {
    if (typeof window.Element.prototype.scrollIntoView !== "function") {
      window.Element.prototype.scrollIntoView = function () {};
    }
    document.body.innerHTML =
      '<div id="command-palette" hidden>' +
      '<input id="command-palette-search" />' +
      '<div id="command-palette-list"></div>' +
      '<div id="command-palette-empty" hidden></div>' +
      '<div id="command-palette-status"></div>' +
      '<button id="command-palette-trigger">open</button>' +
      '<button id="command-palette-close">close</button>' +
      '<button data-command-palette-close>alt-close</button>' +
      "</div>";
    return api().createCommandPalette({
      document,
      storage: window.localStorage,
      commands: () => commands,
    });
  }

  const commands = [
    { id: "buy", title: "Paper buy", keywords: ["market"], hint: "B", enabled: true, run: () => {} },
    { id: "stale", title: "Old command", enabled: false, run: () => {} },
  ];

  it("filters by title and keywords, skipping disabled commands", () => {
    const palette = api();
    expect(palette.filterCommands(commands, "").map((command) => command.id)).toEqual(["buy"]);
    expect(palette.filterCommands(commands, "market").map((command) => command.id)).toEqual(["buy"]);
    expect(palette.filterCommands(commands, "zzz")).toEqual([]);
  });

  it("persists recent commands bounded and corruption-proof", () => {
    const palette = api();
    window.localStorage.clear();
    expect(palette.readRecent(window.localStorage)).toEqual([]);
    palette.writeRecent(window.localStorage, "buy");
    palette.writeRecent(window.localStorage, "buy");
    expect(palette.readRecent(window.localStorage)).toEqual(["buy"]);
    window.localStorage.setItem(palette.RECENT_KEY, "corrupt{");
    expect(palette.readRecent(window.localStorage)).toEqual([]);
  });

  it("opens, filters, executes, and closes on Escape", () => {
    let ran = false;
    const palette = mount([{ ...commands[0], run: () => { ran = true; } }]);
    palette.open();
    expect(document.getElementById("command-palette").hidden).toBe(false);
    const search = document.getElementById("command-palette-search");
    search.value = "zzz";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(document.getElementById("command-palette-status").textContent).toBe("검색 결과 없음");
    search.value = "";
    search.dispatchEvent(new window.Event("input", { bubbles: true }));
    document.querySelector(".command-palette__option").click();
    expect(ran).toBe(true);
    expect(palette.recent()).toEqual(["buy"]);
    palette.open();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("command-palette").hidden).toBe(true);
  });
});
