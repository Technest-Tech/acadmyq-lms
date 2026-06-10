"use client";

import { PRICE_BASIS } from "@academiq/contracts";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  createStudent,
  type GuardianRow,
  listGuardians,
  listTeachers,
  type StudentInput,
  type TeacherRow,
} from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

/** Major→minor units for the wire (the API stores integer minor units only). */
function toMinor(major: string): number {
  return Math.round(parseFloat(major || "0") * 100);
}

/**
 * Create a student. Reused both on the Students screen and inside a guardian's detail (with
 * `fixedGuardianId`) so the canonical "add a guardian, then add their children" flow (§5.1)
 * works from either entry point. Supports the adult-solo case (self-guardian) and optional
 * inline subscription + first teacher assignment.
 */
export function StudentForm({
  fixedGuardianId,
  onCreated,
  onCancel,
}: {
  fixedGuardianId?: string;
  onCreated: (studentId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("students");
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [selfGuardian, setSelfGuardian] = useState(false);
  const [guardianId, setGuardianId] = useState(fixedGuardianId ?? "");
  const [teacherId, setTeacherId] = useState("");

  const [addSub, setAddSub] = useState(false);
  const [planLabel, setPlanLabel] = useState("");
  const [sessions, setSessions] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [basis, setBasis] =
    useState<(typeof PRICE_BASIS)[number]>("PER_SESSION");
  const [startDate, setStartDate] = useState("");

  useEffect(() => {
    void listTeachers({ pageSize: 50, filter: { status: "active" } }).then(
      (r) => setTeachers(r.rows),
    );
    if (!fixedGuardianId) {
      void listGuardians({ pageSize: 50 }).then((r) => setGuardians(r.rows));
    }
  }, [fixedGuardianId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const input: StudentInput = {
        full_name: fullName,
        whatsapp_phone: phone || null,
        country: country || null,
        is_self_guardian: selfGuardian,
      };
      if (!selfGuardian) input.guardian_id = fixedGuardianId ?? guardianId;
      if (teacherId) input.teacher_id = teacherId;
      if (addSub) {
        input.subscription = {
          plan_label: planLabel,
          sessions_per_month: sessions ? Number(sessions) : null,
          price_minor: toMinor(price),
          currency: currency || undefined,
          price_basis: basis,
          start_date: startDate,
        };
      }
      const res = await createStudent(input);
      onCreated(res.studentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={submit}
      data-testid="student-form"
    >
      <h2 className="text-lg font-medium">{t("new")}</h2>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("form.fullName")}</span>
        <input
          aria-label={t("form.fullName")}
          className={inputClass}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={selfGuardian}
          onChange={(e) => setSelfGuardian(e.target.checked)}
          data-testid="self-guardian"
        />
        <span>{t("form.selfGuardian")}</span>
      </label>

      {selfGuardian ? (
        <p className="text-muted-foreground text-xs">
          {t("form.selfGuardianHint")}
        </p>
      ) : (
        !fixedGuardianId && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("form.guardian")}</span>
            <select
              aria-label={t("form.guardian")}
              className={inputClass}
              value={guardianId}
              onChange={(e) => setGuardianId(e.target.value)}
              required
            >
              <option value="">{t("form.none")}</option>
              {guardians.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.full_name}
                </option>
              ))}
            </select>
          </label>
        )
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("form.phone")}</span>
          <input
            aria-label={t("form.phone")}
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("form.country")}</span>
          <input
            aria-label={t("form.country")}
            className={inputClass}
            maxLength={2}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("form.teacher")}</span>
        <select
          aria-label={t("form.teacher")}
          className={inputClass}
          value={teacherId}
          onChange={(e) => setTeacherId(e.target.value)}
        >
          <option value="">{t("form.none")}</option>
          {teachers.map((tch) => (
            <option key={tch.id} value={tch.id}>
              {tch.full_name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={addSub}
          onChange={(e) => setAddSub(e.target.checked)}
          data-testid="add-subscription"
        />
        <span>{t("subscription.title")}</span>
      </label>

      {addSub && (
        <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
          <label className="col-span-2 block space-y-1">
            <span className="text-sm font-medium">
              {t("subscription.planLabel")}
            </span>
            <input
              aria-label={t("subscription.planLabel")}
              className={inputClass}
              value={planLabel}
              onChange={(e) => setPlanLabel(e.target.value)}
              required={addSub}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {t("subscription.sessionsPerMonth")}
            </span>
            <input
              type="number"
              aria-label={t("subscription.sessionsPerMonth")}
              className={inputClass}
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {t("subscription.price")}
            </span>
            <input
              type="number"
              step="0.01"
              aria-label={t("subscription.price")}
              className={inputClass}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required={addSub}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {t("subscription.currency")}
            </span>
            <input
              aria-label={t("subscription.currency")}
              className={inputClass}
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {t("subscription.basis")}
            </span>
            <select
              aria-label={t("subscription.basis")}
              className={inputClass}
              value={basis}
              onChange={(e) =>
                setBasis(e.target.value as (typeof PRICE_BASIS)[number])
              }
            >
              {PRICE_BASIS.map((b) => (
                <option key={b} value={b}>
                  {t(`basis.${b}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {t("subscription.startDate")}
            </span>
            <input
              type="date"
              aria-label={t("subscription.startDate")}
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required={addSub}
            />
          </label>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t("form.creating") : t("form.create")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("back")}
        </Button>
      </div>
    </form>
  );
}
