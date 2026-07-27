"use client";

import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { lmsColor, Panel } from "@/components/courses/lms-ui";
import { checkClass, inputClass } from "@/components/courses/form-bits";
import { cn } from "@/lib/utils";

/**
 * Controls the public-site editor is built from (docs/lms/09). The editor is one long form over a
 * dozen content blocks, so the repetitive parts — a collapsible block with a "show on site" switch,
 * and a reorderable list of items — live here rather than being spelled out a dozen times.
 */

/** A collapsible content block with an optional visibility switch. */
export function EditorBlock({
  Icon,
  color = "violet",
  title,
  description,
  show,
  onShowChange,
  showLabel,
  defaultOpen = false,
  count,
  children,
}: {
  Icon: LucideIcon;
  color?: string;
  title: string;
  description?: string;
  /** Omit to render a block that is always visible on the site (brand, SEO, pages). */
  show?: boolean;
  onShowChange?: (value: boolean) => void;
  showLabel?: string;
  defaultOpen?: boolean;
  /** Item count for a repeatable block, shown as a chip when collapsed. */
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const c = lmsColor(color);
  const hidden = show === false;

  return (
    <Panel flush className={hidden ? "opacity-70" : undefined}>
      <div className="flex items-center gap-3 px-5 py-4">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
            c.chip,
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-start"
        >
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-bold tracking-tight">{title}</span>
            {typeof count === "number" && (
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", c.soft)}>
                {count}
              </span>
            )}
          </span>
          {description && (
            <span className="text-muted-foreground mt-0.5 block truncate text-xs">
              {description}
            </span>
          )}
        </button>

        {show !== undefined && onShowChange && (
          <label className="text-muted-foreground flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={show}
              onChange={(e) => onShowChange(e.target.checked)}
              className={checkClass}
            />
            {showLabel}
          </label>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={title}
          className="hover:bg-muted rounded-lg p-1.5 transition-colors"
        >
          <ChevronDown
            className={cn(
              "text-muted-foreground size-4 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>

      {open && <div className="space-y-4 border-t px-5 py-5">{children}</div>}
    </Panel>
  );
}

/**
 * A reorderable list of content items. Order matters on the page (the first three features are the
 * ones most visitors read), so every row carries move controls, not just delete.
 */
export function RepeatableList<T>({
  items,
  onChange,
  create,
  addLabel,
  emptyLabel,
  max,
  maxLabel,
  title,
  children,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  create: () => T;
  addLabel: string;
  emptyLabel: string;
  max: number;
  maxLabel: string;
  /** Row heading, e.g. the item's own name. */
  title: (item: T, index: number) => string;
  children: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
}) {
  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved !== undefined) next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-xs">
          {emptyLabel}
        </p>
      )}

      {items.map((item, index) => (
        <div key={index} className="border-input rounded-xl border">
          <div className="bg-muted/40 flex items-center gap-2 rounded-t-xl border-b px-3 py-2">
            <GripVertical className="text-muted-foreground/50 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">
              {title(item, index) || `#${index + 1}`}
            </span>
            <button
              type="button"
              onClick={() => move(index, index - 1)}
              disabled={index === 0}
              aria-label="up"
              className="hover:bg-background rounded-md p-1 transition-colors disabled:opacity-30"
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => move(index, index + 1)}
              disabled={index === items.length - 1}
              aria-label="down"
              className="hover:bg-background rounded-md p-1 transition-colors disabled:opacity-30"
            >
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              aria-label="remove"
              className="text-destructive hover:bg-destructive/10 rounded-md p-1 transition-colors"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>

          <div className="space-y-3 p-3">
            {children(
              item,
              (patch) =>
                onChange(items.map((row, i) => (i === index ? { ...row, ...patch } : row))),
              index,
            )}
          </div>
        </div>
      ))}

      {items.length >= max ? (
        <p className="text-muted-foreground text-xs">{maxLabel}</p>
      ) : (
        <button
          type="button"
          onClick={() => onChange([...items, create()])}
          className="border-input hover:border-primary/50 hover:text-primary text-muted-foreground flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2.5 text-xs font-medium transition-colors"
        >
          <Plus className="size-3.5" aria-hidden />
          {addLabel}
        </button>
      )}
    </div>
  );
}

/** A list of plain strings (hero badges, about bullets) — the same controls, one input per row. */
export function StringList({
  items,
  onChange,
  addLabel,
  placeholder,
  max,
  maxLabel,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
  placeholder: string;
  max: number;
  maxLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((value, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            className={inputClass}
            value={value}
            placeholder={placeholder}
            onChange={(e) =>
              onChange(items.map((row, i) => (i === index ? e.target.value : row)))
            }
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
            aria-label="remove"
            className="text-destructive hover:bg-destructive/10 shrink-0 rounded-lg p-2 transition-colors"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      ))}

      {items.length >= max ? (
        <p className="text-muted-foreground text-xs">{maxLabel}</p>
      ) : (
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="border-input hover:border-primary/50 hover:text-primary text-muted-foreground flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2 text-xs font-medium transition-colors"
        >
          <Plus className="size-3.5" aria-hidden />
          {addLabel}
        </button>
      )}
    </div>
  );
}

/** Brand-colour picker: a swatch, a native colour input and the hex, kept in sync. */
export function ColorField({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (value: string) => void;
  presets: string[];
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : "#12836a"}
          onChange={(e) => onChange(e.target.value)}
          aria-label="color"
          className="border-input size-9 shrink-0 cursor-pointer rounded-xl border bg-transparent p-1"
        />
        <input
          className={cn(inputClass, "font-mono uppercase")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#12836A"
          aria-invalid={!valid}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-label={preset}
            className={cn(
              "size-6 rounded-lg ring-offset-2 transition-transform hover:scale-110",
              value.toLowerCase() === preset.toLowerCase() && "ring-foreground/40 ring-2",
            )}
            style={{ background: preset }}
          />
        ))}
      </div>
    </div>
  );
}
