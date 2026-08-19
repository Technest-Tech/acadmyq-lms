"use client";

import { Check, ScrollText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type CardLang,
  REPORT_CARD_WIDTH,
  ReportCard,
} from "@/components/reports/report-card-design";
import { SectionCard } from "@/components/settings/section-card";
import { Button } from "@/components/ui/button";
import {
  getReportCardTemplate,
  type ReportCardContent,
  saveReportCardTemplate,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Settings → Report card. The academy writes the words that appear on EVERY report card once,
 * here, instead of retyping them into every lesson: the headline, the opening line, the note to
 * the child, the du'a, and the closing tagline.
 *
 * The preview beside the editor is the real card component fed sample data, so what an academy
 * approves here is literally what a guardian receives — including how their `{student}`
 * placeholders read once filled in.
 */

/** The editable pairs; `base` keys into ReportCardContent as `${base}Ar` / `${base}En`. */
const FIELDS = [
  { base: "headline", rows: 2 },
  { base: "intro", rows: 3 },
  { base: "championMessage", rows: 4 },
  { base: "dua", rows: 4 },
  { base: "tagline", rows: 2 },
] as const;

/** The same curated accents Settings → Colors offers, so an academy's card matches its panel. */
const ACCENTS = [
  "#0E7C5A",
  "#2f9e6f",
  "#0d9488",
  "#0f766e",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#b45309",
  "#9f1239",
  "#475569",
];

/** Sample lesson used only to make the preview concrete. Never saved, never sent. */
const SAMPLE = {
  ar: {
    academy: "أكاديميتك",
    student: "جاد",
    teacher: "الأستاذ محمد",
    date: "١٩ أغسطس ٢٠٢٦",
    duration: "30 دقيقة",
    lesson: "تجريبية",
    attendance: "حاضر",
    sections: [
      { label: "القرآن الكريم", value: "سورة الإخلاص" },
      { label: "التجويد وتصحيح التلاوة", value: "سورة الإخلاص مع دراسة تفسير السورة" },
      { label: "الحفظ الجديد", value: "تسميع سورة الإخلاص كاملة، وبدء حفظ سورة الفلق" },
    ],
    ratings: [
      { label: "الحفظ الجديد", value: 4, max: 5 },
      { label: "التلاوة", value: 3, max: 5 },
      { label: "التركيز والتفاعل", value: 5, max: 5 },
    ],
    labels: {
      student: "الطالب",
      date: "التاريخ",
      lesson: "الحلقة",
      duration: "المدة",
      attendance: "الحضور",
      teacher: "المعلم",
      journey: "تفاصيل الحلقة",
      ratings: "تقييم البطل",
      message: "رسالتنا لبطلنا",
      dua: "دعاء",
    },
  },
  en: {
    academy: "Your Academy",
    student: "Jad",
    teacher: "Ustadh Mohamed",
    date: "19 August 2026",
    duration: "30 min",
    lesson: "Trial",
    attendance: "Present",
    sections: [
      { label: "Qur'an", value: "Surat Al-Ikhlas" },
      { label: "Tajweed & recitation", value: "Surat Al-Ikhlas with a study of its tafsir" },
      { label: "New memorisation", value: "Recite Al-Ikhlas in full, begin memorising Al-Falaq" },
    ],
    ratings: [
      { label: "New memorisation", value: 4, max: 5 },
      { label: "Recitation", value: 3, max: 5 },
      { label: "Focus & engagement", value: 5, max: 5 },
    ],
    labels: {
      student: "Student",
      date: "Date",
      lesson: "Lesson",
      duration: "Duration",
      attendance: "Attendance",
      teacher: "Teacher",
      journey: "Lesson details",
      ratings: "Champion's ratings",
      message: "A word to our champion",
      dua: "Du'a",
    },
  },
} as const;

export function ReportCardManager() {
  const t = useTranslations("settings.reportCard");

  const [draft, setDraft] = useState<ReportCardContent | null>(null);
  const [saved, setSaved] = useState<ReportCardContent | null>(null);
  const [lang, setLang] = useState<CardLang>("ar");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    let alive = true;
    getReportCardTemplate()
      .then(({ content }) => {
        if (!alive) return;
        setDraft(content);
        setSaved(content);
      })
      .catch(() => alive && setError(t("loadError")));
    return () => {
      alive = false;
    };
  }, [t]);

  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  const setField = useCallback((key: keyof ReportCardContent, value: string) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSavedTick(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const { content } = await saveReportCardTemplate(draft);
      setDraft(content);
      setSaved(content);
      setSavedTick(true);
    } catch {
      setError(t("saveError"));
    } finally {
      setBusy(false);
    }
  }, [draft, t]);

  const sample = SAMPLE[lang];

  return (
    <SectionCard
      icon={ScrollText}
      title={t("title")}
      description={t("description")}
      iconClassName="bg-gradient-to-br from-emerald-500 to-teal-600"
      testId="report-card-manager"
    >
      <div className="space-y-5">
        {error && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-2 text-sm">
            {error}
          </div>
        )}

        {/* Which language's wording is being edited. Both are saved; the sender picks per card. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(["ar", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                data-template-lang={l}
                onClick={() => setLang(l)}
                className={cn(
                  "rounded-md border px-4 py-1.5 text-sm font-medium transition-colors",
                  lang === l
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {l === "ar" ? t("langAr") : t("langEn")}
              </button>
            ))}
          </div>

          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !dirty}
            data-testid="save-report-card"
          >
            {savedTick && !dirty ? <Check className="size-4" aria-hidden /> : null}
            {busy ? t("saving") : savedTick && !dirty ? t("savedTick") : t("save")}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          {/* ── Editor ── */}
          <div className="min-w-0 space-y-4">
            {/* Illustrated or plain. The children's version is the default; an academy teaching
                adults turns the artwork off without changing anything else about the card. */}
            <div className="space-y-2">
              <span className="text-muted-foreground text-xs font-medium">{t("style")}</span>
              <div className="flex gap-2">
                {(["joyful", "classic"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    data-card-style={v}
                    disabled={!draft}
                    onClick={() => setField("cardStyle", v)}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-start text-sm transition-colors disabled:opacity-60",
                      (draft?.cardStyle ?? "joyful") === v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <span className="block font-medium">{t(`style_${v}`)}</span>
                    <span className="mt-0.5 block text-xs opacity-80">{t(`style_${v}_hint`)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-muted-foreground text-xs font-medium">{t("accent")}</span>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((hex) => {
                  const active = draft?.accentColor?.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      aria-label={hex}
                      aria-pressed={active}
                      disabled={!draft}
                      onClick={() => setField("accentColor", hex)}
                      style={{ background: hex }}
                      className={cn(
                        "size-8 rounded-full transition-transform",
                        active
                          ? "ring-foreground ring-2 ring-offset-2 ring-offset-background"
                          : "hover:scale-110",
                      )}
                    />
                  );
                })}
              </div>
            </div>

            {FIELDS.map(({ base, rows }) => {
              const key = `${base}${lang === "ar" ? "Ar" : "En"}` as keyof ReportCardContent;
              return (
                <div key={base} className="space-y-1.5">
                  <label className="text-muted-foreground text-xs font-medium" htmlFor={`rc-${base}`}>
                    {t(`field_${base}`)}
                  </label>
                  <textarea
                    id={`rc-${base}`}
                    rows={rows}
                    dir={lang === "ar" ? "rtl" : "ltr"}
                    value={(draft?.[key] as string) ?? ""}
                    disabled={!draft}
                    onChange={(e) => setField(key, e.target.value)}
                    className="border-input bg-background focus:ring-ring w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 disabled:opacity-60"
                  />
                </div>
              );
            })}

            {/* The placeholder tokens live here, not in the message catalogue: next-intl parses
                messages as ICU, where a bare {token} is a variable to interpolate rather than
                literal text to show. */}
            <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
              {t("placeholderHint")}
              {["{academy}", "{student}", "{teacher}"].map((token) => (
                <code
                  key={token}
                  dir="ltr"
                  className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-[11px]"
                >
                  {token}
                </code>
              ))}
            </p>
          </div>

          {/* ── Live preview on sample data ── */}
          <div className="min-w-0 space-y-2">
            <span className="text-muted-foreground text-xs font-medium">{t("preview")}</span>
            {draft && (
              <ScaledPreview>
                <ReportCard
                  lang={lang}
                  content={draft}
                  academyName={sample.academy}
                  logoDataUrl={null}
                  studentName={sample.student}
                  teacherName={sample.teacher}
                  dateLabel={sample.date}
                  durationLabel={sample.duration}
                  lessonLabel={sample.lesson}
                  attendanceLabel={sample.attendance}
                  sections={[...sample.sections]}
                  ratings={[...sample.ratings]}
                  bodyHtml={null}
                  labels={{ ...sample.labels }}
                />
              </ScaledPreview>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

/** Scales the fixed-width card into the preview column, following its measured height. */
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.35);
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
