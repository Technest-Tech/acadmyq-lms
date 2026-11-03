"use client";

import { CalendarDays, Check, Clock, Languages, Lock, NotebookPen, Phone, Send, User, Users } from "lucide-react";
import { useState } from "react";
import { KhatamLattice } from "@/components/ornaments";
import { apiBase } from "@/lib/api-base";
import { COUNTRIES } from "@/lib/countries";
import type { PublicEnrolmentPayload, PublicEnrolmentSubmit } from "@/lib/enrolment-api";
import { COPY, ENROL_LANG_COOKIE, type Lang, WEEK_ORDER } from "./copy";

const CARD = "rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/[0.06]";
const INPUT =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15";

/** "Other" in the subject list — the typed text is sent instead of an id. */
const OTHER = "__other__";

type Errors = Partial<Record<"student_name" | "phone" | "form", string>>;

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "•";
}

function Field({ label, icon: Icon, required, error, children }: { label: string; icon?: typeof User; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        {Icon && <Icon className="size-3.5 text-emerald-700" aria-hidden />}
        {label}
        {required && <span className="text-rose-600">*</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The centre's enrolment form, as the parent sees it from the advert: the academy's own name and
 * mark, the words the centre wrote, and the questions it chose to ask. Mobile first — most of these
 * are filled on a phone from a WhatsApp or Facebook link.
 *
 * The submit goes straight from the browser to `POST /api/e/{token}`: no session, no CSRF cookie —
 * the token scopes it. A 422 is read back onto the field it names; a 410 means the centre closed the
 * form since the page loaded; a 429 is the throttle.
 */
export function EnrolForm({ token, data, initialLang }: { token: string; data: PublicEnrolmentPayload; initialLang: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = COPY[lang];
  const form = data.form;

  const defaultCountry = COUNTRIES.find((c) => c.code === (data.academy.country ?? ""))?.code ?? COUNTRIES[0]!.code;
  const [studentName, setStudentName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [dialCountry, setDialCountry] = useState(defaultCountry);
  const [localNumber, setLocalNumber] = useState("");
  const [email, setEmail] = useState("");
  const [age, setAge] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [subjectText, setSubjectText] = useState("");
  const [levelText, setLevelText] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [done, setDone] = useState<{ message: string | null } | null>(null);
  const [closed, setClosed] = useState(!form.is_open);

  function switchLang() {
    const next: Lang = lang === "ar" ? "en" : "ar";
    setLang(next);
    try {
      document.cookie = `${ENROL_LANG_COOKIE}=${next}; path=/e; max-age=31536000; samesite=lax`;
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.history.replaceState(null, "", url);
    } catch {
      // Remembering is a convenience; the page has already switched.
    }
  }

  /** The dial code and the digits, with a typed trunk zero dropped ("010…" must not become "+20010…"). */
  function phone(): string | null {
    const digits = localNumber.replace(/^0+/, "");
    if (!digits) return null;
    const dial = COUNTRIES.find((c) => c.code === dialCountry)?.dialCode ?? "";
    return dial + digits;
  }

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  }

  function reset() {
    setStudentName("");
    setAge("");
    setSubjectId("");
    setSubjectText("");
    setLevelText("");
    setDays([]);
    setTime("");
    setMessage("");
    setErrors({});
    setDone(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (studentName.trim().length < 2) next.student_name = t.required;
    const e164 = phone();
    if (!e164 || e164.replace(/\D/g, "").length < 8) next.phone = t.phoneInvalid;
    if (Object.keys(next).length > 0) return setErrors(next);

    const payload: PublicEnrolmentSubmit = {
      student_name: studentName.trim(),
      guardian_name: guardianName.trim() || null,
      phone: e164!,
      email: email.trim() || null,
      age: age.trim() ? Number(age) : null,
      subject_id: form.ask_subject && subjectId && subjectId !== OTHER ? subjectId : null,
      subject_text: form.ask_subject && subjectId === OTHER ? subjectText.trim() || null : null,
      // TODO(levels): send `level_id` from the academy's levels list once it exists; free text until then.
      level_text: form.ask_level ? levelText.trim() || null : null,
      preferred_days: form.ask_schedule ? days : [],
      preferred_time: form.ask_schedule && time ? time : null,
      message: message.trim() || null,
      website,
    };

    setBusy(true);
    setErrors({});
    try {
      const res = await fetch(`${apiBase()}/api/e/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 410) {
        setClosed(true);
        return;
      }
      if (res.status === 429) return setErrors({ form: t.tooMany });
      if (res.status === 422) {
        const body = (await res.json().catch(() => ({}))) as { errors?: Record<string, string[]> };
        const fieldErrors: Errors = {};
        for (const [key, msgs] of Object.entries(body.errors ?? {})) {
          if (key === "student_name" || key === "phone") fieldErrors[key] = msgs[0];
        }
        return setErrors(Object.keys(fieldErrors).length > 0 ? fieldErrors : { form: t.failed });
      }
      if (!res.ok) return setErrors({ form: t.failed });
      const body = (await res.json()) as { ok: boolean; success_message: string | null };
      setDone({ message: body.success_message });
    } catch {
      setErrors({ form: t.failed });
    } finally {
      setBusy(false);
    }
  }

  const academyName = data.academy.displayName || data.academy.name;

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="min-h-dvh bg-[#f5f3ec] font-sans text-slate-900">
      {/* ── Academy bar ─────────────────────────────────────────── */}
      <header className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {data.academy.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.academy.logoUrl} alt="" className="size-10 shrink-0 rounded-xl bg-white object-contain p-1 shadow-sm ring-1 ring-slate-900/[0.06]" />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-base font-bold text-white shadow-sm">
              {initial(academyName)}
            </span>
          )}
          <span className="truncate text-base font-bold text-slate-900" data-testid="enrol-academy">
            {academyName}
          </span>
        </div>
        <button
          type="button"
          onClick={switchLang}
          data-testid="enrol-lang"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-900/[0.08] transition hover:bg-slate-50"
        >
          <Languages className="size-4 text-emerald-700" aria-hidden />
          {t.otherLang}
        </button>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-14">
        {/* ── The centre's words ──────────────────────────────────── */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-700 via-emerald-800 to-teal-900 p-5 text-white shadow-lg sm:p-7">
          <KhatamLattice id="enrol-hero-lattice" className="pointer-events-none absolute inset-0 size-full text-white/[0.07]" />
          <div className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-amber-300/20 blur-3xl" aria-hidden />
          <div className="relative">
            <h1 className="text-2xl font-bold sm:text-3xl" data-testid="enrol-title">
              {form.title || t.defaultTitle}
            </h1>
            <p className="mt-1.5 text-sm text-emerald-50/85">{form.intro ?? t.defaultIntro}</p>
          </div>
        </section>

        {closed ? (
          <section className={`${CARD} mt-5 px-5 py-10 text-center`} data-testid="enrol-closed">
            <Lock className="mx-auto size-8 text-slate-400" aria-hidden />
            <h2 className="mt-3 text-lg font-bold">{t.closedTitle}</h2>
            <p className="mt-1 text-sm text-slate-500">{t.closedBody}</p>
          </section>
        ) : done ? (
          <section className={`${CARD} mt-5 px-5 py-10 text-center`} data-testid="enrol-success">
            <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Check className="size-7" aria-hidden />
            </span>
            <h2 className="mt-4 text-lg font-bold">{t.successTitle}</h2>
            <p className="mt-1.5 text-sm text-slate-600">{done.message ?? t.successDefault}</p>
            <button
              type="button"
              onClick={reset}
              className="mt-6 rounded-full bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm ring-1 ring-emerald-700/20 transition hover:bg-emerald-50"
            >
              {t.another}
            </button>
          </section>
        ) : (
          <form onSubmit={(e) => void submit(e)} noValidate className={`${CARD} mt-5 space-y-5 p-5 sm:p-6`} data-testid="enrol-form">
            {errors.form && (
              <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700 ring-1 ring-rose-200">
                {errors.form}
              </p>
            )}

            <Field label={t.student} icon={User} required error={errors.student_name}>
              <input
                className={INPUT}
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder={t.studentPlaceholder}
                autoComplete="name"
                aria-label={t.student}
                data-testid="enrol-student"
              />
            </Field>

            <Field label={t.guardian} icon={Users}>
              <input className={INPUT} value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder={t.guardianPlaceholder} aria-label={t.guardian} data-testid="enrol-guardian" />
            </Field>

            <Field label={t.phone} icon={Phone} required error={errors.phone}>
              <div dir="ltr" className="flex h-11 overflow-hidden rounded-xl border border-slate-200 bg-white transition focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-600/15">
                <select
                  aria-label="Country code"
                  value={dialCountry}
                  onChange={(e) => setDialCountry(e.target.value)}
                  className="max-w-[7.5rem] shrink-0 border-e border-slate-200 bg-slate-50 px-2 text-sm outline-none"
                  data-testid="enrol-dial"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.dialCode}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  aria-label={t.phone}
                  placeholder={t.phonePlaceholder}
                  value={localNumber}
                  onChange={(e) => setLocalNumber(e.target.value.replace(/[^\d]/g, ""))}
                  className="min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-slate-400"
                  data-testid="enrol-phone"
                />
              </div>
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t.email}>
                <input type="email" dir="ltr" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-label={t.email} />
              </Field>
              <Field label={t.age}>
                <input type="number" inputMode="numeric" min={1} max={120} className={INPUT} value={age} onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, ""))} placeholder={t.agePlaceholder} aria-label={t.age} data-testid="enrol-age" />
              </Field>
            </div>

            {form.ask_subject && (
              <Field label={t.subject} icon={NotebookPen}>
                <select className={INPUT} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label={t.subject} data-testid="enrol-subject">
                  <option value="">{t.subjectPick}</option>
                  {data.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value={OTHER}>{t.subjectOther}</option>
                </select>
                {subjectId === OTHER && (
                  <input className={`${INPUT} mt-2`} value={subjectText} onChange={(e) => setSubjectText(e.target.value)} placeholder={t.subjectOtherPlaceholder} aria-label={t.subjectOther} data-testid="enrol-subject-text" />
                )}
              </Field>
            )}

            {form.ask_level && (
              // TODO(levels): a select over the academy's levels list plugs in here once it lands.
              <Field label={t.level}>
                <input className={INPUT} value={levelText} onChange={(e) => setLevelText(e.target.value)} placeholder={t.levelPlaceholder} aria-label={t.level} data-testid="enrol-level" />
              </Field>
            )}

            {form.ask_schedule && (
              <>
                <Field label={t.days} icon={CalendarDays}>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={t.days}>
                    {WEEK_ORDER.map((d) => {
                      const on = days.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleDay(d)}
                          data-testid={`enrol-day-${d}`}
                          className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
                            on ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {t.weekdays[d]}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label={t.time} icon={Clock}>
                  <input type="time" dir="ltr" className={`${INPUT} sm:max-w-[12rem]`} value={time} onChange={(e) => setTime(e.target.value)} aria-label={t.time} data-testid="enrol-time" />
                </Field>
              </>
            )}

            <Field label={t.message}>
              <textarea className={INPUT} rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t.messagePlaceholder} aria-label={t.message} data-testid="enrol-message" />
            </Field>

            {/* The honeypot: off-screen, never for a person. */}
            <div className="absolute -start-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
              <label htmlFor="enrol-website">Website</label>
              <input id="enrol-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            <button
              type="submit"
              disabled={busy}
              data-testid="enrol-submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60"
            >
              {busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Send className="size-4" aria-hidden />}
              {busy ? t.sending : t.submit}
            </button>
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
              <Lock className="size-3" aria-hidden />
              {t.privacy}
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
