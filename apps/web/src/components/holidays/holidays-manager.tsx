"use client";

import { CalendarOff, CalendarPlus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  createHoliday,
  deleteHoliday,
  listHolidays,
  previewHoliday,
  type Holiday,
  type HolidayCounts,
} from "@/lib/holidays-api";

type ModalState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "confirm"; input: { name: string; starts_on: string; ends_on: string }; counts: HolidayCounts }
  | { kind: "delete"; holiday: Holiday };

function rangeText(h: Pick<Holiday, "starts_on" | "ends_on">, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const from = fmt.format(new Date(`${h.starts_on}T12:00:00Z`));
  if (h.starts_on === h.ends_on) return from;
  return `${from} – ${fmt.format(new Date(`${h.ends_on}T12:00:00Z`))}`;
}

/**
 * Settings → أجازات المركز (centre only): the days the centre is closed. Adding one shows what it
 * will cancel before it does (a dry run against the API), deleting one says what came back.
 * Make-up lessons are not rebuilt here — a group's own "extra lesson" is the make-up, so the card
 * points at the groups page.
 */
export function HolidaysManager() {
  const t = useTranslations("holidays");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("settings.manage");

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHolidays((await listHolidays()).holidays);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const message = await action();
      setModal({ kind: "closed" });
      setNotice(message);
      void load();
    } catch (err) {
      setError(apiErrorMessage(err, t("actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard icon={CalendarOff} title={t("title")} description={t("description")} iconClassName="bg-gradient-to-br from-amber-500 to-orange-600" testId="holidays-card">
      <div className="space-y-4">
        {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-xs">
            {t("makeUp")}{" "}
            <Link href="/groups" className="text-primary underline-offset-2 hover:underline">
              {t("makeUpLink")}
            </Link>
          </p>
          {canManage && (
            <Button type="button" size="sm" className="gap-1.5" onClick={() => setModal({ kind: "add" })} data-testid="holiday-add">
              <CalendarPlus className="size-3.5" />
              {t("add")}
            </Button>
          )}
        </div>

        {loading && holidays.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">{t("loading")}</p>
        ) : holidays.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">{t("empty")}</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border" data-testid="holidays-list">
            {holidays.map((h) => {
              const total = h.cancelled.group_lessons + h.cancelled.sessions;
              return (
                <li key={h.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`holiday-${h.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium">{h.name}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {rangeText(h, locale)} · {t("cancelled", { count: total })}
                      {total > 0 && ` (${t("cancelledDetail", { groups: h.cancelled.group_lessons, sessions: h.cancelled.sessions })})`}
                    </p>
                  </div>
                  {canManage && (
                    <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => setModal({ kind: "delete", holiday: h })} aria-label={`${t("delete.action")} ${h.name}`}>
                      <Trash2 className="size-3.5" />
                      {t("delete.action")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Modal open={modal.kind === "add"} onClose={() => setModal({ kind: "closed" })} title={t("add")} description={t("description")}>
        {modal.kind === "add" && (
          <HolidayForm
            busy={busy}
            onCancel={() => setModal({ kind: "closed" })}
            onSubmit={async (input) => {
              setBusy(true);
              setError(null);
              try {
                const counts = await previewHoliday(input.starts_on, input.ends_on);
                setModal({ kind: "confirm", input, counts });
              } catch (err) {
                setError(apiErrorMessage(err, t("actionFailed")));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </Modal>

      <Modal open={modal.kind === "confirm"} onClose={() => setModal({ kind: "closed" })} title={t("preview.title")}>
        {modal.kind === "confirm" && (
          <div className="space-y-4" data-testid="holiday-confirm">
            <p className="font-medium">
              {modal.input.name} · {rangeText(modal.input, locale)}
            </p>
            {modal.counts.group_lessons + modal.counts.sessions === 0 ? (
              <p className="text-muted-foreground text-sm">{t("preview.none")}</p>
            ) : (
              <div className="space-y-1 text-sm">
                <p>{t("preview.willCancel", { count: modal.counts.group_lessons + modal.counts.sessions })}</p>
                <ul className="text-muted-foreground list-inside list-disc">
                  <li>{t("preview.groups", { count: modal.counts.group_lessons })}</li>
                  <li>{t("preview.sessions", { count: modal.counts.sessions })}</li>
                </ul>
              </div>
            )}
            <p className="text-muted-foreground text-xs">{t("preview.pastNote")}</p>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setModal({ kind: "add" })}>
                {t("back")}
              </Button>
              <Button
                type="button"
                disabled={busy}
                data-testid="holiday-confirm-submit"
                onClick={() =>
                  void run(async () => {
                    const res = await createHoliday(modal.input);
                    return t("created", { count: res.cancelled.group_lessons + res.cancelled.sessions });
                  })
                }
              >
                {t("preview.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={modal.kind === "delete"} onClose={() => setModal({ kind: "closed" })} title={t("delete.title")} description={t("delete.hint")}>
        {modal.kind === "delete" && (
          <div className="space-y-4">
            <p className="font-medium">
              {modal.holiday.name} · {rangeText(modal.holiday, locale)}
            </p>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setModal({ kind: "closed" })}>
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                data-testid="holiday-delete-submit"
                onClick={() =>
                  void run(async () => {
                    const res = await deleteHoliday(modal.holiday.id);
                    return t("delete.done", { count: res.restored.group_lessons + res.restored.sessions });
                  })
                }
              >
                {t("delete.confirm")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </SectionCard>
  );
}

function HolidayForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { name: string; starts_on: string; ends_on: string }) => void;
}) {
  const t = useTranslations("holidays");
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const valid = name.trim().length > 0 && from !== "" && to !== "" && to >= from;

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("name")}</span>
        <input className={fieldClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} data-testid="holiday-name" />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("from")}</span>
          <input className={fieldClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="holiday-from" />
        </label>
        <label className="space-y-1.5">
          <span className="text-sm font-medium">{t("to")}</span>
          <input className={fieldClass} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} data-testid="holiday-to" />
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="button" disabled={busy || !valid} onClick={() => onSubmit({ name: name.trim(), starts_on: from, ends_on: to })} data-testid="holiday-next">
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
