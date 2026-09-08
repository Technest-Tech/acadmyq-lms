"use client";

import { Download, ImageDown, Loader2 } from "lucide-react";
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
  type CardLang,
  REPORT_CARD_WIDTH,
  ReportCard,
  type ReportCardRating,
  type ReportCardSection,
} from "@/components/reports/report-card-design";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  getReportCardTemplate,
  type ReportCardContent,
  type ReportField,
  type SessionDetailResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The report card's own copy, kept OUT of next-intl on purpose.
 *
 * The card's language is the guardian's, not the operator's: an Arabic-speaking admin routinely
 * sends an English card, and a `t()` here would silently paint half of it in the panel's locale.
 * These are the only strings the design owns — every other word comes from the academy's saved
 * template or from its own bilingual field labels.
 */
const CARD_COPY = {
  ar: {
    student: "الطالب",
    date: "التاريخ",
    lesson: "الحلقة",
    lessonInMonth: "الحلقة هذا الشهر",
    lessonInPackage: "الحلقة في الباقة",
    duration: "المدة",
    attendance: "الحضور",
    teacher: "المعلم",
    journey: "تفاصيل الحلقة",
    ratings: "تقييم البطل",
    message: "رسالتنا لبطلنا",
    dua: "دعاء",
    trial: "تجريبية",
    minutes: "دقيقة",
    status: {
      ATTENDED: "حاضر",
      FREE: "حاضر",
      SCHEDULED: "مجدولة",
      ABSENT_UNEXCUSED: "غائب",
      ABSENT_EXCUSED: "غائب بعذر",
      CANCELLED_BY_TEACHER: "ملغاة",
      CANCELLED_BY_STUDENT: "ملغاة",
      RESCHEDULED: "مؤجلة",
    } as Record<string, string>,
  },
  en: {
    student: "Student",
    date: "Date",
    lesson: "Lesson",
    lessonInMonth: "Lesson this month",
    lessonInPackage: "Lesson in package",
    duration: "Duration",
    attendance: "Attendance",
    teacher: "Teacher",
    journey: "Lesson details",
    ratings: "Champion's ratings",
    message: "A word to our champion",
    dua: "Du'a",
    trial: "Trial",
    minutes: "min",
    status: {
      ATTENDED: "Present",
      FREE: "Present",
      SCHEDULED: "Scheduled",
      ABSENT_UNEXCUSED: "Absent",
      ABSENT_EXCUSED: "Excused",
      CANCELLED_BY_TEACHER: "Cancelled",
      CANCELLED_BY_STUDENT: "Cancelled",
      RESCHEDULED: "Rescheduled",
    } as Record<string, string>,
  },
} as const;

/** UI chrome around the card — this DOES follow the operator's locale. */
const UI_COPY = {
  ar: {
    title: "بطاقة التقرير",
    description: "صورة جاهزة للإرسال لولي الأمر",
    language: "لغة البطاقة",
    langAr: "العربية",
    langEn: "English",
    download: "تحميل الصورة",
    downloading: "جارٍ التجهيز…",
    loadError: "تعذّر تحميل قالب البطاقة.",
    downloadError: "تعذّر إنشاء الصورة. حاول مرة أخرى.",
    hint: "حرِّر نص البطاقة من الإعدادات ← بطاقة التقرير.",
  },
  en: {
    title: "Report card",
    description: "A ready-to-send image for the guardian",
    language: "Card language",
    langAr: "العربية",
    langEn: "English",
    download: "Download image",
    downloading: "Preparing…",
    loadError: "Couldn't load the card template.",
    downloadError: "Couldn't build the image. Please try again.",
    hint: "Edit the card's wording in Settings → Report card.",
  },
} as const;

/** RATING fields are scored out of five unless the academy defined its own scale in `options`. */
function ratingMax(field: ReportField): number {
  const n = field.options?.length ?? 0;
  return n >= 2 && n <= 10 ? n : 5;
}

/** Strip anything script-capable before the HTML goes into the card (defence in depth — the
 *  editor already sanitises on write, but this string also travels through the API). */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\shref="javascript:[^"]*"/gi, "");
}

function isBlank(html: string): boolean {
  return html.replace(/<[^>]+>/g, "").trim() === "";
}

/**
 * Fetch the academy's logo and inline it as a data URI. `html2canvas` taints the canvas on any
 * cross-origin image, and the logo is served from the API host — so a remote `<img src>` would
 * produce a blank download rather than a visible error. A failure here is not an error state: the
 * card falls back to its woven monogram, which is never uglier than a broken image.
 */
