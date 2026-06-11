"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

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
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      {/* Backdrop — rendered in document.body, always covers full viewport */}
      <div
        className="animate-in fade-in fixed inset-0 z-50 bg-black/40 duration-150"
        aria-hidden
        onClick={onClose}
      />

      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
          <div
            role="dialog"
            aria-modal
            aria-labelledby="modal-title"
            className={cn(
              "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4",
              "relative flex w-full flex-col max-h-[90dvh]",
              "rounded-2xl bg-card shadow-2xl ring-1 ring-foreground/[0.08] duration-200",
              SIZE_CLASSES[size],
            )}
          >
            {/* Header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
              <div>
                <h2
                  id="modal-title"
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
                className="text-muted-foreground hover:bg-muted hover:text-foreground mt-0.5 shrink-0 rounded-lg p-1.5 transition-colors"
                aria-label="Close"
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
    </>,
    document.body,
  );
}
