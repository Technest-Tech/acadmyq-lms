"use client";

import {
  ArrowLeft,
  Award,
  CalendarDays,
  Download,
  Fingerprint,
  Loader2,
  LockKeyhole,
  Printer,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CertificatePreview,
  CERT_HEIGHT,
  CERT_WIDTH,
  type CertLang,
} from "@/components/certificates/certificate-designs";
import { useLearn } from "@/components/learn/context";
import { Container } from "@/components/learn/sections";
import type { CertificateContent } from "@/lib/api";
import {
  learnCertificate,
  LearnApiError,
  type LearnCertificate,
} from "@/lib/learn-api";
import { normalizeColor } from "@/components/learn/theme";

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 0; }
  html, body { width: ${CERT_WIDTH}px; height: ${CERT_HEIGHT}px; background: white !important; }
  .learn-site header,
  .learn-site footer,
  .certificate-page-actions,
  .certificate-page-meta,
  .certificate-backdrop,
  .certificate-alert { display: none !important; }
  .certificate-page { padding: 0 !important; background: white !important; }
  .certificate-print-shell { width: ${CERT_WIDTH}px !important; max-width: none !important; padding: 0 !important; margin: 0 !important; }
  .certificate-stage { padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; }
  .certificate-scale-frame { width: ${CERT_WIDTH}px !important; height: ${CERT_HEIGHT}px !important; overflow: visible !important; border: 0 !important; border-radius: 0 !important; }
  .certificate-scale-inner { transform: none !important; }
}
`;

/**
 * Premium, printable course-completion credential. The visible document and generated PDF use the
 * same fixed A4 landscape renderer, so the learner downloads exactly what they see.
 */
export default function CertificatePage() {
  const t = useTranslations("learn.certificate");
  const locale = useLocale();
  const lang: CertLang = locale === "ar" ? "ar" : "en";
  const { academy, site, siteName, requireAuth } = useLearn();
  const slug = useParams<{ slug: string }>().slug;

  const [cert, setCert] = useState<LearnCertificate | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "auth" | "missing" | "error"
  >("loading");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setState("loading");
    learnCertificate(academy, slug)
      .then((certificate) => {
        setCert(certificate);
        setState("ready");
      })
      .catch((error) => {
        if (error instanceof LearnApiError && error.status === 401)
          setState("auth");
        else if (error instanceof LearnApiError && error.status === 404)
          setState("missing");
        else setState("error");
      });
  }, [academy, slug]);

  useEffect(() => {
    load();
  }, [load]);

  const dateLabel = useMemo(() => {
    if (!cert?.issued_at) return "—";
    const date = new Date(cert.issued_at);
    if (Number.isNaN(date.getTime())) return cert.issued_at;
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }, [cert?.issued_at, locale]);

  const content = useMemo<CertificateContent | null>(() => {
    if (!cert) return null;
    return {
      academyNameEn: siteName,
      academyNameAr: siteName,
      titleEn: "Certificate of Completion",
      titleAr: "شهادة إتمام",
      presentationEn: "This verified credential is proudly awarded to",
      presentationAr: "تُمنح هذه الشهادة الموثّقة بكل فخر إلى",
      bodyEn: `In recognition of successfully completing “${cert.course_title}” and demonstrating exceptional commitment to learning.`,
      bodyAr: `تقديرًا لإتمام دورة «${cert.course_title}» بنجاح وإظهار التزام متميّز بالتعلّم.`,
      signatoryNameEn: siteName,
      signatoryNameAr: siteName,
      signatoryTitleEn: "Academic Administration",
      signatoryTitleAr: "الإدارة الأكاديمية",
      accentColor: normalizeColor(site.brand.color),
    };
  }, [cert, site.brand.color, siteName]);

  const handleDownload = useCallback(async () => {
    const node = captureRef.current;
    if (!node || !cert) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      // The certificate uses the tenant font. Waiting for it prevents a capture from starting while
      // the browser is still swapping the fallback font, which can make canvas export fail on Safari.
      await document.fonts?.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      const [{ jsPDF }, html2canvasModule] = await Promise.all([
        import("jspdf"),
        import("html2canvas-pro"),
      ]);
      const canvas = await html2canvasModule.default(node, {
        scale: 2,
        width: CERT_WIDTH,
        height: CERT_HEIGHT,
        windowWidth: CERT_WIDTH,
        windowHeight: CERT_HEIGHT,
        backgroundColor: "#FBF7EC",
        useCORS: true,
        logging: false,
      });
      const image = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "px",
        format: [CERT_WIDTH, CERT_HEIGHT],
      });
      pdf.addImage(image, "PNG", 0, 0, CERT_WIDTH, CERT_HEIGHT);
      const safeName = `${cert.learner_name}-${cert.course_title}-certificate`
        .replace(/[^\p{L}\p{N}_-]+/gu, "_")
        .slice(0, 120);
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeName}.pdf`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      console.error("Certificate PDF export failed", error);
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }, [cert]);

  if (state === "loading") return <CertificateLoading />;

  if (state === "auth") {
    return (
      <CertificateState
        icon={<LockKeyhole className="size-7" aria-hidden />}
        eyebrow={t("privateCredential")}
        title={t("signInNeeded")}
        body={t("signInHint")}
        action={
          <button
            type="button"
            onClick={() => requireAuth(load)}
            className="bg-primary text-primary-foreground inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-bold shadow-md transition-all hover:-translate-y-px hover:opacity-95"
          >
            {t("signIn")}
          </button>
        }
      />
    );
  }

  if (state === "missing") {
    return (
      <CertificateState
        icon={<Award className="size-7" aria-hidden />}
        eyebrow={t("achievementInProgress")}
        title={t("notEarned")}
        body={t("notEarnedHint")}
        action={
          <Link
            href={`/learn/${academy}/watch/${slug}`}
            className="bg-primary text-primary-foreground inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold shadow-md transition-all hover:-translate-y-px hover:opacity-95"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
            {t("keepLearning")}
          </Link>
        }
      />
    );
  }

  if (state === "error" || !cert || !content) {
    return (
      <CertificateState
        icon={<Award className="size-7" aria-hidden />}
        eyebrow={t("credential")}
        title={t("failed")}
        body={t("failedHint")}
      />
    );
  }

  const serialLabel = `${t("serial")}: ${cert.serial}`;

  return (
    <section className="certificate-page relative isolate overflow-hidden py-10 sm:py-14">
      <style>{PRINT_CSS}</style>
      <div className="certificate-backdrop pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-[var(--brand-soft)] to-transparent" />
        <div className="absolute -top-32 -end-24 size-96 rounded-full bg-[var(--brand-soft)] blur-3xl" />
        <div className="absolute top-40 -start-28 size-80 rounded-full bg-amber-100/60 blur-3xl" />
      </div>

      <Container className="certificate-print-shell">
        <div className="certificate-page-actions mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <span className="text-primary inline-flex items-center gap-2 rounded-full bg-[var(--brand-soft)] px-3 py-1.5 text-xs font-bold tracking-wide uppercase">
              <ShieldCheck className="size-4" aria-hidden />
              {t("verified")}
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
              {t("pageTitle")}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed sm:text-base">
              {t("pageSubtitle")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="border-input bg-card hover:border-primary/40 hover:text-primary inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold shadow-sm transition-colors"
            >
              <Printer className="size-4" aria-hidden />
              {t("print")}
            </button>
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="bg-primary text-primary-foreground inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-bold shadow-md transition-all hover:-translate-y-px hover:opacity-95 disabled:pointer-events-none disabled:opacity-60"
            >
              {downloading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              {downloading ? t("downloading") : t("download")}
            </button>
          </div>
        </div>

        {downloadError && (
          <div className="certificate-alert border-destructive/30 bg-destructive/5 text-destructive mb-5 rounded-xl border px-4 py-3 text-sm">
            {t("downloadFailed")}
          </div>
        )}

        <div className="certificate-stage rounded-[2rem] border border-white/10 bg-slate-950 p-2.5 shadow-[0_35px_90px_-38px_rgba(15,23,42,0.65)] sm:p-4">
          <ScaledCertificate>
            <CertificatePreview
              templateNumber={2}
              content={content}
              recipientName={cert.learner_name}
              dateLabel={dateLabel}
              lang={lang}
              courseTitle={cert.course_title}
              serialLabel={serialLabel}
            />
          </ScaledCertificate>
        </div>

        <div className="certificate-page-meta mt-5 grid gap-3 sm:grid-cols-3">
          <CredentialFact
            icon={<ShieldCheck className="size-5" aria-hidden />}
            label={t("status")}
            value={t("verifiedCredential")}
          />
          <CredentialFact
            icon={<CalendarDays className="size-5" aria-hidden />}
            label={t("issued")}
            value={dateLabel}
          />
          <CredentialFact
            icon={<Fingerprint className="size-5" aria-hidden />}
            label={t("credentialId")}
            value={cert.serial}
            mono
          />
        </div>
      </Container>

      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: -(CERT_WIDTH + 64),
          width: CERT_WIDTH,
          height: CERT_HEIGHT,
          pointerEvents: "none",
          background: "#FBF7EC",
        }}
      >
        <div
          ref={captureRef}
          style={{ width: CERT_WIDTH, height: CERT_HEIGHT }}
        >
          <CertificatePreview
            templateNumber={2}
            content={content}
            recipientName={cert.learner_name}
            dateLabel={dateLabel}
            lang={lang}
            courseTitle={cert.course_title}
            serialLabel={serialLabel}
          />
        </div>
      </div>
    </section>
  );
}

