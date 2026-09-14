"use client";

import {
  Award,
  CheckCircle2,
  FileDown,
  Files,
  ImageDown,
  LayoutTemplate,
  Loader2,
  Lock,
  Palette,
  Save,
  Type,
  UserRound,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { useAuth } from "@/components/auth-provider";
import {
  CERT_HEIGHT,
  CERT_WIDTH,
  CertificatePreview,
  designByNumber,
  type CertLang,
} from "@/components/certificates/certificate-designs";
import { DesignGallery, type DesignStatus } from "@/components/certificates/design-gallery";
import { ScaledCertificate, Segmented } from "@/components/certificates/editor-fields";
import {
  canvasToBlob,
  captureCertificate,
  createCertificatePdf,
  safeFileName,
  saveBlob,
  serialAt,
  settleForCapture,
} from "@/components/certificates/export";
import { CERT_COPY } from "@/components/certificates/kit";
import { bulkNames, RecipientPanel, type RecipientState } from "@/components/certificates/recipient-panel";
import { BrandingPanel, WordingPanel } from "@/components/certificates/template-panels";
import { KhatamLattice } from "@/components/ornaments";
import { Button } from "@/components/ui/button";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import {
  listCertificateTemplates,
  saveCertificateTemplate,
  type CertificateContent,
  type CertificateTemplate,
} from "@/lib/api";
import { inlineImage } from "@/lib/inline-image";
import { cn } from "@/lib/utils";

type Tab = "recipient" | "wording" | "branding";

const TABS: { key: Tab; icon: ComponentType<{ className?: string }> }[] = [
  { key: "recipient", icon: UserRound },
  { key: "wording", icon: Type },
  { key: "branding", icon: Palette },
];

const WORDING_KEYS = ["titleEn", "titleAr", "presentationEn", "presentationAr", "bodyEn", "bodyAr"] as const;

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sameContent(a: CertificateContent, b: CertificateContent): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof CertificateContent>;
  for (const k of keys) if ((a[k] ?? "") !== (b[k] ?? "")) return false;
  return true;
}

/**
 * Certificates. An academy picks one of the catalogue's designs, dresses it in its own wording and
 * brand, and prints it — for one student, or for a whole class as a single PDF.
 *
 * What is SAVED is the template (wording, accent, signatures, per design). Who a certificate is for,
 * the date and the number are per-issue and never persisted: this screen prints documents, it does
 * not keep a register of them.
 *
 * Permission-gated client-side (certificate.read) and enforced by the API (certificate.read to view,
 * certificate.manage to edit). The student lookups need student.read and quietly step aside without it.
 */
