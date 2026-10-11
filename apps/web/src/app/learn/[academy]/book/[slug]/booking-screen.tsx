"use client";

import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { fieldClass, submitClass } from "@/components/learn/auth-forms";
import { useLearn } from "@/components/learn/context";
import { Container, CtaButton, PageHero } from "@/components/learn/sections";
import { whatsappHref } from "@/components/learn/site-chrome";
import { LearnApiError, learnSubmitBooking, type LearnBookingForm } from "@/lib/learn-api";
import { cn } from "@/lib/utils";

/**
 * The visitor's half of a booking form (docs/lms/13). Name and phone, then only what this client's
 * form asks — a course, a date, their choice list, a note. No account needed: a signed-in learner
 * gets their details filled in, an anonymous one just types them.
 *
 * Errors are translated by FIELD, never shown as the API's English sentence: the page is the
 * client's, in the visitor's language.
 */

type Errors = Partial<
  Record<
    | "full_name"
    | "phone"
    | "email"
    | "course_id"
    | "choice"
    | "preferred_date"
    | "preferred_time"
    | "message"
    | "form",
    string
  >
>;

export function BookingScreen({
  form,
  courses,
}: {
  form: LearnBookingForm;
  courses: { id: string; title: string; slug: string }[];
}) {
  const t = useTranslations("learn.booking");
  const { academy, site, siteName, learner } = useLearn();
  const uid = useId();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [courseId, setCourseId] = useState("");
  const [choice, setChoice] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [done, setDone] = useState(false);

  // A signed-in learner never retypes what the site already knows — but never overwrite typing.
  useEffect(() => {
    if (!learner) return;
    setFullName((v) => v || learner.full_name);
    setPhone((v) => v || (learner.phone ?? ""));
    setEmail((v) => v || learner.email);
  }, [learner]);

  // "Book this course" on a course page links here with ?course=<slug>. Read off the location
  // rather than useSearchParams, so the page needs no Suspense boundary (same as the player).
  useEffect(() => {
    if (!form.ask_course) return;
    const wanted = new URLSearchParams(window.location.search).get("course");
    const match = wanted ? courses.find((c) => c.slug === wanted) : undefined;
    if (match) setCourseId(match.id);
  }, [form.ask_course, courses]);

  const today = localToday();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Errors = {};
    if (fullName.trim().length < 2) local.full_name = t("errors.name");
    if (phone.replace(/\D/g, "").length < 6) local.phone = t("errors.phone");
    if (form.choices.length > 0 && !choice) local.choice = t("errors.choice");
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      await learnSubmitBooking(academy, form.slug, {
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: form.ask_email ? email.trim() || null : null,
        course_id: form.ask_course ? courseId || null : null,
        choice: form.choices.length > 0 ? choice : null,
        preferred_date: form.ask_date ? date || null : null,
        preferred_time: form.ask_date ? time || null : null,
        message: form.ask_message ? message.trim() || null : null,
        website: honeypot,
      });
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setErrors(mapErrors(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <PageHero title={form.title} />
        <Container className="py-12 sm:py-16">
          <div className="bg-card mx-auto max-w-xl rounded-3xl border p-8 text-center shadow-sm sm:p-10">
            <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="size-7" aria-hidden />
            </span>
            <h2 className="text-2xl font-bold tracking-tight">{t("successTitle")}</h2>
            <p
              className="text-muted-foreground mx-auto mt-2 max-w-md leading-relaxed whitespace-pre-line"
              dir="auto"
            >
              {form.success_message || t("successBody")}
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <CtaButton href={`/learn/${academy}`}>{t("backHome")}</CtaButton>
              <CtaButton
                variant="outline"
                onClick={() => {
                  setDone(false);
                  setMessage("");
                  setDate("");
                  setTime("");
                }}
              >
                {t("another")}
              </CtaButton>
            </div>
          </div>
        </Container>
      </>
    );
  }

  const whatsapp = site.contact.whatsapp
    ? whatsappHref(
        site.contact.whatsapp,
        t("whatsappPrefill", { form: form.title, name: siteName }),
      )
    : null;

  return (
    <>
      <PageHero title={form.title} subtitle={form.description || t("defaultIntro")} />

      <Container className="py-10 sm:py-14">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
          <form
            onSubmit={(e) => void submit(e)}
            noValidate
            className="bg-card space-y-5 rounded-3xl border p-5 shadow-sm sm:p-8"
          >
            {/* The honeypot: off-screen, unlabelled for people, irresistible to form-stuffing bots. */}
            <div aria-hidden className="absolute -start-[9999px] h-px w-px overflow-hidden">
              <label>
                Website
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <BookingField id={`${uid}-name`} label={t("name")} error={errors.full_name}>
                <input
                  id={`${uid}-name`}
                  className={cn(fieldClass, errors.full_name && "border-destructive")}
                  value={fullName}
                  dir="auto"
                  autoComplete="name"
                  maxLength={120}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </BookingField>
              <BookingField
                id={`${uid}-phone`}
                label={t("phone")}
                hint={t("phoneHint")}
                error={errors.phone}
              >
                <input
                  id={`${uid}-phone`}
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  className={cn(fieldClass, "text-start", errors.phone && "border-destructive")}
                  value={phone}
                  autoComplete="tel"
                  maxLength={32}
                  placeholder={t("phonePlaceholder")}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </BookingField>
            </div>

            {form.ask_email && (
              <BookingField
                id={`${uid}-email`}
                label={t("email")}
                optional={t("optional")}
                error={errors.email}
              >
                <input
                  id={`${uid}-email`}
                  type="email"
                  dir="ltr"
                  className={cn(fieldClass, "text-start", errors.email && "border-destructive")}
                  value={email}
                  autoComplete="email"
                  maxLength={255}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </BookingField>
            )}

            {form.ask_course && courses.length > 0 && (
              <BookingField id={`${uid}-course`} label={t("course")} error={errors.course_id}>
                <select
                  id={`${uid}-course`}
                  className={cn(fieldClass, "pe-8", errors.course_id && "border-destructive")}
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                >
                  <option value="">{t("courseUnsure")}</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </BookingField>
            )}

            {form.choices.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium" dir="auto">
                  {form.choice_label || t("choice")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {form.choices.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={choice === c}
                      onClick={() => setChoice(c)}
                      dir="auto"
                      className={cn(
                        "rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                        choice === c
                          ? "border-primary text-primary bg-[var(--brand-soft)]"
                          : "hover:border-primary/40",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {errors.choice && <p className="text-destructive text-xs">{errors.choice}</p>}
              </fieldset>
            )}

            {form.ask_date && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <BookingField
                  id={`${uid}-date`}
                  label={t("date")}
                  optional={t("optional")}
                  error={errors.preferred_date}
                >
                  <input
                    id={`${uid}-date`}
                    type="date"
                    min={today}
                    className={cn(fieldClass, errors.preferred_date && "border-destructive")}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </BookingField>
                <BookingField
                  id={`${uid}-time`}
                  label={t("time")}
                  optional={t("optional")}
                  error={errors.preferred_time}
                >
                  <input
                    id={`${uid}-time`}
                    type="time"
                    step={900}
                    className={cn(fieldClass, errors.preferred_time && "border-destructive")}
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </BookingField>
              </div>
            )}

            {form.ask_message && (
              <BookingField
                id={`${uid}-message`}
                label={t("message")}
                optional={t("optional")}
                error={errors.message}
              >
                <textarea
                  id={`${uid}-message`}
                  rows={4}
                  dir="auto"
                  maxLength={2000}
                  className={cn(fieldClass, "h-auto py-2.5 leading-relaxed")}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </BookingField>
            )}

            {errors.form && (
              <p
                role="alert"
                className="bg-destructive/8 text-destructive rounded-xl px-4 py-3 text-sm"
              >
                {errors.form}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className={cn(submitClass, "h-12 sm:w-auto sm:min-w-56")}
            >
              {busy ? t("sending") : form.submit_label || t("submit")}
              {!busy && <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />}
            </button>

            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden />
              {t("privacy")}
            </p>
          </form>

          <aside className="space-y-4">
            <div className="bg-muted/40 rounded-3xl border p-6">
              <h2 className="font-bold">{t("next.title")}</h2>
              <ol className="mt-4 space-y-4">
                {[
                  { Icon: CalendarCheck2, text: t("next.one") },
                  { Icon: Clock, text: t("next.two") },
                  { Icon: CheckCircle2, text: t("next.three") },
                ].map(({ Icon, text }, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="text-primary flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)]">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="text-muted-foreground pt-1.5 leading-relaxed">{text}</span>
                  </li>
                ))}
              </ol>
            </div>
            {whatsapp && (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-card hover:border-primary/40 flex items-center gap-3 rounded-3xl border p-5 text-sm font-semibold transition-colors"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <MessageCircle className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  {t("whatsappTitle")}
                  <span className="text-muted-foreground block text-xs font-normal">
                    {t("whatsappHint")}
                  </span>
                </span>
              </a>
            )}
          </aside>
        </div>
      </Container>
    </>
  );
}

function BookingField({
  id,
  label,
  hint,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  optional?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-sm font-medium">
        {label}
        {optional && <span className="text-muted-foreground text-xs font-normal">{optional}</span>}
      </label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : (
        hint && <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  );
}

/** Today as YYYY-MM-DD in the VISITOR's own zone — what the date picker's `min` must mean. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The API's verdict, in the visitor's language: per field for a 422, a sentence otherwise. */
function mapErrors(err: unknown, t: ReturnType<typeof useTranslations>): Errors {
  if (err instanceof LearnApiError) {
    if (err.status === 429) return { form: t("errors.rate") };
    if (err.status === 404) return { form: t("errors.gone") };
    if (err.status === 422) {
      const fields = (err.body as { errors?: Record<string, unknown> } | undefined)?.errors ?? {};
      const out: Errors = {};
      if ("full_name" in fields) out.full_name = t("errors.name");
      if ("phone" in fields) out.phone = t("errors.phone");
      if ("email" in fields) out.email = t("errors.email");
      if ("course_id" in fields) out.course_id = t("errors.course");
      if ("choice" in fields) out.choice = t("errors.choice");
      if ("preferred_date" in fields) out.preferred_date = t("errors.date");
      if ("preferred_time" in fields) out.preferred_time = t("errors.time");
      if ("message" in fields) out.message = t("errors.message");
      return Object.keys(out).length > 0 ? out : { form: t("errors.generic") };
    }
  }
  return { form: t("errors.generic") };
}
