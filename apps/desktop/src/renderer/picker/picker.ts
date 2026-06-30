export {}; // module scope so `declare global` is legal

interface PickerItem {
  id: string;
  name: string;
  thumbnail: string;
  kind: "screen" | "window";
}
interface PickerPayload {
  items: PickerItem[];
  screensOnly: boolean;
}

declare global {
  interface Window {
    academiqPicker?: {
      onPayload(cb: (p: PickerPayload) => void): () => void;
      choose(id: string): void;
      cancel(): void;
    };
  }
}

const scroll = document.getElementById("scroll") as HTMLDivElement;
const badge = document.getElementById("badge") as HTMLDivElement;
const sub = document.getElementById("sub") as HTMLDivElement;
const cancelBtn = document.getElementById("cancel") as HTMLButtonElement;

cancelBtn.addEventListener("click", () => window.academiqPicker?.cancel());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.academiqPicker?.cancel();
});

window.academiqPicker?.onPayload(render);

function render(payload: PickerPayload): void {
  badge.hidden = !payload.screensOnly;
  const screens = payload.items.filter((i) => i.kind === "screen");
  const windows = payload.items.filter((i) => i.kind === "window");
  sub.textContent = payload.screensOnly
    ? "Annotations are baked into a shared screen, so only whole screens can be shared."
    : `${screens.length} screen${screens.length === 1 ? "" : "s"}` +
      (windows.length ? ` · ${windows.length} window${windows.length === 1 ? "" : "s"}` : "");

  scroll.replaceChildren();
  if (!payload.items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No shareable sources found.";
    scroll.append(empty);
    return;
  }
  if (screens.length) scroll.append(groupTitle("Screens"), grid(screens));
  if (windows.length) scroll.append(groupTitle("Windows"), grid(windows));
}

function groupTitle(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "group-title";
  el.textContent = text;
  return el;
}

function grid(items: PickerItem[]): HTMLDivElement {
  const g = document.createElement("div");
  g.className = "grid";
  for (const item of items) {
    const tile = document.createElement("button");
    tile.className = "tile";
    tile.title = item.name;
    tile.addEventListener("click", () => window.academiqPicker?.choose(item.id));

    const img = document.createElement("img");
    img.className = "thumb";
    img.src = item.thumbnail;
    img.alt = "";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = (item.kind === "screen" ? "🖥️ " : "🪟 ") + item.name;

    tile.append(img, name);
    g.append(tile);
  }
  return g;
}