export function CertificatesScreen() {
  const t = useTranslations("certificates");
  const locale = useLocale();
  const { can, session } = useAuth();
  const canRead = can("certificate.read");
  const canManage = can("certificate.manage");
  const canSearchStudents = can("student.read");

  const [templates, setTemplates] = useState<Record<number, CertificateTemplate> | null>(null);
  const [drafts, setDrafts] = useState<Record<number, CertificateContent>>({});
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState(1);
  const [lang, setLang] = useState<CertLang>(locale === "ar" ? "ar" : "en");
  const [tab, setTab] = useState<Tab>("recipient");
  const [recipient, setRecipient] = useState<RecipientState>(() => ({
    mode: "single",
    name: "",
    courseTitle: "",
    date: localToday(),
    serial: "",
    students: [],
    extraNames: "",
  }));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [busy, setBusy] = useState<null | "png" | "pdf" | "bulk">(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [captureIndex, setCaptureIndex] = useState(0);
  const cancelRef = useRef(false);
  const captureRef = useRef<HTMLDivElement>(null);

  const logoUrl = session?.academy?.logoUrl ?? null;

  useEffect(() => {
    if (!canRead) return;
    let alive = true;
    listCertificateTemplates()
      .then(({ templates: list }) => {
        if (!alive) return;
        const byNumber: Record<number, CertificateTemplate> = {};
        const initial: Record<number, CertificateContent> = {};
        for (const tpl of list) {
          byNumber[tpl.templateNumber] = tpl;
          initial[tpl.templateNumber] = tpl.content;
        }
        setTemplates(byNumber);
        setDrafts(initial);
        // An API that predates a design simply doesn't list it; open one that exists.
        setActive((current) => (byNumber[current] ? current : (list[0]?.templateNumber ?? current)));
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [canRead]);

  useEffect(() => {
    let alive = true;
    void inlineImage(logoUrl).then((d) => alive && setLogoDataUrl(d));
    return () => {
      alive = false;
    };
  }, [logoUrl]);

  const design = designByNumber(active);
  const template = templates?.[active] ?? null;
  const draft = drafts[active] ?? null;
  const designName = t(`designs.${design.key}.name`);

  const status = useMemo(() => {
    const out: Record<number, DesignStatus> = {};
    for (const [n, tpl] of Object.entries(templates ?? {})) {
      const d = drafts[Number(n)];
      out[Number(n)] = d && !sameContent(d, tpl.content) ? "unsaved" : tpl.customized ? "customized" : "default";
    }
    return out;
  }, [templates, drafts]);

  const dirty = status[active] === "unsaved";
  const customizedCount = Object.values(templates ?? {}).filter((tpl) => tpl.customized).length;

  const dateLabel = useMemo(() => {
    const d = new Date(`${recipient.date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return recipient.date;
    return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);
  }, [recipient.date, lang]);

  const names = useMemo(() => bulkNames(recipient), [recipient]);
  const isBulk = recipient.mode === "bulk";

  const nameAt = (i: number) => (isBulk ? (names[i] ?? "") : recipient.name);
  const serialLabelAt = (i: number) => {
    const serial = serialAt(recipient.serial, isBulk ? i : 0);
    return serial ? `${CERT_COPY[lang].number} ${serial}` : undefined;
  };

  const setField = useCallback(
    (key: keyof CertificateContent, value: string | boolean) => {
      setDrafts((prev) => {
        const current = prev[active];
        return current ? { ...prev, [active]: { ...current, [key]: value } } : prev;
      });
      setJustSaved(false);
    },
    [active],
  );

  const restoreWording = useCallback(() => {
    const defaults = templates?.[active]?.defaults;
    if (!defaults) return;
    setDrafts((prev) => {
      const current = prev[active];
      if (!current) return prev;
      const next = { ...current };
      for (const k of WORDING_KEYS) next[k] = defaults[k];
      return { ...prev, [active]: next };
    });
    setJustSaved(false);
  }, [active, templates]);

  const selectDesign = useCallback((n: number) => {
    setActive(n);
    setJustSaved(false);
    setActionError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    const number = active;
    const sent = draft;
    setSaving(true);
    setActionError(null);
    try {
      const { content } = await saveCertificateTemplate(number, sent);
      // The API merges what was sent over what it held, so the stored template is exactly `sent`
      // (plus anything it kept). Typing that happened during the request stays unsaved.
      setTemplates((prev) => {
        const tpl = prev?.[number];
        return prev && tpl ? { ...prev, [number]: { ...tpl, content: { ...tpl.content, ...content, ...sent }, customized: true } } : prev;
      });
      setJustSaved(true);
    } catch {
      setActionError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }, [active, draft, t]);

  const downloadOne = useCallback(
    async (kind: "png" | "pdf") => {
      const node = captureRef.current;
      if (!node || !draft) return;
      setBusy(kind);
      setActionError(null);
      try {
        await settleForCapture();
        const canvas = await captureCertificate(node);
        const base = safeFileName(recipient.name || t("fileDefault"), designName);
        if (kind === "png") {
          saveBlob(await canvasToBlob(canvas), `${base}.png`);
        } else {
          const pdf = await createCertificatePdf();
          pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, CERT_WIDTH, CERT_HEIGHT);
          saveBlob(pdf.output("blob"), `${base}.pdf`);
        }
      } catch {
        setActionError(t("downloadError"));
      } finally {
        setBusy(null);
      }
    },
    [draft, recipient.name, designName, t],
  );

  const downloadBatch = useCallback(async () => {
    const node = captureRef.current;
    if (!node || !draft || names.length === 0) return;
    cancelRef.current = false;
    setBusy("bulk");
    setActionError(null);
    setProgress({ done: 0, total: names.length });
    try {
      const pdf = await createCertificatePdf();
      for (let i = 0; i < names.length; i++) {
        if (cancelRef.current) return;
        // Commit this recipient into the capture node before photographing it.
        flushSync(() => setCaptureIndex(i));
        await settleForCapture();
        const canvas = await captureCertificate(node);
        if (i > 0) pdf.addPage([CERT_WIDTH, CERT_HEIGHT], "landscape");
        // JPEG: a class of thirty as lossless PNG pages is a download nobody can send on WhatsApp.
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, CERT_WIDTH, CERT_HEIGHT);
        setProgress({ done: i + 1, total: names.length });
      }
      saveBlob(pdf.output("blob"), `${safeFileName(t("bulkFileName"), recipient.courseTitle, recipient.date)}.pdf`);
    } catch {
      setActionError(t("downloadError"));
    } finally {
      setBusy(null);
      setProgress(null);
      setCaptureIndex(0);
    }
  }, [draft, names, recipient.courseTitle, recipient.date, t]);

  if (!canRead) {
    return (
      <div className="bg-card mx-auto mt-10 max-w-md rounded-2xl border p-8 text-center shadow-sm">
        <span className="bg-muted text-muted-foreground mx-auto flex size-12 items-center justify-center rounded-2xl">
          <Lock className="size-5" aria-hidden />
        </span>
        <p className="text-foreground mt-4 text-sm font-medium">{t("noAccess")}</p>
      </div>
    );
  }

  const certificateProps = draft && {
    templateNumber: active,
    content: draft,
    dateLabel,
    lang,
    courseTitle: recipient.courseTitle.trim() || undefined,
    logoDataUrl,
  };

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="certificates-hero-lattice"
        icon={Award}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          templates && (
            <>
              <HeroPill>
                <LayoutTemplate className="size-3.5" aria-hidden />
                {t("designsCount", { count: Object.keys(templates).length })}
              </HeroPill>
              {customizedCount > 0 && (
                <HeroPill>
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  {t("customizedCount", { count: customizedCount })}
                </HeroPill>
              )}
            </>
          )
        }
      />

      {loadError && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-4 py-3 text-sm">
          {t("loadError")}
        </div>
      )}

      {!templates && !loadError && <LoadingSkeleton />}

      {templates && draft && certificateProps && (
        <>
          <DesignGallery
            active={active}
            onSelect={selectDesign}
            drafts={drafts}
            status={status}
            lang={lang}
            logoDataUrl={logoDataUrl}
            dateLabel={dateLabel}
          />

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            {/* ── Editor ── */}
            <section className="bg-card order-2 min-w-0 overflow-hidden rounded-2xl border shadow-sm lg:order-none">
              <header className="flex items-start justify-between gap-3 border-b px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">{t("editingLabel")}</p>
                  <h2 className="text-foreground truncate text-base font-semibold">{designName}</h2>
                  <p className="text-muted-foreground truncate text-xs">{t(`designs.${design.key}.hint`)}</p>
                </div>
                <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
                  {t(`category_${design.category}`)}
                </span>
              </header>

              <div role="tablist" aria-label={t("editorTabs")} className="flex gap-1 border-b px-2 pt-2">
                {TABS.map(({ key, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`cert-tab-${key}`}
                    aria-selected={tab === key}
                    aria-controls={`cert-panel-${key}`}
                    onClick={() => setTab(key)}
                    className={cn(
                      "relative -mb-px inline-flex flex-1 items-center justify-center gap-1.5 rounded-t-lg border-b-2 px-2 py-2.5 text-sm font-medium transition-colors",
                      tab === key
                        ? "border-primary text-primary"
                        : "text-muted-foreground hover:text-foreground border-transparent",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {t(`tab_${key}`)}
                  </button>
                ))}
              </div>

              <div role="tabpanel" id={`cert-panel-${tab}`} aria-labelledby={`cert-tab-${tab}`} className="p-4">
                {tab === "recipient" && (
                  <RecipientPanel
                    state={recipient}
                    onChange={(patch) => setRecipient((prev) => ({ ...prev, ...patch }))}
                    canSearchStudents={canSearchStudents}
                  />
                )}
                {tab === "wording" && (
                  <WordingPanel
                    content={draft}
                    defaults={template?.defaults ?? null}
                    onField={setField}
                    onRestore={restoreWording}
                    lang={lang}
                    onLang={setLang}
                    disabled={!canManage}
                  />
                )}
                {tab === "branding" && (
                  <BrandingPanel
                    key={active}
                    content={draft}
                    defaults={template?.defaults ?? null}
                    onField={setField}
                    lang={lang}
                    onLang={setLang}
                    disabled={!canManage}
                    ground={design.ground}
                    hasLogo={Boolean(logoDataUrl)}
                  />
                )}
              </div>

              <footer className="bg-muted/30 flex items-center justify-between gap-3 border-t px-4 py-3">
                <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs" data-testid="save-status">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      !canManage ? "bg-muted-foreground/40" : dirty ? "bg-amber-500" : template?.customized ? "bg-primary" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="truncate">
                    {!canManage
                      ? t("readOnlyHint")
                      : dirty
                        ? t("saveHintDirty")
                        : template?.customized
                          ? t("saveHintSaved")
                          : t("saveHintDefault")}
                  </span>
                </span>
                {canManage && (
                  <Button type="button" onClick={() => void handleSave()} disabled={saving || !dirty} data-testid="cert-save">
                    {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                    {saving ? t("saving") : justSaved && !dirty ? t("saved") : t("save")}
                  </Button>
                )}
              </footer>
            </section>

            {/* ── Preview ── */}
            <section className="order-1 min-w-0 space-y-3 lg:sticky lg:top-4 lg:order-none">
              <div className="bg-card flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border px-3 py-2.5 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground hidden text-xs font-medium sm:inline">{t("language")}</span>
                  <Segmented
                    testId="cert-lang"
                    value={lang}
                    onChange={setLang}
                    options={[
                      { value: "en", label: t("langEn") },
                      { value: "ar", label: t("langAr") },
                    ]}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
                  {!isBulk ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        onClick={() => void downloadOne("png")}
                        disabled={busy !== null}
                        data-testid="cert-download-png"
                        className="max-sm:flex-1"
                      >
                        {busy === "png" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImageDown className="size-4" aria-hidden />}
                        {t("downloadPng")}
                      </Button>
                      <Button
                        type="button"
                        size="lg"
                        onClick={() => void downloadOne("pdf")}
                        disabled={busy !== null}
                        data-testid="cert-download"
                        className="max-sm:flex-1"
                      >
                        {busy === "pdf" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
                        {t("download")}
                      </Button>
                    </>
                  ) : progress ? (
                    <div className="flex min-w-0 items-center gap-3 max-sm:w-full" data-testid="bulk-progress">
                      <div className="min-w-[9rem] flex-1">
                        <div className="text-foreground mb-1 text-xs font-medium tabular-nums">
                          {t("bulkProgress", { done: progress.done, total: progress.total })}
                        </div>
                        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                          <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                        </div>
                      </div>
                      <Button type="button" variant="ghost" size="lg" onClick={() => (cancelRef.current = true)}>
                        <X className="size-4" aria-hidden />
                        {t("cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="lg"
                      onClick={() => void downloadBatch()}
                      disabled={busy !== null || names.length === 0}
                      data-testid="cert-bulk-download"
                      className="max-sm:flex-1"
                    >
                      <Files className="size-4" aria-hidden />
                      {t("bulkDownload", { count: names.length })}
                    </Button>
                  )}
                </div>
              </div>

              {actionError && (
                <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-4 py-2 text-sm" role="alert">
                  {actionError}
                </div>
              )}

              <div className="bg-muted/40 relative overflow-hidden rounded-2xl border p-3 sm:p-6">
                <KhatamLattice
                  id="certificates-stage-lattice"
                  size={48}
                  className="text-foreground pointer-events-none absolute inset-0 h-full w-full opacity-[0.035]"
                />
                <div className="relative mx-auto max-w-[1123px]">
                  <div className="overflow-hidden rounded-md shadow-[0_28px_60px_-28px_rgba(15,23,42,0.55)] ring-1 ring-black/5">
                    <ScaledCertificate>
                      <CertificatePreview {...certificateProps} recipientName={nameAt(0)} serialLabel={serialLabelAt(0)} />
                    </ScaledCertificate>
                  </div>
                </div>
              </div>

              <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="relative flex size-2">
                    <span className="bg-primary/60 absolute inline-flex size-full animate-ping rounded-full opacity-60" />
                    <span className="bg-primary relative inline-flex size-2 rounded-full" />
                  </span>
                  {t("previewHeading")}
                  {isBulk && names.length > 1 && <span>· {t("previewBulkNote", { count: names.length })}</span>}
                </span>
                <span>{t("paperInfo")}</span>
              </div>
            </section>
          </div>

          {/* Off-screen full-size node for a crisp capture. Zero-size and overflow-hidden so the
              1123px page never widens the document — on mobile, and in RTL where it would otherwise
              push a horizontal scrollbar onto the screen. A batch re-renders it once per recipient. */}
          <div
            aria-hidden
            style={{ position: "fixed", top: 0, left: 0, width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}
          >
            <div ref={captureRef} style={{ width: CERT_WIDTH, height: CERT_HEIGHT }}>
              <CertificatePreview
                {...certificateProps}
                recipientName={nameAt(captureIndex)}
                serialLabel={serialLabelAt(captureIndex)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="bg-card rounded-2xl border p-4 shadow-sm">
        <div className="bg-muted mb-4 h-4 w-40 animate-pulse rounded" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="bg-muted aspect-[1123/794] w-56 shrink-0 animate-pulse rounded-xl" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="bg-muted h-96 animate-pulse rounded-2xl" />
        <div className="bg-muted aspect-[1123/794] animate-pulse rounded-2xl" />
      </div>
    </div>
  );
}
