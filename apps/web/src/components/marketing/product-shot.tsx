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
  onInk = false,
}: {
  shot: Shot;
  priority?: boolean;
  className?: string;
  sizes?: string;
  /** Sitting on the navy hero: a deeper shadow, and the caption in light ink. */
  onInk?: boolean;
}) {
  return (
    <figure className={cn("group", className)}>
      <div
        className={cn(
          "overflow-hidden rounded-2xl bg-white",
          onInk ? "mk-window" : "mk-card",
        )}
      >
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
      <figcaption
        className={cn(
          "mt-3 text-sm leading-relaxed",
          onInk ? "text-ink-foreground/65" : "text-muted-foreground",
        )}
      >
        {shot.caption}
      </figcaption>
    </figure>
  );
}
