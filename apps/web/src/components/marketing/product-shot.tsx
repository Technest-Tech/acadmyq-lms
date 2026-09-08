import Image from "next/image";
import type { Shot } from "@/content/marketing";
import { cn } from "@/lib/utils";

/**
 * One real screenshot of the product, framed.
 *
 * The frame is a thin border and a soft shadow — not a drawn browser window with a fake URL bar.
 * A fake chrome tells the reader nothing true and makes a real capture look like a mock-up, which
 * is the opposite of what a screenshot is here to do.
 *
 * `width`/`height` come from the shot registry and are always the capture's real pixel size, so the
 * box is reserved before the file arrives and nothing on the page moves when it does. Only the
 * first shot on a page should pass `priority`; the rest load lazily.
 */
export function ProductShot({
  shot,
  priority = false,
  className,
  sizes = "(min-width: 1024px) 960px, 100vw",
}: {
  shot: Shot;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  return (
    <figure className={cn("group", className)}>
      <div className="border-border bg-card overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-12px_rgba(16,24,40,0.18)]">
        <Image
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          sizes={sizes}
          priority={priority}
          className="h-auto w-full"
        />
      </div>
      <figcaption className="text-muted-foreground mt-3 text-sm leading-relaxed">
        {shot.caption}
      </figcaption>
    </figure>
  );
}
