const MENU_ID = "image-context-menu";
let returnFocus = null;

function menuElement() {
  let menu = document.getElementById(MENU_ID);
  if (!menu) {
    menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.className = "image-context-menu";
    menu.setAttribute("role", "menu");
    menu.tabIndex = -1;
    menu.hidden = true;
    document.body.append(menu);
  }
  return menu;
}

export function closeContextMenu({ restore = false } = {}) {
  const menu = document.getElementById(MENU_ID);
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  menu.replaceChildren();
  if (restore && returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
}

export function openContextMenu({ x, y, anchor = null, items = [], focus = document.activeElement } = {}) {
  const menu = menuElement();
  closeContextMenu();
  returnFocus = focus instanceof HTMLElement ? focus : null;
  menu.replaceChildren();
  for (const item of items) {
    if (item.type === "separator") {
      const separator = document.createElement("div");
      separator.className = "image-context-menu-separator";
      separator.setAttribute("role", "separator");
      menu.append(separator);
      continue;
    }
    if (item.type === "heading") {
      const heading = document.createElement("div");
      heading.className = "image-context-menu-heading";
      heading.setAttribute("role", "presentation");
      heading.textContent = item.label;
      menu.append(heading);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "image-context-menu-item";
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    if (item.title) button.title = item.title;
    button.addEventListener("click", () => {
      closeContextMenu();
      if (!item.disabled) item.action?.();
    });
    menu.append(button);
  }
  const rect = anchor?.getBoundingClientRect?.();
  const pointX = Number.isFinite(x) && x > 0 ? x : rect ? rect.left + Math.min(rect.width / 2, 160) : 12;
  const pointY = Number.isFinite(y) && y > 0 ? y : rect ? rect.top + Math.min(rect.height / 2, 80) : 12;
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(pointX, innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(pointY, innerHeight - bounds.height - 8))}px`;
  menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  return menu;
}

document.addEventListener("click", (event) => {
  const menu = document.getElementById(MENU_ID);
  if (menu && !menu.hidden && !menu.contains(event.target)) closeContextMenu();
}, true);

document.addEventListener("keydown", (event) => {
  const menu = document.getElementById(MENU_ID);
  if (!menu || menu.hidden) return;
  const items = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
  const active = items.indexOf(document.activeElement);
  if (event.key === "Escape") {
    event.preventDefault();
    closeContextMenu({ restore: true });
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
    event.preventDefault();
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  } else if (event.key === "Tab") {
    closeContextMenu({ restore: true });
  }
});

window.addEventListener("resize", () => closeContextMenu());
