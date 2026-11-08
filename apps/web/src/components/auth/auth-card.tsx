import { cn } from "@/lib/utils";

/**
 * The white card every sign-in door puts its form on: the sign-in itself, forgot-password and
 * reset-password. It sits on the navy ground of `AuthFrame`, so it restates `text-foreground`:
 * the ground sets a near-white text colour, and without the reset every label in the card would
 * inherit it and vanish into the white.
 *
 * A plain module (no server imports) so client screens can use it.
 */
export function AuthCard({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn("mk-card text-foreground rounded-3xl p-7 sm:p-9", className)}
    >
      {children}
    </div>
  );
}

/** The input look shared by the three door screens: 48px tall, wide radius, navy focus ring. */
export const authInputClass =
  "border-input bg-background placeholder:text-muted-foreground/60 focus:border-primary focus:ring-primary/15 h-12 w-full rounded-xl border text-base shadow-xs outline-none transition-colors focus:ring-3 sm:text-sm";