function CertificateLoading() {
  return (
    <Container className="py-12 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="bg-muted mb-6 h-8 w-64 animate-pulse rounded-xl" />
        <div className="bg-muted aspect-[1123/794] animate-pulse rounded-[2rem]" />
      </div>
    </Container>
  );
}

function CertificateState({
  icon,
  eyebrow,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden py-16 sm:py-24">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(160deg, var(--brand-soft), transparent 64%)",
        }}
      />
      <Container>
        <div className="bg-card mx-auto max-w-lg rounded-3xl border p-7 text-center shadow-[0_24px_70px_-40px_rgba(15,23,42,0.55)] sm:p-10">
          <span className="text-primary mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)]">
            {icon}
          </span>
          <p className="text-primary mt-5 text-xs font-bold tracking-wider uppercase">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
            {title}
          </h1>
          <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-sm leading-relaxed">
            {body}
          </p>
          {action && <div className="mt-6">{action}</div>}
        </div>
      </Container>
    </section>
  );
}

function CredentialFact({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-card flex min-w-0 items-center gap-3 rounded-2xl border p-4 shadow-sm">
      <span className="text-primary flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="text-muted-foreground block text-[11px] font-semibold tracking-wide uppercase">
          {label}
        </span>
        <span
          className={
            mono
              ? "block truncate font-mono text-xs font-bold"
              : "block truncate text-sm font-bold"
          }
        >
          {value}
        </span>
      </span>
    </div>
  );
}

function ScaledCertificate({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const update = () =>
      setScale(Math.min(1, (element.clientWidth || CERT_WIDTH) / CERT_WIDTH));
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      dir="ltr"
      className="certificate-scale-frame overflow-hidden rounded-[1.35rem] bg-white"
      style={{ height: CERT_HEIGHT * scale }}
    >
      <div
        className="certificate-scale-inner"
        style={{
          width: CERT_WIDTH,
          height: CERT_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
