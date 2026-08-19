"use client";

import { Dialog } from "@base-ui/react/dialog";
import { CornerDownLeft, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { cn } from "@/lib/utils";

export interface CommandItem {
  key: string;
  /** Already-translated label — the palette matches on what the user can actually read. */
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  group: string;
}

/**
 * ⌘K / Ctrl-K destination search. With two dozen nav entries across four groups, the fastest path
 * to a page shouldn't be "scan the sidebar" — it should be "type three letters". Only items the
 * caller passes in are searchable, so the palette inherits the sidebar's permission and entitlement
 * gating for free — a feature switched off for this client is not in the list at all.
 */
export function CommandPalette({ items }: { items: CommandItem[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Every open starts from a clean slate — a stale query from last time is never what you want.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return items;
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, query]);

  // The highlight must never point past the end of a freshly-filtered list.
  useEffect(() => {
    setActive((i) => (i >= results.length ? 0 : i));
  }, [results.length]);

  const go = (item: CommandItem | undefined) => {
    if (item === undefined) return;
    setOpen(false);
    router.push(item.href);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  };

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <>
      {/* The trigger doubles as the affordance that teaches the shortcut — a bare ⌘K with no visible
          entry point is a feature only the people who built it know about. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="command-trigger"
        className="text-muted-foreground hover:bg-muted hover:border-border focus-visible:ring-ring/50 border-border/70 bg-muted/40 flex h-8 items-center gap-2 rounded-lg border px-2.5 transition-colors outline-none focus-visible:ring-2 md:w-64"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="hidden flex-1 text-start text-[13px] md:block">
          {t("command.placeholder")}
        </span>
        <kbd className="border-border bg-background text-muted-foreground/70 hidden rounded border px-1.5 py-0.5 font-sans text-[10px] font-medium md:block">
          ⌘K
        </kbd>
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup
            data-testid="command-palette"
            className={cn(
              "bg-popover border-border fixed start-1/2 top-[15vh] z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 rtl:translate-x-1/2 overflow-hidden rounded-xl border shadow-2xl shadow-black/20",
              "transition-[transform,opacity] duration-150",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            )}
          >
            <Dialog.Title className="sr-only">
              {t("command.placeholder")}
            </Dialog.Title>

            <div className="border-border flex items-center gap-2.5 border-b px-4">
              <Search
                className="text-muted-foreground/60 size-4 shrink-0"
                aria-hidden
              />
              {/* Focus on open is the whole point of a command palette — you press ⌘K to type. */}
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={t("command.placeholder")}
                aria-label={t("command.placeholder")}
                className="text-foreground placeholder:text-muted-foreground/60 h-12 flex-1 bg-transparent text-sm outline-none"
              />
            </div>

            <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {t("command.empty")}
                </p>
              ) : (
                results.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-active={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(item)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                        i === active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <Icon
                        className="size-4 shrink-0 opacity-70"
                        aria-hidden
                      />
                      <span className="flex-1 text-start font-medium">
                        {item.label}
                      </span>
                      <span className="text-muted-foreground/50 text-[11px]">
                        {item.group}
                      </span>
                      {i === active && (
                        <CornerDownLeft
                          className="text-muted-foreground/50 size-3.5"
                          aria-hidden
                        />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
