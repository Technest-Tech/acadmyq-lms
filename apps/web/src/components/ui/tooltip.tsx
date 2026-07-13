"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

/**
 * A hover/focus label. The collapsed sidebar rail leans on this — with the labels hidden, the
 * tooltip is the only thing naming an icon, so it is an accessibility requirement there, not a
 * decoration.
 */
function Tooltip({
  children,
  content,
  side = "right",
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  if (content === null || content === undefined || content === "") {
    return <>{children}</>;
  }

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children as React.ReactElement} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={8}>
          <TooltipPrimitive.Popup
            className={cn(
              "bg-foreground text-background z-50 rounded-md px-2 py-1 text-xs font-medium shadow-md",
              "origin-[var(--transform-origin)] transition-[transform,opacity] duration-150",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/**
 * Wrap the app once. The open delay lives here, not on each tooltip: Base UI groups them, so once
 * one has opened, moving along a row of rail icons reveals the next instantly instead of re-waiting.
 */
function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delay={250}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export { Tooltip, TooltipProvider };
