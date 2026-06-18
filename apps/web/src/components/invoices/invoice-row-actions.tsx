"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  MoreHorizontal,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { InvoiceRow } from "@/app/invoices/screen";
import { useAuth } from "@/components/auth-provider";
import { MarkPaidModal } from "@/components/invoices/mark-paid-modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Menu item ────────────────────────────────────────────────────────────────

function MenuItem({
  icon: Icon,
  label,
  onClick,
  href,
  tone = "default",
}: {
  icon: typeof Eye;
  label: string;
  onClick?: () => void;
  href?: string;
  tone?: "default" | "primary";
}) {
  const cls = cn(
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm transition-colors",
    tone === "primary"
      ? "text-primary hover:bg-primary/8"
      : "text-foreground hover:bg-muted",
  );
  const inner = (
    <>
      <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
      <span className="flex-1 truncate">{label}</span>
    </>
  );
  if (href) {
    return (
      <a
        role="menuitem"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        onClick={onClick}
      >
        {inner}
      </a>
    );
  }
  return (
    <button type="button" role="menuitem" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

// ── Row actions ──────────────────────────────────────────────────────────────

export interface InvoiceRowActionsProps {
  row: InvoiceRow;
  /** Open the full detail modal. */
  onView: () => void;
  /** Called after a mutation (mark-paid) so the list + stats refresh. */
  onChanged: () => void;
}

/**
 * The per-bill action cluster shown at the end of every invoice row (Sprint 9 revamp):
 * a primary "View" affordance plus a kebab menu of contextual actions. Mark-paid runs
 * inline via the MarkPaidModal; the heavier send-WhatsApp flow stays in the detail modal.
 */
export function InvoiceRowActions({
  row,
  onView,
  onChanged,
}: InvoiceRowActionsProps) {
  const t = useTranslations("invoices");
  const { can } = useAuth();

  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const canAct =
    row.status === "OPEN" ||
    row.status === "CLOSED" ||
    row.status === "PARTIALLY_PAID";
  const publicUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/i/${row.public_token}`
      : "";

  function openMenu() {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 208;
    setStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left: Math.max(8, rect.right - width),
      width,
      zIndex: 9999,
    });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const menu: ReactNode = open
    ? createPortal(
        <div
          ref={menuRef}
          style={style}
          role="menu"
          className="border-border bg-popover animate-in fade-in-0 zoom-in-95 overflow-hidden rounded-xl border p-1 shadow-xl"
        >
          <MenuItem
            icon={Eye}
            label={t("viewDetails")}
            tone="primary"
            onClick={() => {
              setOpen(false);
              onView();
            }}
          />
          {canAct && can("invoice.mark_paid") && (
            <MenuItem
              icon={Wallet}
              label={t("markPaid")}
              onClick={() => {
                setOpen(false);
                setMarkPaidOpen(true);
              }}
            />
          )}
          <div className="bg-border/60 my-1 h-px" aria-hidden />
          <MenuItem
            icon={copied ? Check : Copy}
            label={copied ? t("copied") : t("copyLink")}
            onClick={() => void copyLink()}
          />
          <MenuItem
            icon={ExternalLink}
            label={t("viewPublicPage")}
            href={publicUrl}
            onClick={() => setOpen(false)}
          />
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className="flex items-center justify-end gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <Button type="button" size="xs" variant="outline" onClick={onView}>
        {t("view")}
      </Button>
      <Button
        ref={btnRef}
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={t("actions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </Button>

      {menu}

      <MarkPaidModal
        open={markPaidOpen}
        invoiceId={row.id}
        totalMinor={row.total_minor}
        currency={row.currency}
        onClose={() => setMarkPaidOpen(false)}
        onSuccess={() => {
          setMarkPaidOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}
