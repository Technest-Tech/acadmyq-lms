"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AvailabilityEditor } from "@/components/teachers/availability-editor";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  type AvailabilityWindow,
  deactivateTeacher,
  getTeacher,
  type TeacherRow,
  type TeacherStudent,
  updateTeacher,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

function toMinor(major: string): number {
  return Math.round(parseFloat(major || "0") * 100);
}

/** Teacher detail: edit the session rate (audited) + availability, see current students. */
export function TeacherDetail({
  teacherId,
  onBack,
}: {
  teacherId: string;
  onBack: () => void;
}) {
  const t = useTranslations("teachers");
  const locale = useLocale();
  const { can } = useAuth();

  const [teacher, setTeacher] = useState<TeacherRow | null>(null);
  const [students, setStudents] = useState<TeacherStudent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [rate, setRate] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);

  const refresh = useCallback(async () => {
    const res = await getTeacher(teacherId);
    setTeacher(res.teacher);
    setStudents(res.students);
    setRate((res.teacher.session_rate_minor / 100).toString());
    setSpecialization(res.teacher.specialization ?? "");
    setAvailability(res.teacher.availability ?? []);
  }, [teacherId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (teacher === null) {
    return <p className="text-muted-foreground text-sm">…</p>;
  }

  const canEdit = can("teacher.update");

  async function save() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await updateTeacher(teacherId, {
        session_rate_minor: toMinor(rate),
        specialization: specialization || null,
        availability,
      });
      setNotice(t("form.saved"));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8" data-testid="teacher-detail">
      <div className="flex items-center justify-between">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            ← {t("back")}
          </Button>
          <h1 className="mt-1 text-2xl font-semibold">{teacher.full_name}</h1>
        </div>
        {can("teacher.deactivate") && teacher.deleted_at == null && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="deactivate-teacher"
            onClick={async () => {
              setError(null);
              try {
                await deactivateTeacher(teacherId);
                onBack();
              } catch (err) {
                setError(
                  err instanceof ApiError
                    ? t("detail.deactivateBlocked")
                    : String(err),
                );
              }
            }}
          >
            {t("detail.deactivate")}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-600">
          {notice}
        </p>
      )}

      <section className="space-y-3" data-testid="teacher-profile">
        <h2 className="text-lg font-medium">{t("detail.profile")}</h2>
        <p className="text-sm" data-testid="teacher-rate">
          <span className="text-muted-foreground">{t("detail.rate")}: </span>
          {formatMoney(
            { amount: teacher.session_rate_minor, currency: teacher.currency },
            locale,
          )}
        </p>
        <label className="block space-y-1">
          <span className="text-sm font-medium">
            {t("form.specialization")}
          </span>
          <input
            aria-label={t("form.specialization")}
            className={inputClass}
            value={specialization}
            disabled={!canEdit}
            onChange={(e) => setSpecialization(e.target.value)}
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
            disabled={!canEdit}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        <div className="space-y-1">
          <span className="text-sm font-medium">
            {t("detail.availability")}
          </span>
          <AvailabilityEditor
            value={availability}
            onChange={setAvailability}
            disabled={!canEdit}
          />
        </div>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void save()}
            data-testid="save-teacher"
          >
            {saving ? t("form.saving") : t("form.save")}
          </Button>
        )}
      </section>

      <section className="space-y-2" data-testid="teacher-students">
        <h2 className="text-lg font-medium">{t("detail.students")}</h2>
        {students.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("detail.noStudents")}
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {students.map((s) => (
              <li key={s.id} className="px-3 py-2" data-student={s.id}>
                {s.full_name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
