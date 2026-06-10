"use client";

import { PRICE_BASIS } from "@academiq/contracts";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  changeSubscriptionPrice,
  deactivateStudent,
  getStudent,
  getTeacherHistory,
  listTeachers,
  reassignTeacher,
  setSubscription,
  type StudentDetail as StudentDetailData,
  type TeacherAssignmentHistoryItem,
  type TeacherRow,
  updateStudent,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

function toMinor(major: string): number {
  return Math.round(parseFloat(major || "0") * 100);
}

/**
 * Student detail: edit the profile, set/replace the subscription, change the price (audited,
 * future-only), reassign the teacher (history-preserving), and view the assignment history.
 * Deactivate is soft-delete. Every mutation re-reads from the server so the UI never drifts.
 */
export function StudentDetail({
  studentId,
  onBack,
}: {
  studentId: string;
  onBack: () => void;
}) {
  const t = useTranslations("students");
  const locale = useLocale();
  const { can } = useAuth();

  const [data, setData] = useState<StudentDetailData | null>(null);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [history, setHistory] = useState<TeacherAssignmentHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [detail, hist] = await Promise.all([
      getStudent(studentId),
      getTeacherHistory(studentId),
    ]);
    setData(detail);
    setHistory(hist.history);
  }, [studentId]);

  useEffect(() => {
    void refresh();
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, [refresh]);

  if (data === null) {
    return <p className="text-muted-foreground text-sm">…</p>;
  }

  const canEdit = can("student.update");

  return (
    <div className="max-w-2xl space-y-8" data-testid="student-detail">
      <div className="flex items-center justify-between">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            ← {t("back")}
          </Button>
          <h1 className="mt-1 text-2xl font-semibold">
            {data.student.full_name}
          </h1>
          {data.student.is_self_guardian && (
            <span className="text-muted-foreground text-xs">
              {t("form.selfGuardian")}
            </span>
          )}
        </div>
        {can("student.deactivate") && data.student.deleted_at == null && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="deactivate-student"
            onClick={async () => {
              setError(null);
              try {
                await deactivateStudent(studentId);
                onBack();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : String(err));
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

      <ProfileSection
        data={data}
        canEdit={canEdit}
        onSaved={() => {
          setNotice(t("form.saved"));
          void refresh();
        }}
        onError={setError}
      />

      <SubscriptionSection
        data={data}
        teachers={teachers}
        canEdit={canEdit}
        locale={locale}
        studentId={studentId}
        onChanged={(msg) => {
          setNotice(msg);
          void refresh();
        }}
        onError={setError}
      />

      <TeacherSection
        data={data}
        history={history}
        teachers={teachers}
        canEdit={canEdit}
        studentId={studentId}
        onChanged={() => void refresh()}
        onError={setError}
      />
    </div>
  );
}

function ProfileSection({
  data,
  canEdit,
  onSaved,
  onError,
}: {
  data: StudentDetailData;
  canEdit: boolean;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("students");
  const [name, setName] = useState(data.student.full_name);
  const [status, setStatus] = useState((data.student.status as string) ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateStudent(data.student.id, { full_name: name, status });
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3" data-testid="student-profile">
      <h2 className="text-lg font-medium">{t("detail.profile")}</h2>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("form.fullName")}</span>
        <input
          aria-label={t("form.fullName")}
          className={inputClass}
          value={name}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("form.status")}</span>
        <input
          aria-label={t("form.status")}
          className={inputClass}
          value={status}
          disabled={!canEdit}
          onChange={(e) => setStatus(e.target.value)}
        />
      </label>
      {canEdit && (
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => void save()}
          data-testid="save-student"
        >
          {saving ? t("form.saving") : t("form.save")}
        </Button>
      )}
    </section>
  );
}

function SubscriptionSection({
  data,
  canEdit,
  locale,
  studentId,
  onChanged,
  onError,
}: {
  data: StudentDetailData;
  teachers: TeacherRow[];
  canEdit: boolean;
  locale: string;
  studentId: string;
  onChanged: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("students");
  const sub = data.subscription;
  const [editingPrice, setEditingPrice] = useState(false);
  const [newPrice, setNewPrice] = useState("");
  const [showSet, setShowSet] = useState(false);

  // Set/replace form state.
  const [planLabel, setPlanLabel] = useState("");
  const [sessions, setSessions] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [basis, setBasis] =
    useState<(typeof PRICE_BASIS)[number]>("PER_SESSION");
  const [startDate, setStartDate] = useState("");

  async function changePrice() {
    try {
      await changeSubscriptionPrice(studentId, {
        price_minor: toMinor(newPrice),
      });
      setEditingPrice(false);
      setNewPrice("");
      onChanged(t("subscription.priceChanged"));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function save() {
    try {
      await setSubscription(studentId, {
        plan_label: planLabel,
        sessions_per_month: sessions ? Number(sessions) : null,
        price_minor: toMinor(price),
        currency: currency || undefined,
        price_basis: basis,
        start_date: startDate,
      });
      setShowSet(false);
      onChanged(t("subscription.saved"));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <section className="space-y-3" data-testid="student-subscription">
      <h2 className="text-lg font-medium">{t("subscription.title")}</h2>

      {sub ? (
        <div
          className="space-y-1 rounded-md border p-3 text-sm"
          data-testid="subscription-card"
        >
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t("subscription.planLabel")}
            </span>
            <span>{sub.plan_label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t("subscription.price")}
            </span>
            <span data-testid="subscription-price">
              {formatMoney(
                { amount: sub.price_minor, currency: sub.currency },
                locale,
              )}{" "}
              · {t(`basis.${sub.price_basis}`)}
            </span>
          </div>
          {canEdit && !editingPrice && (
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setEditingPrice(true)}
                data-testid="edit-price"
              >
                {t("subscription.editPrice")}
              </Button>
            </div>
          )}
          {editingPrice && (
            <div className="flex items-end gap-2 pt-2">
              <label className="space-y-1">
                <span className="text-xs">{t("subscription.newPrice")}</span>
                <input
                  type="number"
                  step="0.01"
                  aria-label={t("subscription.newPrice")}
                  className={inputClass}
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                />
              </label>
              <Button
                type="button"
                size="xs"
                onClick={() => void changePrice()}
                data-testid="save-price"
              >
                {t("subscription.editPrice")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t("subscription.none")}
        </p>
      )}

      {canEdit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowSet((v) => !v)}
          data-testid="toggle-set-subscription"
        >
          {t("subscription.set")}
        </Button>
      )}

      {showSet && canEdit && (
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
            />
          </label>
          <div className="col-span-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => void save()}
              data-testid="save-subscription"
            >
              {t("subscription.set")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function TeacherSection({
  data,
  history,
  teachers,
  canEdit,
  studentId,
  onChanged,
  onError,
}: {
  data: StudentDetailData;
  history: TeacherAssignmentHistoryItem[];
  teachers: TeacherRow[];
  canEdit: boolean;
  studentId: string;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("students");
  const [teacherId, setTeacherId] = useState("");
  const [effective, setEffective] = useState("");
  const [changing, setChanging] = useState(false);

  async function change() {
    if (!teacherId) return;
    setChanging(true);
    try {
      await reassignTeacher(studentId, {
        teacher_id: teacherId,
        effective_date: effective || undefined,
      });
      setTeacherId("");
      setEffective("");
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setChanging(false);
    }
  }

  return (
    <section className="space-y-3" data-testid="student-teacher">
      <h2 className="text-lg font-medium">{t("teacher.title")}</h2>
      <p className="text-sm">
        <span className="text-muted-foreground">{t("teacher.current")}: </span>
        <span data-testid="current-teacher">
          {data.currentTeacher?.teacher_name ?? t("teacher.none")}
        </span>
      </p>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="text-xs">{t("teacher.change")}</span>
            <select
              aria-label={t("teacher.change")}
              className={inputClass}
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              data-testid="change-teacher-select"
            >
              <option value="">{t("form.none")}</option>
              {teachers.map((tch) => (
                <option key={tch.id} value={tch.id}>
                  {tch.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs">{t("teacher.effectiveDate")}</span>
            <input
              type="date"
              aria-label={t("teacher.effectiveDate")}
              className={inputClass}
              value={effective}
              onChange={(e) => setEffective(e.target.value)}
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={changing || !teacherId}
            onClick={() => void change()}
            data-testid="assign-teacher"
          >
            {t("teacher.assign")}
          </Button>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium">{t("teacher.history")}</h3>
        <ul
          className="mt-1 divide-y rounded-md border text-sm"
          data-testid="teacher-history"
        >
          {history.map((h) => (
            <li
              key={h.id}
              className="flex justify-between px-3 py-2"
              data-history={h.teacher_id}
            >
              <span>{h.teacher_name}</span>
              <span className="text-muted-foreground">
                {h.started_at.slice(0, 10)} →{" "}
                {h.ended_at ? h.ended_at.slice(0, 10) : t("teacher.ongoing")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
