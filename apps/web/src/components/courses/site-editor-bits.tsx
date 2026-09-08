"use client";

import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Image as ImageIcon,
  ImageOff,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { inputClass } from "@/components/courses/form-bits";
import { cn } from "@/lib/utils";

/**
 * The field-level controls the site builder is built from (docs/lms/09) — the repeating shapes a
 * content document needs: an ordered list of items, a list of plain strings, an image slot and a
 * colour picker. The builder's own chrome (the section rail, the live preview) is in
 * components/courses/site-builder.tsx.
 */

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
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
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
        <div
          key={index}
          onDragOver={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            setOver(index);
          }}
          onDrop={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            move(dragging, index);
            setDragging(null);
            setOver(null);
          }}
          className={cn(
            "border-input rounded-xl border transition-shadow",
            dragging === index && "opacity-40",
            over === index && dragging !== null && dragging !== index && "ring-primary/60 ring-2",
          )}
        >
          {/* The whole header is the drag handle — a 3.5px grip icon is a target nobody hits, and
              the arrows stay for keyboards and touch, where dragging isn't available at all. */}
          <div
            draggable
            onDragStart={(e) => {
              setDragging(index);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            className="bg-muted/40 flex cursor-grab items-center gap-2 rounded-t-xl border-b px-3 py-2 active:cursor-grabbing"
          >
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

/**
 * An image slot: a thumbnail that IS the control, with the URL underneath.
 *
 * Images on the public site are URLs, not uploads (docs/lms/09), which used to leave the client with
 * a bare text box and no feedback until they published. The frame answers the three questions a
 * pasted link actually raises — does it load, is it the right shape, and is this the one I meant —
 * and gives them a one-click way to take it back off.
 */
export function ImageField({
  value,
  onChange,
  /** `square` for a logo or avatar, `wide` for a hero or cover. Matches how the site crops it. */
  shape = "wide",
  alt,
  placeholder = "https://…",
  emptyLabel,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  shape?: "square" | "wide";
  alt: string;
  placeholder?: string;
  emptyLabel?: string;
  clearLabel?: string;
}) {
  const [broken, setBroken] = useState(false);
  const url = value.trim();
  const usable = /^https?:\/\//i.test(url);
  const showing = usable && !broken;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "bg-muted/40 border-input relative overflow-hidden rounded-xl border border-dashed",
          shape === "square" ? "size-24" : "aspect-[16/7] w-full max-w-[15rem]",
        )}
      >
        {showing ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={alt}
              className="size-full object-cover"
              onError={() => setBroken(true)}
            />
            <button
              type="button"
              onClick={() => {
                setBroken(false);
                onChange("");
              }}
              aria-label={clearLabel ?? "remove"}
              title={clearLabel}
              className="bg-background/90 text-muted-foreground hover:text-destructive absolute end-1.5 top-1.5 rounded-lg p-1 shadow-sm backdrop-blur transition-colors"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <span className="text-muted-foreground/70 absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center">
            {broken ? (
              <ImageOff className="size-5" aria-hidden />
            ) : (
              <ImageIcon className="size-5" aria-hidden />
            )}
            {emptyLabel && <span className="text-[10px] leading-tight">{emptyLabel}</span>}
          </span>
        )}
      </div>

      <input
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          setBroken(false);
          onChange(e.target.value);
        }}
      />
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
