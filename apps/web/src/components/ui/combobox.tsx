"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  pre?: ReactNode;
}

// ── Shared portal dropdown ────────────────────────────────────────────────────

function DropdownPortal({
  dropRef,
  style,
  query,
  onQuery,
  onEscape,
  searchRef,
  searchPlaceholder,
  filtered,
  value,
  onSelect,
}: {
  dropRef: React.RefObject<HTMLDivElement | null>;
  style: CSSProperties;
  query: string;
  onQuery: (q: string) => void;
  onEscape: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  searchPlaceholder: string;
  filtered: ComboboxOption[];
  value: string;
  onSelect: (v: string) => void;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={dropRef}
      style={style}
      className="border-border bg-popover overflow-hidden rounded-xl border shadow-xl"
    >
      {/* Search bar */}
      <div className="border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onEscape()}
            placeholder={searchPlaceholder}
            className="border-input bg-muted/40 placeholder:text-muted-foreground h-7 w-full rounded-lg border ps-8 pe-2 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>
      {/* Option list */}
      <ul role="listbox" className="max-h-52 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <li className="text-muted-foreground px-3 py-2.5 text-sm">No results</li>
        ) : (
          filtered.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                // prevent blur on trigger before selection
                e.preventDefault();
                onSelect(o.value);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm transition-colors hover:bg-muted/50",
                o.value === value && "bg-primary/8 text-primary",
              )}
            >
              {o.pre && (
                <span className="shrink-0 text-base leading-none">{o.pre}</span>
              )}
              <span className="flex-1 truncate">{o.label}</span>
              {o.sublabel && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {o.sublabel}
                </span>
              )}
              {o.value === value && <Check className="size-3.5 shrink-0" />}
            </li>
          ))
        )}
      </ul>
    </div>,
    document.body,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcDropdownStyle(
  anchorRect: DOMRect,
  dropdownMaxH = 280,
  minWidth = 0,
): CSSProperties {
  const width = Math.max(anchorRect.width, minWidth);
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;
  const openAbove = spaceBelow < dropdownMaxH && spaceAbove > spaceBelow;

  return openAbove
    ? { position: "fixed", bottom: window.innerHeight - anchorRect.top + 4, left: anchorRect.left, width, zIndex: 9999 }
    : { position: "fixed", top: anchorRect.bottom + 4, left: anchorRect.left, width, zIndex: 9999 };
}

function useDropdown(options: ComboboxOption[], minWidth = 0) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<CSSProperties>({});
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? options.filter((o) =>
        [o.label, o.sublabel, o.value].some((s) =>
          s?.toLowerCase().includes(query.toLowerCase()),
        ),
      )
    : options;

  function openAt(rect: DOMRect) {
    setStyle(calcDropdownStyle(rect, 280, minWidth));
    setOpen(true);
  }

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  return { open, setOpen, query, setQuery, style, dropRef, searchRef, filtered, openAt };
}

// ── Full-width Combobox ───────────────────────────────────────────────────────

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  disabled,
  className,
  "data-testid": testId,
}: ComboboxProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { open, setOpen, query, setQuery, style, dropRef, searchRef, filtered, openAt } =
    useDropdown(options);

  const selected = options.find((o) => o.value === value);

  // Close on outside interaction
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        !wrapRef.current?.contains(e.target as Node) &&
        !dropRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, dropRef, setOpen]);

  function toggle() {
    if (disabled) return;
    if (open) {
      setOpen(false);
    } else {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect) openAt(rect);
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-testid={testId}
        className={cn(
          "border-input bg-background flex h-10 w-full items-center justify-between gap-2 rounded-xl border px-3.5 text-start text-sm outline-none transition-all",
          "hover:bg-muted/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
          open && "border-primary ring-2 ring-primary/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span
          className={cn(
            "flex min-w-0 items-center gap-2",
            !selected && "text-muted-foreground",
          )}
        >
          {selected?.pre && (
            <span className="shrink-0 text-base leading-none">{selected.pre}</span>
          )}
          <span className="truncate">{selected?.label ?? placeholder}</span>
          {selected?.sublabel && (
            <span className="text-muted-foreground shrink-0 text-xs">
              {selected.sublabel}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <DropdownPortal
          dropRef={dropRef}
          style={style}
          query={query}
          onQuery={setQuery}
          onEscape={() => setOpen(false)}
          searchRef={searchRef}
          searchPlaceholder={searchPlaceholder}
          filtered={filtered}
          value={value}
          onSelect={(v) => { onChange(v); setOpen(false); }}
        />
      )}
    </div>
  );
}

// ── DialCodePicker ────────────────────────────────────────────────────────────
// Compact trigger designed to sit as the start-side prefix of a phone input group.
// `value` is the ISO-2 country code; `onChange` receives the same.

interface DialCodePickerProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  searchPlaceholder?: string;
  className?: string;
}

export function DialCodePicker({
  options,
  value,
  onChange,
  searchPlaceholder = "Search country…",
  className,
}: DialCodePickerProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const { open, setOpen, query, setQuery, style, dropRef, searchRef, filtered, openAt } =
    useDropdown(options, 260);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !dropRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, dropRef, setOpen]);

  function toggle() {
    if (open) {
      setOpen(false);
    } else {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) openAt(rect);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Select country code"
        className={cn(
          "flex h-full shrink-0 items-center gap-1.5 border-e border-inherit bg-muted/30 px-3 transition-colors hover:bg-muted/50",
          open && "bg-muted/50",
          className,
        )}
      >
        <span className="text-base leading-none">
          {selected?.pre ?? "🌐"}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {selected?.sublabel ?? ""}
        </span>
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <DropdownPortal
          dropRef={dropRef}
          style={style}
          query={query}
          onQuery={setQuery}
          onEscape={() => setOpen(false)}
          searchRef={searchRef}
          searchPlaceholder={searchPlaceholder}
          filtered={filtered}
          value={value}
          onSelect={(v) => { onChange(v); setOpen(false); }}
        />
      )}
    </>
  );
}
