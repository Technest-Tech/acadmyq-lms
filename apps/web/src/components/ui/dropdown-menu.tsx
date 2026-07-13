"use client";

import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

/**
 * A dropdown menu (Base UI Menu). Keyboard, focus trapping, typeahead and RTL-aware placement all
 * come from the primitive; this only supplies the skin.
 */
function DropdownMenu({ children }: { children: React.ReactNode }) {
  return <Menu.Root>{children}</Menu.Root>;
}

function DropdownMenuTrigger({
  children,
  className,
}: {
  children: React.ReactElement;
  className?: string;
}) {
  return <Menu.Trigger className={className} render={children} />;
}

function DropdownMenuContent({
  children,
  align = "end",
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner side="bottom" align={align} sideOffset={8}>
        <Menu.Popup
          className={cn(
            "bg-popover text-popover-foreground border-border z-50 min-w-52 rounded-xl border p-1 shadow-lg shadow-black/[0.06] dark:shadow-black/30",
            "origin-[var(--transform-origin)] transition-[transform,opacity] duration-150",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className,
          )}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function DropdownMenuItem({
  children,
  onClick,
  destructive = false,
  className,
  ...props
}: {
  children: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  className?: string;
} & Omit<Menu.Item.Props, "onClick" | "className" | "children">) {
  return (
    <Menu.Item
      onClick={onClick}
      className={cn(
        "flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors",
        "data-[highlighted]:bg-muted",
        destructive
          ? "text-destructive data-[highlighted]:bg-destructive/10"
          : "text-foreground",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </Menu.Item>
  );
}

/** A non-interactive header — the signed-in identity at the top of the user menu. */
function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 py-2">{children}</div>;
}

function DropdownMenuSeparator() {
  return <div className="bg-border -mx-1 my-1 h-px" role="separator" />;
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
