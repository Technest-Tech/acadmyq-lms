import { Plus } from "lucide-react";
import type { QA } from "@/content/marketing";

/**
 * The FAQ list, built on `<details>`/`<summary>`.
 *
 * No JavaScript and no ARIA of our own: the browser already gives this element keyboard operation,
 * an announced expanded/collapsed state, and — importantly for a page people arrive at from search
 * — findable text via in-page find, which a div-based accordion silently breaks.
 *
 * The answers are plain strings rendered as text. Nothing on this site ever passes marketing copy
 * through `dangerouslySetInnerHTML`.
 */
export function Faq({ items }: { items: QA[] }) {
  return (
    <div className="divide-border border-border divide-y border-t">
      {items.map((item) => (
        <details key={item.q} className="group">
          <summary className="hover:text-primary focus-visible:outline-ring flex cursor-pointer list-none items-start justify-between gap-4 py-5 text-start text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
            <span>{item.q}</span>
            <Plus
              aria-hidden
              className="text-muted-foreground mt-0.5 size-5 shrink-0 transition-transform group-open:rotate-45"
            />
          </summary>
          <p className="text-muted-foreground pb-5 leading-relaxed">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
