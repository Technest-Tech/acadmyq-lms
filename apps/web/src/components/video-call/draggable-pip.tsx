"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * A draggable picture-in-picture container for the self-view in the spotlight (1:1) layout.
 * Defaults to the bottom-end corner; pointer-drag repositions it within the stage. Works with
 * mouse + touch via Pointer Events, and respects the mobile safe-area at its default position.
 */
export function DraggablePip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  // null = use the CSS default corner; once dragged we switch to absolute coords.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const rect = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!drag.current || !el || !parent) return;
    const prect = parent.getBoundingClientRect();
    const x = e.clientX - prect.left - drag.current.dx;
    const y = e.clientY - prect.top - drag.current.dy;
    const maxX = prect.width - el.offsetWidth;
    const maxY = prect.height - el.offsetHeight;
    setPos({
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    });
  }

  function onPointerUp(e: React.PointerEvent) {
    drag.current = null;
    ref.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined}
      className="absolute bottom-4 end-4 z-20 w-28 cursor-grab touch-none active:cursor-grabbing sm:w-40"
    >
      {children}
    </div>
  );
}
