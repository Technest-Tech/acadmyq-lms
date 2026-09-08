"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Everything a keyboard can land on inside the dialog, in document order. */
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

const SIZE_CLASSES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: keyof typeof SIZE_CLASSES;
  children: ReactNode;
  footer?: ReactNode;
  /** Accessible name for the close button. Defaults to "Close"; pass a translated one. */
  closeLabel?: string;
  /**
   * Palette for the portal.
   *
   * The dialog is rendered into `document.body`, which puts it OUTSIDE whatever surface opened it.
   * That is fine inside the staff app, where body and surface share a theme — but the public course
   * site pins itself to a light palette on its own wrapper (`.learn-site`), and a modal escaping it
   * inherits the staff dark theme instead: black inputs, invisible labels, on a page a stranger is
   * trying to sign in on. Passing the surface's class and CSS variables here carries the palette
   * across the portal. See components/learn/site-modal.tsx.
   */
  themeClassName?: string;
  themeStyle?: CSSProperties;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
  closeLabel = "Close",
  themeClassName,
  themeStyle,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * Escape closes, and Tab stays inside.
   *
   * Without the trap, tabbing out of a sign-in dialog lands on the page behind it — which on a
   * phone means the on-screen keyboard is now editing a form the visitor cannot see. The dialog
   * also takes focus when it opens and hands it back to whatever opened it on close, so a keyboard
   * user is never dropped at the top of the document.
   */
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    (focusables()[0] ?? node)?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || node === null) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    // `display: contents` — the wrapper carries the palette (custom properties and color-scheme
    // both inherit) without adding a box that would change the fixed positioning below it.
    <div className={cn("contents", themeClassName)} style={themeStyle}>
      {/* Backdrop — rendered in document.body, always covers full viewport */}
      <div
        className="animate-in fade-in fixed inset-0 z-50 bg-black/40 duration-150"
        aria-hidden
        onClick={onClose}
      />

      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 outline-none",
              // dvh, not vh: with the mobile keyboard open the visual viewport shrinks, and a
              // dialog sized to the layout viewport puts its submit button under the keyboard.
              "relative flex w-full flex-col max-h-[90dvh]",
              "rounded-2xl bg-card shadow-2xl ring-1 ring-foreground/[0.08] duration-200",
              SIZE_CLASSES[size],
            )}
          >
            {/* Header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
              <div>
                <h2
                  id={titleId}
                  className="text-base font-semibold leading-snug"
                >
                  {title}
                </h2>
                {description && (
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/60 mt-0.5 shrink-0 rounded-lg p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                aria-label={closeLabel}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="bg-muted/30 flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
