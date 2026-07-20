/* global module */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DokkaebiCommandPalette = api;
}(globalThis, function () {
  const RECENT_KEY = "dokkaebi.commandPalette.recent.v1";
  const MAX_RECENT = 5;

  function normalize(value) { return String(value || "").trim().toLocaleLowerCase(); }
  function filterCommands(commands, query) {
    const needle = normalize(query);
    return commands.filter((command) => command.enabled !== false && (!needle || normalize([command.title, ...(command.keywords || [])].join(" ")).includes(needle)));
  }
  function readRecent(storage) {
    try { const value = JSON.parse(storage.getItem(RECENT_KEY) || "[]"); return Array.isArray(value) ? value.filter((id) => typeof id === "string").slice(0, MAX_RECENT) : []; }
    catch { return []; }
  }
  function writeRecent(storage, id) {
    try { storage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent(storage).filter((item) => item !== id)].slice(0, MAX_RECENT))); }
    catch { /* Storage failures must not block paper controls. */ }
  }
  function createCommandPalette(options) {
    const document = options.document;
    const storage = options.storage;
    const root = document.getElementById("command-palette");
    const search = document.getElementById("command-palette-search");
    const list = document.getElementById("command-palette-list");
    const empty = document.getElementById("command-palette-empty");
    const status = document.getElementById("command-palette-status");
    const trigger = document.getElementById("command-palette-trigger");
    const close = document.getElementById("command-palette-close");
    let previousFocus = null;
    let selected = 0;
    let visible = [];
    const focusables = () => Array.from(root.querySelectorAll("button:not(:disabled), input:not(:disabled)"));
    const commands = () => options.commands();
    function update() {
      visible = filterCommands(commands(), search.value);
      selected = Math.min(selected, Math.max(visible.length - 1, 0));
      list.replaceChildren();
      visible.forEach((command, index) => {
        const option = document.createElement("button");
        option.type = "button"; option.className = "command-palette__option"; option.id = `command-palette-option-${command.id}`;
        option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(index === selected));
        const title = document.createElement("span");
        title.className = "command-palette__option-title";
        title.textContent = command.title;
        const meta = document.createElement("span");
        meta.className = "command-palette__option-meta";
        meta.textContent = command.hint || "";
        option.append(title, meta);
        option.addEventListener("click", () => execute(index)); list.appendChild(option);
      });
      empty.hidden = visible.length !== 0;
      status.textContent = visible.length ? `${visible.length}개 명령` : "검색 결과 없음";
      search.setAttribute("aria-activedescendant", visible[selected] ? `command-palette-option-${visible[selected].id}` : "");
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }
    function execute(index) {
      const command = visible[index]; if (!command) return;
      command.run(); writeRecent(storage, command.id); status.textContent = `${command.title} 실행됨`; closePalette();
    }
    function openPalette() { if (!root.hidden) return; previousFocus = document.activeElement; root.hidden = false; document.body.classList.add("command-palette-open"); search.value = ""; selected = 0; update(); search.focus(); }
    function closePalette() { if (root.hidden) return; root.hidden = true; document.body.classList.remove("command-palette-open"); previousFocus?.focus?.(); }
    function keydown(event) {
      const shortcut = (event.ctrlKey || event.metaKey) && normalize(event.key) === "k";
      if (shortcut) { event.preventDefault(); root.hidden ? openPalette() : closePalette(); return; }
      if (root.hidden) return;
      if (event.key === "Escape") { event.preventDefault(); closePalette(); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        event.preventDefault(); if (!visible.length) return;
        selected = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : (selected + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length; update(); return;
      }
      if (event.key === "Enter" && document.activeElement === search) { event.preventDefault(); execute(selected); return; }
      if (event.key === "Tab") { const items = focusables(); if (!items.length) return; const index = items.indexOf(document.activeElement); if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1).focus(); } else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0].focus(); } }
    }
    trigger.addEventListener("click", openPalette); close.addEventListener("click", closePalette);
    root.querySelector("[data-command-palette-close]").addEventListener("click", closePalette); search.addEventListener("input", () => { selected = 0; update(); });
    document.addEventListener("keydown", keydown);
    return { open: openPalette, close: closePalette, update, recent: () => readRecent(storage) };
  }
  return { RECENT_KEY, filterCommands, readRecent, writeRecent, createCommandPalette };
}));
