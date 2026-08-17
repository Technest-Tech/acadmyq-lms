import { cn } from "@/lib/utils";

/**
 * Shared initials avatar for admin user surfaces (superadmin-reorg). One flat style — the
 * per-user gradient palette (and its byte-identical copy in the user detail modal) is gone
 * with the rest of the gradient era.
 */
export function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

export function UserAvatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-primary/10 text-primary flex shrink-0 items-center justify-center rounded-full font-bold",
        size === "md" ? "size-9 text-xs" : "size-12 text-sm",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
