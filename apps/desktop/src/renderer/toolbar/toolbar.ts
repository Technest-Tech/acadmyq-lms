// The floating annotation toolbar renderer. Owns the visual tool/color/width selection and pushes
// every change to main via the preload bridge (academiqToolbar). It never paints annotations — that's
// the overlay's job; this just chooses what the overlay authors with. Lives in its own
// content-protected window so students never see it.
import type { ToolbarAction, ToolbarTool } from "../../preload/toolbar-preload";

declare global {
  interface Window {
    academiqToolbar?: {
      setTool(tool: ToolbarTool): void;
      action(action: ToolbarAction): void;
    };
  }
}

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#f8fafc", "#111827"];
const WIDTHS = [3, 6, 12];

const state: ToolbarTool = { tool: "pen", color: COLORS[0]!, width: WIDTHS[1]! };

function pushTool(): void {
  window.academiqToolbar?.setTool({ ...state });
}

// --- Tools ---
const toolButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button.tool"));
function selectTool(tool: ToolbarTool["tool"]): void {
  state.tool = tool;
  for (const b of toolButtons) b.classList.toggle("active", b.dataset["tool"] === tool);
  pushTool();
}
for (const b of toolButtons) {
  b.addEventListener("click", () => selectTool(b.dataset["tool"] as ToolbarTool["tool"]));
}

// --- Colour swatches ---
const swatches = document.getElementById("swatches")!;
const swatchEls: HTMLElement[] = COLORS.map((color) => {
  const el = document.createElement("div");
  el.className = "swatch";
  el.style.background = color;
  el.title = color;
  el.addEventListener("click", () => {
    state.color = color;
    for (const s of swatchEls) s.classList.toggle("active", s === el);
    pushTool();
  });
  swatches.appendChild(el);
  return el;
});

// --- Stroke widths ---
const widths = document.getElementById("widths")!;
const widthEls: HTMLElement[] = WIDTHS.map((w) => {
  const el = document.createElement("div");
  el.className = "wdot";
  const px = 5 + w; // visual size cue
  el.style.width = `${px}px`;
  el.style.height = `${px}px`;
  el.title = `Width ${w}`;
  el.addEventListener("click", () => {
    state.width = w;
    for (const d of widthEls) d.classList.toggle("active", d === el);
    pushTool();
  });
  widths.appendChild(el);
  return el;
});

// --- Actions ---
const action = (id: string, name: ToolbarAction) =>
  document.getElementById(id)?.addEventListener("click", () => window.academiqToolbar?.action(name));
action("undo", "undo");
action("redo", "redo");
action("clear", "clear");
action("close", "close");

// Initial selection reflects the default state (pen / first colour / medium width).
selectTool(state.tool);
swatchEls[0]!.classList.add("active");
widthEls[1]!.classList.add("active");