async function inlineLogo(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function ReportCardModal({
  open,
  onClose,
  detail,
  uiLocale,
}: {
  open: boolean;
  onClose: () => void;
  /** The session the card describes — already loaded by the caller, so this never refetches it. */
  detail: SessionDetailResponse;
  uiLocale: string;
}) {
  const ui = UI_COPY[uiLocale === "ar" ? "ar" : "en"];
  const { session: auth } = useAuth();

  const [lang, setLang] = useState<CardLang>(uiLocale === "ar" ? "ar" : "en");
  const [content, setContent] = useState<ReportCardContent | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  const academyName =
    auth?.academy?.displayName?.trim() || detail.session.academy_name?.trim() || "";
  const logoUrl = auth?.academy?.logoUrl ?? null;

  // Load the academy's wording and inline its logo once the modal is actually opened — neither is
  // needed to render the session row underneath.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoadError(false);
    getReportCardTemplate()
      .then(({ content: c }) => alive && setContent(c))
      .catch(() => alive && setLoadError(true));
    void inlineLogo(logoUrl).then((d) => alive && setLogoDataUrl(d));
    return () => {
      alive = false;
    };
  }, [open, logoUrl]);

  const copy = CARD_COPY[lang];
  const { session, report } = detail;
  const values = useMemo(() => report?.values ?? {}, [report]);

  /** Every field that carries a value, in form order, with deactivated-but-filled ones after —
   *  the same "deactivate-not-delete" order the WhatsApp builder uses, so a card for an old lesson
   *  still shows the field it was written against. */
  const filled = useMemo(() => {
    const all = [...detail.reportFields, ...detail.inactiveReportFields];
    return all
      .map((f) => ({ field: f, raw: values[f.key] }))
      .filter(({ raw }) => raw !== undefined && raw !== null && String(raw).trim() !== "");
  }, [detail.reportFields, detail.inactiveReportFields, values]);

  const sections: ReportCardSection[] = useMemo(
    () =>
      filled
        .filter(({ field }) => field.field_type !== "RATING")
        .map(({ field, raw }) => ({
          label: lang === "ar" ? field.label_ar : field.label_en,
          value: String(raw).trim(),
        })),
    [filled, lang],
  );

  const ratings: ReportCardRating[] = useMemo(
    () =>
      filled
        .filter(({ field }) => field.field_type === "RATING")
        .map(({ field, raw }) => ({
          label: lang === "ar" ? field.label_ar : field.label_en,
          value: Math.max(0, Math.min(ratingMax(field), Math.round(Number(raw) || 0))),
          max: ratingMax(field),
        })),
    [filled, lang],
  );

  // What teachers actually write today: free-text HTML. Shown only when the academy keeps no
  // structured fields, so a card never says the same thing twice.
  const bodyHtml = useMemo(() => {
    const raw = (values.report_text as string) ?? "";
    if (sections.length > 0 || !raw || isBlank(raw)) return null;
    return sanitize(raw);
  }, [values, sections.length]);

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(session.scheduled_at_utc)),
    [session.scheduled_at_utc, lang],
  );

  // A trial is a session wearing a flag, not a separate document — so it takes the word "trial"
  // where a numbered lesson takes its number.
  const isTrial = values.is_free_trial === true;
  const lessonLabel = isTrial
    ? copy.trial
    : session.session_number !== null
      ? String(session.session_number)
      : "—";

  // "3" is only meaningful next to "3 of what". The API counts the lesson inside the block the
  // family is billed for — their package, else the month — so the caption names that block. A
  // trial belongs to no block, and an unnumbered lesson gets the bare word.
  const lessonHeading = isTrial
    ? copy.lesson
    : session.session_number_scope === "PACKAGE"
      ? copy.lessonInPackage
      : session.session_number_scope === "MONTH"
        ? copy.lessonInMonth
        : copy.lesson;

  const captureRef = useRef<HTMLDivElement>(null);

  const handleDownload = useCallback(async () => {
    const node = captureRef.current;
    if (!node) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      const html2canvas = (await import("html2canvas-pro")).default;
      const width = REPORT_CARD_WIDTH;
      const height = Math.max(1, Math.ceil(node.scrollHeight));

      const canvas = await html2canvas(node, {
        scale: captureScale(width, height),
        backgroundColor: "#FBF8F1",
        logging: false,
        // The capture node lives inside a 0×0 overflow-hidden box (see below), so html2canvas is
        // told the card's real geometry rather than left to infer it from a clipped ancestor.
        windowWidth: width,
        width,
        height,
      });

      // toBlob, not toDataURL: a tall card's base64 string runs to tens of megabytes of JS heap
      // before a single byte is written, and Safari throws outright somewhere past that.
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("The report card could not be encoded.");

      const safe = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, "_");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `${safe(session.student_name ?? "report")}-${session.scheduled_at_utc.slice(0, 10)}.png`;
      link.href = url;
      link.click();
      // Freed on the next tick — revoking synchronously races the browser's read of the href.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }, [session.student_name, session.scheduled_at_utc]);

  const cardProps = content && {
    lang,
    content,
    academyName,
    logoDataUrl,
    studentName: session.student_name ?? "",
    teacherName: session.teacher_name ?? "",
    dateLabel,
    durationLabel: `${session.duration_minutes} ${copy.minutes}`,
    lessonLabel,
    attendanceLabel: copy.status[session.status] ?? session.status,
    sections,
    ratings,
    bodyHtml,
    labels: {
      student: copy.student,
      date: copy.date,
      lesson: lessonHeading,
      duration: copy.duration,
      attendance: copy.attendance,
      teacher: copy.teacher,
      journey: copy.journey,
      ratings: copy.ratings,
      message: copy.message,
      dua: copy.dua,
    },
  };

  return (
    <Modal open={open} onClose={onClose} title={ui.title} description={ui.description} size="xl">
      <div className="space-y-4">
        {/* ── Language + download ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">{ui.language}</span>
            <div className="flex gap-2">
              {(["ar", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  data-card-lang={l}
                  onClick={() => setLang(l)}
                  className={cn(
                    "rounded-md border px-4 py-1.5 text-sm font-medium transition-colors",
                    lang === l
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {l === "ar" ? ui.langAr : ui.langEn}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading || !content}
            data-testid="report-card-download"
          >
            {downloading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            {downloading ? ui.downloading : ui.download}
          </Button>
        </div>

        {(loadError || downloadError) && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-2 text-sm">
            {loadError ? ui.loadError : ui.downloadError}
          </div>
        )}

        {/* ── Preview ─────────────────────────────────────────────────── */}
        {cardProps ? (
          <ScaledPreview>
            <ReportCard {...cardProps} />
          </ScaledPreview>
        ) : (
          !loadError && (
            <div className="text-muted-foreground flex h-64 items-center justify-center gap-2 rounded-xl border text-sm">
              <ImageDown className="size-4 animate-pulse" aria-hidden />
            </div>
          )
        )}

        <p className="text-muted-foreground text-xs">{ui.hint}</p>
      </div>

      {/* Off-screen full-size node for a crisp capture. Zero-size and overflow-hidden so the
          1080px card never widens the document — which in RTL would otherwise push a horizontal
          scrollbar onto the page behind the modal. */}
      {cardProps && (
        <div
          aria-hidden
          style={{ position: "fixed", top: 0, left: 0, width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}
        >
          <div ref={captureRef} style={{ width: REPORT_CARD_WIDTH }}>
            <ReportCard {...cardProps} />
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * How many device pixels to render the card at.
 *
 * A browser caps a canvas by AREA, not only by side length — iOS Safari at roughly 16.7 megapixels,
 * desktop Chrome far higher but still finite — and past the cap the canvas comes back blank or
 * silently downscaled. Nothing throws. That is exactly the "a long report downloads pixelated and
 * enormous" bug: the card is a fixed 1080 wide and free-height, so a six-section lesson runs past
 * 4000px, and a flat `scale: 2` asked for 2160×8000 = 17Mpx — over the edge on the phones these
 * cards are actually opened on.
 *
 * So the multiplier is derived from the card's real height instead of hard-coded. Short cards still
 * get the crisp 2×; a long one steps down to whatever fits, and never below 1× — a card is always
 * captured at least at its own size, so text stays legible even at the extreme.
 */
const MAX_CANVAS_PIXELS = 16_000_000;

export function captureScale(width: number, height: number): number {
  const fit = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  // Floored, not rounded: squaring a scale that came out of a square root lands a hair ABOVE the
  // budget in binary floating point, and "a hair above" is the whole failure mode being fixed.
  return Math.min(2, Math.max(1, Math.floor(fit * 100) / 100));
}

/**
 * Scales the fixed-width card down to the available column. Unlike the certificate's version the
 * height is unknown up front, so the inner node is measured and the wrapper follows it — otherwise
 * a six-section card would be clipped at whatever height we guessed.
 */
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const inner = innerRef.current;
    if (!wrap || !inner) return;
    const update = () => {
      setScale(Math.min(1, (wrap.clientWidth || REPORT_CARD_WIDTH) / REPORT_CARD_WIDTH));
      setHeight(inner.scrollHeight);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    ro.observe(inner);
    return () => ro.disconnect();
  });

  return (
    // `dir="ltr"` keeps the scaling box anchored top-left on an RTL page so `transformOrigin:
    // "top left"` stays inside the frame. The card sets its own direction internally.
    <div
      ref={wrapRef}
      dir="ltr"
      className="overflow-hidden rounded-xl border shadow-sm"
      style={{ height: height * scale }}
    >
      <div
        ref={innerRef}
        style={{ width: REPORT_CARD_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}
