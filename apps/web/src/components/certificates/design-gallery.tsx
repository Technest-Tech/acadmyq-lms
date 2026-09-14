"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  CERTIFICATE_DESIGNS,
  CertificatePreview,
  DESIGN_CATEGORIES,
  type CertificateDesign,
  type DesignCategory,
} from "./certificate-designs";
import { ScaledCertificate } from "./editor-fields";
import type { CertLang } from "./kit";
import type { CertificateContent } from "@/lib/api";
import { cn } from "@/lib/utils";

export type DesignStatus = "default" | "customized" | "unsaved";

/** A name that shows off each design in its thumbnail without pretending to be anyone real. */
const SAMPLE_NAME: Record<CertLang, string> = { en: "Maryam Hassan", ar: "مريم حسن" };

/**
 * The design picker: a filterable rail of live thumbnails. Each thumbnail is the real design fed the
 * academy's own wording, so a design is chosen by what it will actually look like — not by a stock
 * image of somebody else's certificate.
 */
export function DesignGallery({
  active,
  onSelect,
  drafts,
  status,
  lang,
  logoDataUrl,
  dateLabel,
}: {
  active: number;
  onSelect: (templateNumber: number) => void;
  drafts: Record<number, CertificateContent>;
  status: Record<number, DesignStatus>;
  lang: CertLang;
  logoDataUrl: string | null;
  dateLabel: string;
}) {
  const t = useTranslations("certificates");
  const [category, setCategory] = useState<DesignCategory | "all">("all");
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const visible = CERTIFICATE_DESIGNS.filter((d) => category === "all" || d.category === category);

  // Scroll position is read as a magnitude: RTL rails report negative scrollLeft in modern browsers.
  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const pos = Math.abs(el.scrollLeft);
    setEdges({ start: pos < 4, end: pos + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = railRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, category]);

  const scrollBy = (direction: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: direction * (rtl ? -1 : 1) * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className="bg-card overflow-hidden rounded-2xl border shadow-sm" data-testid="design-gallery">
      <div className="flex flex-col gap-3 border-b px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-foreground text-sm font-semibold">{t("galleryHeading")}</h2>
          <p className="text-muted-foreground text-xs">{t("galleryHint", { count: CERTIFICATE_DESIGNS.length })}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5" role="group" aria-label={t("filterLabel")}>
            {(["all", ...DESIGN_CATEGORIES] as const).map((c) => {
              const count = c === "all" ? CERTIFICATE_DESIGNS.length : CERTIFICATE_DESIGNS.filter((d) => d.category === c).length;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  data-category={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    category === c
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground border-transparent",
                  )}
                >
                  {t(`category_${c}`)}
                  <span className="text-[10px] tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="hidden gap-1 sm:flex">
            <RailButton label={t("scrollBack")} disabled={edges.start} onClick={() => scrollBy(-1)}>
              <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
            </RailButton>
            <RailButton label={t("scrollForward")} disabled={edges.end} onClick={() => scrollBy(1)}>
              <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
            </RailButton>
          </div>
        </div>
      </div>

      <div
        ref={railRef}
        onScroll={measure}
        className="flex snap-x gap-3 overflow-x-auto scroll-smooth px-4 py-4 [scrollbar-width:thin]"
      >
        {visible.map((design) => {
          const content = drafts[design.number];
          if (!content) return null;
          return (
            <DesignThumb
              key={design.number}
              design={design}
              content={content}
              lang={lang}
              logoDataUrl={logoDataUrl}
              dateLabel={dateLabel}
              selected={active === design.number}
              status={status[design.number] ?? "default"}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </section>
  );
}

function RailButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-7 items-center justify-center rounded-full border transition-colors disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Memoised: typing in the editor re-renders the open design's thumbnail, not all nine. */
const DesignThumb = memo(function DesignThumb({
  design,
  content,
  lang,
  logoDataUrl,
  dateLabel,
  selected,
  status,
  onSelect,
}: {
  design: CertificateDesign;
  content: CertificateContent;
  lang: CertLang;
  logoDataUrl: string | null;
  dateLabel: string;
  selected: boolean;
  status: DesignStatus;
  onSelect: (templateNumber: number) => void;
}) {
  const t = useTranslations("certificates");
  const name = t(`designs.${design.key}.name`);

  return (
    <button
      type="button"
      onClick={() => onSelect(design.number)}
      aria-pressed={selected}
      aria-label={name}
      data-design={design.key}
      className={cn(
        "group bg-card relative w-56 shrink-0 snap-start overflow-hidden rounded-xl border text-start transition-all",
        selected
          ? "border-primary/50 ring-primary/25 shadow-md ring-2"
          : "hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-md",
      )}
    >
      {selected && (
        <span className="via-gold absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent to-transparent" aria-hidden />
      )}

      <div className="bg-muted/60 relative p-2.5">
        <div className="overflow-hidden rounded-[5px] shadow-[0_6px_16px_-8px_rgba(15,23,42,0.45)] ring-1 ring-black/5">
          <ScaledCertificate>
            <CertificatePreview
              templateNumber={design.number}
              content={content}
              recipientName={SAMPLE_NAME[lang]}
              dateLabel={dateLabel}
              lang={lang}
              logoDataUrl={logoDataUrl}
            />
          </ScaledCertificate>
        </div>
        {selected && (
          <span className="bg-primary text-primary-foreground absolute end-4 top-4 flex size-6 items-center justify-center rounded-full shadow-md">
            <Check className="size-3.5" aria-hidden />
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-foreground truncate text-sm font-semibold">{name}</div>
          <div className="text-muted-foreground truncate text-[11px]">{t(`designs.${design.key}.hint`)}</div>
        </div>
        {status !== "default" && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              status === "unsaved"
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-primary/10 text-primary",
            )}
          >
            <span className={cn("size-1.5 rounded-full", status === "unsaved" ? "bg-amber-500" : "bg-primary")} />
            {t(status === "unsaved" ? "statusUnsaved" : "statusCustomized")}
          </span>
        )}
      </div>
    </button>
  );
});
