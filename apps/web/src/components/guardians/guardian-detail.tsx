"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { StudentForm } from "@/components/students/student-form";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  deactivateGuardian,
  getGuardian,
  type GuardianChild,
  type GuardianRow,
  updateGuardian,
} from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

/**
 * Guardian detail: edit the guardian, list their students, add a child inline (the canonical
 * §5.1 flow, reusing the StudentForm with this guardian fixed), and deactivate (blocked while
 * active children exist — the server message is surfaced).
 */
export function GuardianDetail({
  guardianId,
  onBack,
}: {
  guardianId: string;
  onBack: () => void;
}) {
  const t = useTranslations("guardians");
  const { can } = useAuth();

  const [guardian, setGuardian] = useState<GuardianRow | null>(null);
  const [children, setChildren] = useState<GuardianChild[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingChild, setAddingChild] = useState(false);

  const refresh = useCallback(async () => {
    const res = await getGuardian(guardianId);
    setGuardian(res.guardian);
    setChildren(res.children);
  }, [guardianId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (guardian === null) {
    return <p className="text-muted-foreground text-sm">…</p>;
  }

  function set<K extends keyof GuardianRow>(key: K, value: GuardianRow[K]) {
    setGuardian((g) => (g ? { ...g, [key]: value } : g));
  }

  const canEdit = can("guardian.update");

  async function save() {
    if (guardian === null) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await updateGuardian(guardianId, {
        full_name: guardian.full_name,
        whatsapp_phone: guardian.whatsapp_phone,
        country: guardian.country,
        currency: guardian.currency,
        notes: guardian.notes,
      });
      setNotice(t("form.saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (addingChild) {
    return (
      <div className="space-y-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAddingChild(false)}
        >
          ← {t("back")}
        </Button>
        <StudentForm
          fixedGuardianId={guardianId}
          onCancel={() => setAddingChild(false)}
          onCreated={() => {
            setAddingChild(false);
            void refresh();
          }}
        />
      </div>
    );
  }

  const activeChildren = children.filter((c) => c.deleted_at == null).length;

  return (
    <div className="max-w-2xl space-y-8" data-testid="guardian-detail">
      <div className="flex items-center justify-between">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            ← {t("back")}
          </Button>
          <h1 className="mt-1 text-2xl font-semibold">{guardian.full_name}</h1>
        </div>
        {can("guardian.update") && guardian.deleted_at == null && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            data-testid="deactivate-guardian"
            onClick={async () => {
              setError(null);
              try {
                await deactivateGuardian(guardianId);
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

      <section className="space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("form.fullName")}</span>
          <input
            aria-label={t("form.fullName")}
            className={inputClass}
            value={guardian.full_name}
            disabled={!canEdit}
            onChange={(e) => set("full_name", e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("form.phone")}</span>
          <input
            aria-label={t("form.phone")}
            className={inputClass}
            value={guardian.whatsapp_phone}
            disabled={!canEdit}
            onChange={(e) => set("whatsapp_phone", e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("form.country")}</span>
            <input
              aria-label={t("form.country")}
              className={inputClass}
              maxLength={2}
              value={guardian.country ?? ""}
              disabled={!canEdit}
              onChange={(e) => set("country", e.target.value.toUpperCase())}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t("form.currency")}</span>
            <input
              aria-label={t("form.currency")}
              className={inputClass}
              maxLength={3}
              value={guardian.currency}
              disabled={!canEdit}
              onChange={(e) => set("currency", e.target.value.toUpperCase())}
            />
          </label>
        </div>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            disabled={saving}
            onClick={() => void save()}
            data-testid="save-guardian"
          >
            {saving ? t("form.saving") : t("form.save")}
          </Button>
        )}
      </section>

      <section className="space-y-3" data-testid="guardian-children">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {t("detail.children")}{" "}
            <span className="text-muted-foreground text-sm">
              ({activeChildren})
            </span>
          </h2>
          {can("student.create") && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddingChild(true)}
              data-testid="add-child"
            >
              {t("detail.addChild")}
            </Button>
          )}
        </div>
        {children.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("detail.noChildren")}
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {children.map((c) => (
              <li
                key={c.id}
                data-child={c.id}
                className="flex justify-between px-3 py-2"
              >
                <span>{c.full_name}</span>
                {c.deleted_at != null && (
                  <span className="text-muted-foreground italic">
                    {t("filter.inactive")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
