"use client";

import {
  ArrowUpRight,
  Circle,
  Eraser,
  Minus,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AnnotateTool } from "./screen-annotate-authoring";

export const ANNOTATE_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#f8fafc", "#111827"];
export const ANNOTATE_WIDTHS = [3, 6, 12];

const TOOLS: { tool: AnnotateTool; Icon: LucideIcon; label: string }[] = [
  { tool: "pen", Icon: Pencil, label: "Pen" },
  { tool: "line", Icon: Minus, label: "Line" },
  { tool: "arrow", Icon: ArrowUpRight, label: "Arrow" },
  { tool: "rectangle", Icon: Square, label: "Rectangle" },
  { tool: "ellipse", Icon: Circle, label: "Ellipse" },
  { tool: "eraser", Icon: Eraser, label: "Eraser" },
];

/**
 * The floating drawing toolbar shown over the shared screen to any web viewer who can draw — the same
 * tool/colour/width controls the desktop teacher has natively. It stops pointer events from reaching
 * the draw surface beneath it, so tapping a tool never starts a stroke. Compact + responsive so it fits
 * over the video on phones too.
 */
export function ScreenAnnotateToolbar({
  tool,
  color,
  width,
  onTool,
  onColor,
  onWidth,
  onUndo,
  onRedo,
  onClear,
}: {
  tool: AnnotateTool;
  color: string;
  width: number;
  onTool: (t: AnnotateTool) => void;
  onColor: (c: string) => void;
  onWidth: (w: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}) {
  return (
    <div
      // Swallow pointer/clicks so interacting with the toolbar never draws on the surface below.
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute start-2 top-1/2 z-20 flex max-h-[calc(100%-1rem)] -translate-y-1/2 flex-col items-center gap-1 overflow-y-auto rounded-2xl bg-slate-900/85 p-1.5 ring-1 ring-white/10 backdrop-blur"
    >
      {TOOLS.map(({ tool: tk, Icon, label }) => (
        <ToolBtn key={tk} active={tool === tk} label={label} onClick={() => onTool(tk)}>
          <Icon className="size-[18px]" />
        </ToolBtn>
      ))}

      <div className="my-0.5 h-px w-6 bg-white/15" />

      <div className="grid grid-cols-2 gap-1 py-0.5">
        {ANNOTATE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            title={c}
            onClick={() => onColor(c)}
            style={{ background: c }}
            className={`size-4 rounded-full ring-1 ring-white/40 transition hover:scale-110 ${
              color === c ? "outline outline-2 outline-emerald-400 outline-offset-1" : ""
            }`}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5 py-1">
        {ANNOTATE_WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            aria-label={`Width ${w}`}
            title={`Width ${w}`}
            onClick={() => onWidth(w)}
            className={`flex size-5 items-center justify-center rounded-full transition hover:bg-white/10 ${
              width === w ? "bg-white/10 outline outline-2 outline-emerald-400" : ""
            }`}
          >
            <span className="rounded-full bg-white" style={{ width: 3 + w / 2, height: 3 + w / 2 }} />
          </button>
        ))}
      </div>

      <div className="my-0.5 h-px w-6 bg-white/15" />

      <ToolBtn label="Undo" onClick={onUndo}>
        <Undo2 className="size-[18px]" />
      </ToolBtn>
      <ToolBtn label="Redo" onClick={onRedo}>
        <Redo2 className="size-[18px]" />
      </ToolBtn>
      <ToolBtn label="Clear" onClick={onClear} danger>
        <Trash2 className="size-[18px]" />
      </ToolBtn>
    </div>
  );
}

function ToolBtn({
  active = false,
  danger = false,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex size-9 items-center justify-center rounded-xl transition ${
        active
          ? "bg-emerald-500 text-emerald-950"
          : danger
            ? "text-white/80 hover:bg-red-500/20 hover:text-red-300"
            : "text-white/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
