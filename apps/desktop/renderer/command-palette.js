(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DokkaebiCommandPalette = api;
})(globalThis, function () {
  const key = "dokkaebi.command-palette.recent";
  const limit = 5;
  const unavailableLabel = "Unavailable";

  const normal = (value) => String(value || "").trim().toLowerCase();
  const isEnabled = (command) => command != null && command.enabled !== false;
  const keywords = (command) => Array.isArray(command.keywords) ? command.keywords : [];

  const filter = (commands, query) => {
    const search = normal(query);
    return commands.filter((command) => !search || normal([command.title, ...keywords(command)].join(" ")).includes(search));
  };

  const nextEnabledIndex = (commands, current, action) => {
    const enabled = commands.map((command, index) => isEnabled(command) ? index : -1).filter((index) => index >= 0);
    if (!enabled.length) return -1;
    if (action === "FIRST") return enabled[0];
    if (action === "LAST") return enabled.at(-1);
    const currentPosition = enabled.indexOf(current);
    if (currentPosition < 0) return action === "PREVIOUS" ? enabled.at(-1) : enabled[0];
    const base = currentPosition;
    return enabled[(base + (action === "NEXT" ? 1 : -1) + enabled.length) % enabled.length];
  };

  const read = (storage) => {
    try {
      const stored = JSON.parse(storage.getItem(key) || "[]");
      return Array.isArray(stored) ? stored.filter((id) => typeof id === "string").slice(0, limit) : [];
    } catch { return []; }
  };

  const write = (storage, id) => {
    try {
      const recent = [id, ...read(storage).filter((value) => value !== id)].slice(0, limit);
      storage.setItem(key, JSON.stringify(recent));
    } catch {
      // Recent command history is convenience-only. Storage failures must not affect controls.
    }
  };

  const textNode = (ownerDocument, tag, value, className) => {
    const node = ownerDocument.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  };

  function create({ document, storage, commands }) {
    const root = document.getElementById("command-palette");
    const search = document.getElementById("command-palette-search");
    const list = document.getElementById("command-palette-list");
    const empty = document.getElementById("command-palette-empty");
    const status = document.getElementById("command-palette-status");
    const trigger = document.getElementById("command-palette-trigger");
    const closeButton = document.getElementById("command-palette-close");
    const backdrop = root.querySelector("[data-command-palette-close]");
    let previousFocus;
    let selected = -1;
    let visible = [];

    const enabledOptions = () => Array.from(list.querySelectorAll("button:not(:disabled)"));
    const focusSearch = () => search.focus();

    const render = () => {
      visible = filter(commands(), search.value);
      if (!isEnabled(visible[selected])) selected = nextEnabledIndex(visible, selected, "FIRST");
      const options = visible.map((command, index) => {
        const disabled = !isEnabled(command);
        const option = document.createElement("button");
        option.type = "button";
        option.className = disabled ? "command-palette__option command-palette__option--disabled" : "command-palette__option";
        option.id = `command-palette-option-${command.id}`;
        option.disabled = disabled;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === selected));
        option.setAttribute("aria-disabled", String(disabled));
        const reason = disabled ? (command.disabledReason || unavailableLabel) : (command.hint || "");
        option.append(textNode(document, "span", command.title), textNode(document, "span", reason, "command-palette__meta"));
        if (!disabled) option.addEventListener("click", () => execute(index));
        return option;
      });
      list.replaceChildren(...options);
      empty.hidden = visible.length > 0;
      status.textContent = visible.length ? `${visible.length} commands` : "No matching commands";
      search.setAttribute("aria-activedescendant", selected >= 0 ? `command-palette-option-${visible[selected].id}` : "");
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    };

    const close = () => {
      if (root.hidden) return;
      root.hidden = true;
      document.body.classList.remove("command-palette-open");
      previousFocus?.focus?.();
    };

    const execute = (index) => {
      const command = visible[index];
      if (!command || !isEnabled(command)) return;
      command.run();
      write(storage, command.id);
      status.textContent = `${command.title} executed`;
      close();
    };

    const open = () => {
      if (!root.hidden) return;
      previousFocus = document.activeElement;
      root.hidden = false;
      document.body.classList.add("command-palette-open");
      search.value = "";
      selected = -1;
      render();
      focusSearch();
    };

    const moveSelection = (action) => {
      selected = nextEnabledIndex(visible, selected, action);
      render();
    };

    const trapFocus = (event) => {
      const options = enabledOptions();
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === closeButton) { event.preventDefault(); (options.at(-1) || search).focus(); }
        else if (active === search) { event.preventDefault(); closeButton.focus(); }
        else if (active === options[0]) { event.preventDefault(); focusSearch(); }
        return;
      }
      if (active === closeButton) { event.preventDefault(); focusSearch(); }
      else if (active === search) { event.preventDefault(); (options[0] || closeButton).focus(); }
      else if (active === options.at(-1)) { event.preventDefault(); focusSearch(); }
    };

    trigger.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    backdrop.addEventListener("click", close);
    search.addEventListener("input", () => { selected = -1; render(); });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && normal(event.key) === "k") {
        event.preventDefault();
        root.hidden ? open() : close();
        return;
      }
      if (root.hidden) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); moveSelection("NEXT"); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); moveSelection("PREVIOUS"); return; }
      if (event.key === "Home") { event.preventDefault(); moveSelection("FIRST"); return; }
      if (event.key === "End") { event.preventDefault(); moveSelection("LAST"); return; }
      if (event.key === "Enter" && document.activeElement === search) { event.preventDefault(); execute(selected); return; }
      if (event.key === "Tab") trapFocus(event);
    });

    return Object.freeze({ open, close, recent: () => read(storage) });
  }

  return Object.freeze({ key, filter, nextEnabledIndex, read, write, create });
});
