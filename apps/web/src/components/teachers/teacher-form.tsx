"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AvailabilityEditor } from "@/components/teachers/availability-editor";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  type AvailabilityWindow,
  createTeacher,
  type TeacherInput,
} from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

function toMinor(major: string): number {
  return Math.round(parseFloat(major || "0") * 100);
}

/** Create a teacher: name, session rate (drives payroll), availability and an optional login. */
export function TeacherForm({
  onCreated,
  onCancel,
}: {
  onCreated: (teacherId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("teachers");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState("");
  const [createLogin, setCreateLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const input: TeacherInput = {
        full_name: fullName,
        phone: phone || null,
        specialization: specialization || null,
        session_rate_minor: toMinor(rate),
        currency: currency || undefined,
        availability,
        create_login: createLogin,
        email: createLogin ? email : null,
      };
      const res = await createTeacher(input);
      onCreated(res.teacherId);
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
      data-testid="teacher-form"
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

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">
            {t("form.specialization")}
          </span>
          <input
            aria-label={t("form.specialization")}
            className={inputClass}
            value={specialization}
            onChange={(e) => setSpecialization(e.target.value)}
          />
        </label>
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
          <span className="text-sm font-medium">{t("form.rate")}</span>
          <input
            type="number"
            step="0.01"
            aria-label={t("form.rate")}
            className={inputClass}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("form.currency")}</span>
          <input
            aria-label={t("form.currency")}
            className={inputClass}
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-sm font-medium">{t("detail.availability")}</span>
        <AvailabilityEditor value={availability} onChange={setAvailability} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={createLogin}
          onChange={(e) => setCreateLogin(e.target.checked)}
          data-testid="create-login"
        />
        <span>{t("form.createLogin")}</span>
      </label>
      {createLogin && (
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("form.email")}</span>
          <input
            type="email"
            aria-label={t("form.email")}
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required={createLogin}
          />
        </label>
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
