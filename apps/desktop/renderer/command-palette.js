(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DokkaebiCommandPalette = api;
})(globalThis, function () {
  const key = "dokkaebi.command-palette.recent";
  const limit = 5;
  const normal = (value) => String(value || "").trim().toLowerCase();
  const filter = (commands, query) => {
    const search = normal(query);
    return commands.filter((command) => command.enabled !== false && (!search || normal([command.title, ...command.keywords].join(" ")).includes(search)));
  };
  const read = (storage) => {
    try {
      const stored = JSON.parse(storage.getItem(key) || "[]");
      return Array.isArray(stored) ? stored.filter((id) => typeof id === "string").slice(0, limit) : [];
    } catch { return []; }
  };
  const write = (storage, id) => {
    try { storage.setItem(key, JSON.stringify([id, ...read(storage).filter((value) => value !== id)].slice(0, limit))); }
    catch { /* Recent commands are non-critical convenience state. */ }
  };
  const textNode = (tag, value, className) => {
    const node = document.createElement(tag);
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
    let previous;
    let selected = 0;
    let visible = [];

    const render = () => {
      visible = filter(commands(), search.value);
      selected = Math.min(selected, Math.max(0, visible.length - 1));
      list.replaceChildren(...visible.map((command, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "command-palette__option";
        button.id = `command-palette-option-${command.id}`;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(index === selected));
        button.append(textNode("span", command.title), textNode("span", command.hint || "", "command-palette__meta"));
        button.addEventListener("click", () => execute(index));
        return button;
      }));
      empty.hidden = visible.length > 0;
      status.textContent = visible.length ? `${visible.length}개 명령` : "검색 결과 없음";
      search.setAttribute("aria-activedescendant", visible[selected] ? `command-palette-option-${visible[selected].id}` : "");
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    };
    const close = () => {
      if (root.hidden) return;
      root.hidden = true;
      document.body.classList.remove("command-palette-open");
      previous?.focus?.();
    };
    const execute = (index) => {
      const command = visible[index];
      if (!command) return;
      command.run();
      write(storage, command.id);
      status.textContent = `${command.title} 실행됨`;
      close();
    };
    const open = () => {
      if (!root.hidden) return;
      previous = document.activeElement;
      root.hidden = false;
      document.body.classList.add("command-palette-open");
      search.value = "";
      selected = 0;
      render();
      search.focus();
    };

    document.getElementById("command-palette-trigger").addEventListener("click", open);
    document.getElementById("command-palette-close").addEventListener("click", close);
    root.querySelector("[data-command-palette-close]").addEventListener("click", close);
    search.addEventListener("input", () => { selected = 0; render(); });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && normal(event.key) === "k") {
        event.preventDefault();
        root.hidden ? open() : close();
        return;
      }
      if (root.hidden) return;
      if (event.key==="Escape") { event.preventDefault(); close(); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!visible.length) return;
        selected = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : (selected + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
        render();
        return;
      }
      if (event.key === "Enter" && document.activeElement === search) { event.preventDefault(); execute(selected); return; }
      if (event.key==="Tab") {
        const focusable = Array.from(root.querySelectorAll("button:not(:disabled),input:not(:disabled)"));
        const index = focusable.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1).focus(); }
        else if (!event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[0].focus(); }
      }
    });
    return { open, close, recent: () => read(storage) };
  }

  return { key, filter, read, write, create };
});
