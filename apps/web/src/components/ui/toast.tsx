"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertBanner } from "@/components/ui/alert";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 5000;

/**
 * App-wide popup toast host. Stacks transient success/error/info alerts in a fixed
 * top-end column (RTL-aware) rendered into document.body, each reusing the AlertBanner
 * visuals and auto-dismissing after a few seconds (or on the close button). Mounted once
 * in the root layout; consume via `useToast()`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  // In the desktop app the window is frameless and the macOS traffic lights float over the top-left
  // corner — where toasts land in RTL (the default locale). Drop the toast column below them so their
  // dismiss/action buttons are never trapped under the native window controls.
  const [isDesktop, setIsDesktop] = useState(false);
  const nextId = useRef(0);

  // Portals need a real DOM target — only render the host after the client has mounted.
  useEffect(() => {
    setMounted(true);
    setIsDesktop(!!window.academiqDesktop);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, variant, message }]);
      setTimeout(() => dismiss(id), DEFAULT_DURATION);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div
            className={`pointer-events-none fixed end-4 z-[100] flex w-full max-w-sm flex-col gap-2 ${
              isDesktop ? "top-14" : "top-4"
            }`}
            role="region"
            aria-label="Notifications"
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                className="animate-in fade-in slide-in-from-top-2 pointer-events-auto rounded-xl bg-background shadow-lg duration-200"
              >
                <AlertBanner
                  variant={t.variant}
                  message={t.message}
                  onDismiss={() => dismiss(t.id)}
                />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
