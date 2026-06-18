"use client";

import { Download, Loader2, Save } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/components/auth-provider";
import {
  CertificatePreview,
  CERT_HEIGHT,
  CERT_WIDTH,
  type CertLang,
} from "@/components/certificates/certificate-designs";
import { Button } from "@/components/ui/button";
import {
  listCertificateTemplates,
  saveCertificateTemplate,
  type CertificateContent,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type TemplateNumber = 1 | 2;

/** The editable text fields, paired by language; `base` keys into CertificateContent. */
const TEXT_FIELDS = [
  { base: "academyName", multiline: false },
  { base: "title", multiline: false },
  { base: "presentation", multiline: false },
  { base: "body", multiline: true },
  { base: "signatoryName", multiline: false },
  { base: "signatoryTitle", multiline: false },
] as const;

function langKey(
  base: (typeof TEXT_FIELDS)[number]["base"],
  lang: CertLang,
): keyof CertificateContent {
  return `${base}${lang === "ar" ? "Ar" : "En"}` as keyof CertificateContent;
}

export function CertificatesScreen() {
  const t = useTranslations("certificates");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("certificate.manage");

  const [drafts, setDrafts] = useState<Record<TemplateNumber, CertificateContent> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState<TemplateNumber>(1);
  const [lang, setLang] = useState<CertLang>(locale === "ar" ? "ar" : "en");
  const [recipientName, setRecipientName] = useState("");
  const [dateValue, setDateValue] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Load both templates ──
  useEffect(() => {
    let alive = true;
    listCertificateTemplates()
      .then(({ templates }) => {
        if (!alive) return;
        const map = {} as Record<TemplateNumber, CertificateContent>;
        for (const tpl of templates) map[tpl.templateNumber] = tpl.content;
        setDrafts(map);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, []);

  const draft = drafts?.[active] ?? null;

  const dateLabel = useMemo(() => {
    const d = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateValue;
    return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  }, [dateValue, lang]);

  const setField = useCallback(
    (key: keyof CertificateContent, value: string) => {
      setDrafts((prev) =>
        prev ? { ...prev, [active]: { ...prev[active], [key]: value } } : prev,
      );
      setSavedTick(false);
    },
    [active],
  );

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setActionError(null);
    try {
      await saveCertificateTemplate(active, draft);
      setSavedTick(true);
    } catch {
      setActionError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }, [active, draft, t]);

  const captureRef = useRef<HTMLDivElement>(null);

  const handleDownload = useCallback(async () => {
    const node = captureRef.current;
    if (!node) return;
    setDownloading(true);
    setActionError(null);
    try {
      const [{ jsPDF }, html2canvasMod] = await Promise.all([
        import("jspdf"),
        import("html2canvas-pro"),
      ]);
      const html2canvas = html2canvasMod.default;
      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: null,
        logging: false,
      });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "px",
        format: [CERT_WIDTH, CERT_HEIGHT],
      });
      pdf.addImage(img, "PNG", 0, 0, CERT_WIDTH, CERT_HEIGHT);
      const safeName = (recipientName.trim() || "certificate").replace(/[^\p{L}\p{N}_-]+/gu, "_");
      pdf.save(`${safeName}.pdf`);
    } catch {
      setActionError(t("downloadError"));
    } finally {
      setDownloading(false);
    }
  }, [recipientName, t]);

  if (!can("certificate.read")) {
    return <p className="text-muted-foreground text-sm">{t("noAccess")}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("subtitle")}</p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t("loadError")}
        </div>
      )}

      {/* Template selector */}
      <div className="flex flex-wrap gap-2" data-testid="template-tabs">
        {([1, 2] as const).map((n) => (
          <button
            key={n}
            type="button"
            data-template-tab={n}
            onClick={() => {
              setActive(n);
              setSavedTick(false);
            }}
            className={cn(
              "rounded-lg border px-4 py-2 text-sm font-semibold transition-colors",
              active === n
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {t(n === 1 ? "template1Name" : "template2Name")}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        {/* ── Editor ── */}
        <div className="space-y-5">
          <section className="bg-card space-y-4 rounded-xl border p-4 shadow-sm">
            <h2 className="text-foreground text-sm font-semibold">{t("recipientHeading")}</h2>

            <div className="space-y-1.5">
              <label className="text-muted-foreground text-xs font-medium" htmlFor="cert-recipient">
                {t("recipientName")}
              </label>
              <input
                id="cert-recipient"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder={t("recipientPlaceholder")}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-muted-foreground text-xs font-medium" htmlFor="cert-date">
                {t("date")}
              </label>
              <input
                id="cert-date"
                type="date"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-muted-foreground text-xs font-medium">{t("language")}</span>
              <div className="flex gap-2">
                {(["en", "ar"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    data-lang={l}
                    onClick={() => setLang(l)}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                      lang === l
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t(l === "en" ? "langEn" : "langAr")}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-card space-y-4 rounded-xl border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-foreground text-sm font-semibold">{t("contentHeading")}</h2>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{t("accentColor")}</span>
                <input
                  type="color"
                  aria-label={t("accentColor")}
                  value={draft?.accentColor ?? "#C9A227"}
                  disabled={!canManage || !draft}
                  onChange={(e) => setField("accentColor", e.target.value)}
                  className="size-8 cursor-pointer rounded border bg-transparent disabled:cursor-not-allowed"
                />
              </div>
            </div>

            {TEXT_FIELDS.map(({ base, multiline }) => {
              const key = langKey(base, lang);
              const value = draft ? (draft[key] as string) : "";
              return (
                <div key={base} className="space-y-1.5">
                  <label className="text-muted-foreground text-xs font-medium" htmlFor={`cert-${base}`}>
                    {t(`field_${base}`)}
                  </label>
                  {multiline ? (
                    <textarea
                      id={`cert-${base}`}
                      rows={3}
                      dir={lang === "ar" ? "rtl" : "ltr"}
                      value={value}
                      disabled={!canManage || !draft}
                      onChange={(e) => setField(key, e.target.value)}
                      className="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    />
                  ) : (
                    <input
                      id={`cert-${base}`}
                      dir={lang === "ar" ? "rtl" : "ltr"}
                      value={value}
                      disabled={!canManage || !draft}
                      onChange={(e) => setField(key, e.target.value)}
                      className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    />
                  )}
                </div>
              );
            })}

            {canManage && (
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || !draft}
                className="w-full"
                data-testid="cert-save"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                {savedTick ? t("saved") : t("save")}
              </Button>
            )}
          </section>
        </div>

        {/* ── Preview + download ── */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-foreground text-sm font-semibold">{t("previewHeading")}</h2>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownload}
              disabled={downloading || !draft}
              data-testid="cert-download"
            >
              {downloading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              {t("download")}
            </Button>
          </div>

          {actionError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {actionError}
            </div>
          )}

          {draft && (
            <ScaledPreview>
              <CertificatePreview
                templateNumber={active}
                content={draft}
                recipientName={recipientName}
                dateLabel={dateLabel}
                lang={lang}
              />
            </ScaledPreview>
          )}
        </div>
      </div>

      {/* Off-screen full-size node for crisp PDF capture */}
      {draft && (
        <div
          ref={captureRef}
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            insetInlineStart: -100000,
            width: CERT_WIDTH,
            height: CERT_HEIGHT,
            pointerEvents: "none",
          }}
        >
          <CertificatePreview
            templateNumber={active}
            content={draft}
            recipientName={recipientName}
            dateLabel={dateLabel}
            lang={lang}
          />
        </div>
      )}
    </div>
  );
}

/** Scales the fixed-size certificate down to fit the available column width. */
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, (el.clientWidth || CERT_WIDTH) / CERT_WIDTH));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="overflow-hidden rounded-xl border shadow-sm"
      style={{ height: CERT_HEIGHT * scale }}
    >
      <div style={{ width: CERT_WIDTH, height: CERT_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}
