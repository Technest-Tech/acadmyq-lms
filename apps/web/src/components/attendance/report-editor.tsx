"use client";

import {
  Bold,
  Eraser,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";

// ── Toolbar definition ───────────────────────────────────────────────────────

type DividerItem = { kind: "divider" };
type ButtonItem = {
  kind: "button";
  command: string;
  value?: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
};
type ToolbarItem = DividerItem | ButtonItem;

const TOOLBAR: ToolbarItem[] = [
  { kind: "button", command: "bold", icon: Bold, label: "Bold" },
  { kind: "button", command: "italic", icon: Italic, label: "Italic" },
  { kind: "button", command: "underline", icon: Underline, label: "Underline" },
  { kind: "button", command: "strikeThrough", icon: Strikethrough, label: "Strikethrough" },
  { kind: "divider" },
  { kind: "button", command: "insertUnorderedList", icon: List, label: "Bullet list" },
  { kind: "button", command: "insertOrderedList", icon: ListOrdered, label: "Numbered list" },
  { kind: "divider" },
  { kind: "button", command: "formatBlock", value: "h1", icon: Heading1, label: "Heading 1" },
  { kind: "button", command: "formatBlock", value: "h2", icon: Heading2, label: "Heading 2" },
  { kind: "button", command: "formatBlock", value: "blockquote", icon: Quote, label: "Quote" },
  { kind: "divider" },
  { kind: "button", command: "removeFormat", icon: Eraser, label: "Clear formatting" },
];

// Commands that support queryCommandState (toggleable inline styles)
const STATEFUL_COMMANDS = new Set(["bold", "italic", "underline", "strikeThrough"]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip JS event handlers and script/style tags; keep formatting HTML. */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\shref="javascript:[^"]*"/gi, "");
}

function isEffectivelyEmpty(html: string): boolean {
  if (!html || html === "<br>") return true;
  return html.replace(/<[^>]+>/g, "").trim() === "";
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * A lightweight WYSIWYG editor built on `contenteditable` + `execCommand`.
 * Toolbar: Bold · Italic · Underline · Strikethrough | Bullet · Numbered | H1 · H2 · Quote | Clear
 * Stores and emits sanitised HTML. Falls back gracefully if the saved value is plain text.
 */
export function ReportEditor({
  value,
  onChange,
  disabled = false,
  placeholder,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  // null sentinel = not yet written to the DOM, so the first effect run always
  // populates the editor with the initial value (e.g. when reopened via Edit).
  const lastValueRef = useRef<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(() => isEffectivelyEmpty(value));
  const [activeCommands, setActiveCommands] = useState<Set<string>>(new Set());

  // Sync value into the contenteditable on mount and whenever it changes externally.
  useEffect(() => {
    if (!editorRef.current) return;
    if (value !== lastValueRef.current) {
      editorRef.current.innerHTML = value;
      setIsEmpty(isEffectivelyEmpty(value));
      lastValueRef.current = value;
    }
  }, [value]);

  function syncActiveState() {
    const next = new Set<string>();
    for (const cmd of STATEFUL_COMMANDS) {
      try {
        if (document.queryCommandState(cmd)) next.add(cmd);
      } catch {
        // ignore unsupported commands
      }
    }
    setActiveCommands(next);
  }

  function flush() {
    if (!editorRef.current) return;
    const raw = editorRef.current.innerHTML;
    const empty = isEffectivelyEmpty(raw);
    setIsEmpty(empty);
    const next = empty ? "" : sanitize(raw);
    if (next !== lastValueRef.current) {
      lastValueRef.current = next;
      onChange(next);
    }
  }

  function exec(command: string, val?: string) {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false, val ?? "");
    syncActiveState();
    flush();
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-input bg-background transition-colors",
        "focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-2 py-1.5"
        onMouseDown={(e) => e.preventDefault()} // keep editor focused on toolbar click
      >
        {TOOLBAR.map((item, idx) => {
          if (item.kind === "divider") {
            return (
              <span
                key={idx}
                className="mx-1 h-4 w-px shrink-0 bg-border"
                aria-hidden
              />
            );
          }
          const Icon = item.icon;
          const isActive =
            STATEFUL_COMMANDS.has(item.command) && activeCommands.has(item.command);
          return (
            <button
              key={`${item.command}-${item.value ?? ""}`}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-pressed={isActive}
              disabled={disabled}
              onMouseDown={(e) => {
                e.preventDefault();
                exec(item.command, item.value);
              }}
              className={cn(
                "flex size-7 items-center justify-center rounded-md transition-colors",
                "disabled:pointer-events-none disabled:opacity-40",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          );
        })}
      </div>

      {/* ── Editable area ───────────────────────────────────────────────── */}
      <div className="relative">
        {/* Placeholder */}
        {isEmpty && placeholder && (
          <p
            className="pointer-events-none absolute start-4 top-3 select-none text-sm text-muted-foreground"
            aria-hidden
          >
            {placeholder}
          </p>
        )}

        <div
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          contentEditable={!disabled}
          suppressContentEditableWarning
          spellCheck
          onInput={flush}
          onBlur={flush}
          onKeyUp={syncActiveState}
          onMouseUp={syncActiveState}
          onSelect={syncActiveState}
          data-testid="report-text"
          className={cn(
            "min-h-[240px] px-4 py-3 text-sm outline-none",
            // Lists
            "[&_ul]:ms-5 [&_ul]:list-disc [&_ul]:space-y-0.5",
            "[&_ol]:ms-5 [&_ol]:list-decimal [&_ol]:space-y-0.5",
            // Inline
            "[&_b]:font-bold [&_strong]:font-bold",
            "[&_em]:italic [&_i]:italic",
            "[&_u]:underline",
            "[&_s]:line-through [&_del]:line-through [&_strike]:line-through",
            // Headings
            "[&_h1]:mt-1 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold",
            "[&_h2]:mt-1 [&_h2]:mb-1.5 [&_h2]:text-lg [&_h2]:font-semibold",
            // Blockquote
            "[&_blockquote]:rounded-md [&_blockquote]:border-s-2 [&_blockquote]:border-primary/40 [&_blockquote]:bg-primary/5 [&_blockquote]:py-1 [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
            // Paragraph spacing
            "[&>*+*]:mt-1.5",
          )}
        />
      </div>
    </div>
  );
}
