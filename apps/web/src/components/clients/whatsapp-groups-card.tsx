"use client";

import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  getAvailableWhatsAppGroups,
  getWhatsAppGroupAlerts,
  getWhatsAppGroups,
  linkWhatsAppGroup,
  testWhatsAppGroup,
  unlinkWhatsAppGroup,
  updateWhatsAppGroup,
  whatsappStatus,
  type AvailableWhatsAppGroup,
  type WhatsAppGroup,
  type WhatsAppGroupAlert,
  type WhatsAppGroupAlertStatus,
  type WhatsAppGroupCatalog,
  type WhatsAppGroupEvent,
  type WhatsAppGroupSettings,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * WhatsApp group alerts on the client page: the client's staff groups ("Supervision",
 * "Accounting"), which alerts each receives, and — per alert — whether it actually reached the
 * group. The delivery column is the point: "sent" only means WhatsApp took it, "delivered" means a
 * member's phone got it, so an operator can see a group going quiet before the client notices.
 */

const STATUS_VIEW: Record<WhatsAppGroupAlertStatus, { tone: ChipTone; icon: LucideIcon }> = {
  PENDING: { tone: "neutral", icon: Clock },
  SENDING: { tone: "info", icon: Loader2 },
  QUEUED: { tone: "info", icon: Clock },
  SENT: { tone: "good", icon: Check },
  DELIVERED: { tone: "good", icon: CheckCheck },
  FAILED: { tone: "crit", icon: X },
  SKIPPED: { tone: "neutral", icon: Check },
  EXPIRED: { tone: "warn", icon: AlertTriangle },
};

/** Test polling stops once the test alert reaches one of these. */
const SETTLED: WhatsAppGroupAlertStatus[] = ["DELIVERED", "FAILED", "EXPIRED", "SKIPPED"];

const errorText = (e: unknown): string => (e instanceof ApiError ? e.message : String(e));

export function ClientWhatsappGroupsCard({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.detail.waGroups");
  const [groups, setGroups] = useState<WhatsAppGroup[] | null>(null);
  const [catalog, setCatalog] = useState<WhatsAppGroupCatalog | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WhatsAppGroup | "new" | null>(null);
  const [removing, setRemoving] = useState<WhatsAppGroup | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getWhatsAppGroups(clientId);
      setGroups(res.groups);
      setCatalog(res.catalog);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [clientId]);

  useEffect(() => {
    void load();
    void whatsappStatus(clientId)
      .then((s) => setConnected((s.state ?? "").toLowerCase() === "connected"))
      .catch(() => setConnected(false));
  }, [clientId, load]);

  return (
    <div className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]" data-testid="client-wa-groups-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <Users className="text-muted-foreground size-4" aria-hidden />
            {t("title")}
          </h3>
          <p className="text-muted-foreground mt-0.5 max-w-xl text-xs">{t("hint")}</p>
        </div>
        <Button size="sm" disabled={catalog === null} onClick={() => setEditing("new")} data-testid="wa-group-link">
          <Plus aria-hidden />
          {t("link")}
        </Button>
      </div>

      {connected === false && (groups?.length ?? 0) > 0 && (
        <AlertBanner variant="info" className="mt-3" message={t("notConnected")} />
      )}
      {error !== null && <AlertBanner variant="error" className="mt-3" message={error} />}

      <div className="mt-4 space-y-3">
        {groups === null ? (
          <div className="bg-muted h-20 animate-pulse rounded-lg" aria-hidden />
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-xs">{t("empty")}</p>
        ) : (
          groups.map((g) => (
            <GroupRow
              key={g.id}
              clientId={clientId}
              group={g}
              onEdit={() => setEditing(g)}
              onRemove={() => setRemoving(g)}
              onReload={load}
            />
          ))
        )}
      </div>

      {editing !== null && catalog !== null && (
        <GroupFormModal
          clientId={clientId}
          catalog={catalog}
          group={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      {removing !== null && (
        <Modal
          open
          size="sm"
          title={t("removeTitle")}
          description={removing.label ?? removing.name}
          onClose={() => setRemoving(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>{t("cancel")}</Button>
              <Button
                variant="destructive"
                size="sm"
                data-testid="wa-group-remove-confirm"
                onClick={async () => {
                  try {
                    await unlinkWhatsAppGroup(clientId, removing.id);
                    setRemoving(null);
                    void load();
                  } catch (e) {
                    setRemoving(null);
                    setError(errorText(e));
                  }
                }}
              >
                {t("remove")}
              </Button>
            </div>
          }
        >
          <p className="text-muted-foreground text-sm">{t("removeBody")}</p>
        </Modal>
      )}
    </div>
  );
}

function GroupRow({
  clientId,
  group,
  onEdit,
  onRemove,
  onReload,
}: {
  clientId: string;
  group: WhatsAppGroup;
  onEdit: () => void;
  onRemove: () => void;
  onReload: () => Promise<void>;
}) {
  const t = useTranslations("clients.detail.waGroups");
  const [recent, setRecent] = useState<WhatsAppGroupAlert[]>(group.recent);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ variant: "error" | "success" | "info"; text: string } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setRecent(group.recent), [group.recent]);
  useEffect(() => () => {
    if (poll.current) clearInterval(poll.current);
  }, []);

  async function toggleActive() {
    setBusy(true);
    setMessage(null);
    try {
      await updateWhatsAppGroup(clientId, group.id, { is_active: !group.is_active });
      await onReload();
    } catch (e) {
      setMessage({ variant: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setMessage(null);
    try {
      const res = await testWhatsAppGroup(clientId, group.id);
      const alertId = res.alert?.id;
      setMessage({ variant: "info", text: t("testQueued") });
      if (!alertId) return;

      // Follow the test until WhatsApp confirms a member's phone got it (or it fails).
      let ticks = 0;
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        ticks++;
        try {
          const { alerts } = await getWhatsAppGroupAlerts(clientId, group.id, 10);
          setRecent(alerts);
          const test = alerts.find((a) => a.id === alertId);
          if (test?.status === "DELIVERED") {
            setMessage({ variant: "success", text: t("testDelivered") });
          } else if (test?.status === "SENT") {
            setMessage({ variant: "info", text: t("testSent") });
          } else if (test && SETTLED.includes(test.status)) {
            setMessage({ variant: "error", text: t("testFailed", { error: test.error ?? test.status }) });
          }
          if ((test && SETTLED.includes(test.status)) || ticks >= 20) {
            if (poll.current) clearInterval(poll.current);
            poll.current = null;
            setTesting(false);
            if (test?.status === "SENT" && ticks >= 20) setMessage({ variant: "info", text: t("testSentNoReceipt") });
          }
        } catch {
          /* keep polling */
        }
      }, 3000);
    } catch (e) {
      setTesting(false);
      setMessage({ variant: "error", text: errorText(e) });
    }
  }

  const counts = group.last_24h;
  const delivered = (counts.DELIVERED ?? 0) + (counts.SENT ?? 0);
  const failed = counts.FAILED ?? 0;
  const waiting = (counts.PENDING ?? 0) + (counts.QUEUED ?? 0) + (counts.SENDING ?? 0);

  return (
    <div className={cn("rounded-xl border p-4", !group.is_active && "opacity-70")} data-testid={`wa-group-${group.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="truncate">{group.name}</span>
            {group.label && <StatusChip tone="accent">{group.label}</StatusChip>}
            <StatusChip tone={group.is_active ? "good" : "neutral"} dot>
              {group.is_active ? t("on") : t("paused")}
            </StatusChip>
            <span className="text-muted-foreground text-[11px] font-normal">{group.language === "ar" ? t("langAr") : t("langEn")}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {group.events.length === 0 ? (
              <span className="text-muted-foreground text-xs">{t("noEvents")}</span>
            ) : (
              group.events.map((e) => (
                <StatusChip key={e} tone="neutral">
                  {e === "SESSION_NOT_MARKED"
                    ? t("eventShortMinutes", { event: t(`events.${e}.label`), n: group.settings.not_marked_after_minutes })
                    : e === "REPORT_OVERDUE"
                      ? t("eventShortHours", { event: t(`events.${e}.label`), n: group.settings.report_overdue_hours })
                      : t(`events.${e}.label`)}
                </StatusChip>
              ))
            )}
          </div>
          <p className="text-muted-foreground mt-2 text-[11px]">
            {t("last24h", { delivered, failed, waiting })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={testing || !group.is_active} onClick={() => void sendTest()} data-testid="wa-group-test">
            {testing ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            {t("test")}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleActive()}>
            {group.is_active ? t("pause") : t("resume")}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={t("edit")}>
            <Pencil aria-hidden />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label={t("remove")}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      {message && <AlertBanner variant={message.variant} className="mt-3" message={message.text} onDismiss={() => setMessage(null)} />}

      <div className="mt-3 border-t pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">{t("recent")}</p>
          <button type="button" onClick={() => void onReload()} className="text-muted-foreground hover:text-foreground rounded p-1" aria-label={t("refresh")}>
            <RefreshCw className="size-3" aria-hidden />
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="text-muted-foreground py-2 text-xs">{t("noAlerts")}</p>
        ) : (
          <ul className="divide-y">
            {recent.map((a) => (
              <AlertLine key={a.id} alert={a} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AlertLine({ alert }: { alert: WhatsAppGroupAlert }) {
  const t = useTranslations("clients.detail.waGroups");
  const locale = useLocale();
  const view = STATUS_VIEW[alert.status];
  const at = alert.delivered_at ?? alert.sent_at ?? alert.queued_at ?? alert.due_at ?? alert.created_at;
  const p = alert.payload as Record<string, string | number | null | undefined>;

  const subject = (() => {
    switch (alert.event_type) {
      case "SESSION_STARTED":
      case "SESSION_NOT_MARKED":
      case "REPORT_OVERDUE":
        return [p.teacher, p.student].filter(Boolean).join(" → ");
      case "PACKAGE_LOW":
      case "PACKAGE_ENDED":
        return [p.student, p.label].filter(Boolean).join(" — ");
      case "PAYMENT_RECEIVED":
        return [
          typeof p.amount_minor === "number"
            ? `${(p.amount_minor / 100).toLocaleString(locale)} ${p.currency ?? ""}`.trim()
            : null,
          p.payer,
        ]
          .filter(Boolean)
          .join(" — ");
      default:
        return "";
    }
  })();

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
      <span className="min-w-0 truncate">
        <span className="font-medium">{t(alert.event_type === "TEST" ? "events.TEST" : `events.${alert.event_type}.label`)}</span>
        {subject && <span className="text-muted-foreground"> · {subject}</span>}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-muted-foreground tabular-nums">
          {at ? new Date(at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—"}
        </span>
        <StatusChip
          tone={view.tone}
          icon={view.icon}
          title={alert.error ?? undefined}
        >
          {t(`status.${alert.status}`)}
          {alert.status === "FAILED" && alert.attempts > 1 ? ` ×${alert.attempts}` : ""}
        </StatusChip>
      </span>
    </li>
  );
}

function GroupFormModal({
  clientId,
  catalog,
  group,
  onClose,
  onSaved,
}: {
  clientId: string;
  catalog: WhatsAppGroupCatalog;
  group: WhatsAppGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("clients.detail.waGroups");
  const isNew = group === null;

  const [available, setAvailable] = useState<AvailableWhatsAppGroup[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  const [jid, setJid] = useState("");
  const [label, setLabel] = useState(group?.label ?? "");
  const [language, setLanguage] = useState<"ar" | "en">(group?.language ?? "ar");
  const [events, setEvents] = useState<WhatsAppGroupEvent[]>(group?.events ?? []);
  const [settings, setSettings] = useState<WhatsAppGroupSettings>(group?.settings ?? catalog.default_settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAvailable = useCallback(async () => {
    setListing(true);
    setListError(null);
    try {
      setAvailable((await getAvailableWhatsAppGroups(clientId)).groups);
    } catch (e) {
      setAvailable([]);
      setListError(errorText(e));
    } finally {
      setListing(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (isNew) void loadAvailable();
  }, [isNew, loadAvailable]);

  function applyPreset(category: "SUPERVISION" | "ACCOUNTING") {
    setLabel(t(`presets.${category}`));
    setEvents(catalog.categories[category]);
  }

  const toggle = (e: WhatsAppGroupEvent) =>
    setEvents((list) => (list.includes(e) ? list.filter((x) => x !== e) : [...list, e]));

  async function save() {
    setSaving(true);
    setError(null);
    const body = { label: label.trim() || null, language, events, settings };
    try {
      if (isNew) await linkWhatsAppGroup(clientId, { jid, ...body });
      else await updateWhatsAppGroup(clientId, group.id, body);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const setTiming = (key: keyof WhatsAppGroupSettings, value: number) =>
    setSettings((s) => ({ ...s, [key]: value }));

  return (
    <Modal
      open
      size="lg"
      title={isNew ? t("linkTitle") : t("editTitle")}
      description={isNew ? t("linkHint") : group.name}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button disabled={saving || (isNew && jid === "")} onClick={() => void save()} data-testid="wa-group-save">
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            {isNew ? t("linkSave") : t("save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <AlertBanner variant="error" message={error} />}

        {isNew && (
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold">{t("pickGroup")}</label>
              <button type="button" onClick={() => void loadAvailable()} disabled={listing} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px]">
                <RefreshCw className={cn("size-3", listing && "animate-spin")} aria-hidden />
                {t("refreshGroups")}
              </button>
            </div>
            {listError ? (
              <AlertBanner variant="error" message={listError} />
            ) : available === null ? (
              <div className="bg-muted h-24 animate-pulse rounded-lg" aria-hidden />
            ) : available.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">{t("noGroupsOnNumber")}</p>
            ) : (
              <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border" role="radiogroup" aria-label={t("pickGroup")}>
                {available.map((g) => {
                  const disabled = g.linked || !g.can_send;
                  return (
                    <li key={g.id}>
                      <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm", disabled && "cursor-not-allowed opacity-50", jid === g.id && "bg-primary/5")}>
                        <input
                          type="radio"
                          name="wa-group"
                          value={g.id}
                          checked={jid === g.id}
                          disabled={disabled}
                          onChange={() => setJid(g.id)}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{g.subject || g.id}</span>
                        <span className="text-muted-foreground text-[11px]">
                          {g.linked ? t("alreadyLinked") : !g.can_send ? t("adminsOnly") : t("members", { n: g.size })}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-muted-foreground mt-1.5 text-[11px]">{t("pickGroupHint")}</p>
          </section>
        )}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor="wa-group-label">{t("label")}</label>
            <input
              id="wa-group-label"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("labelPlaceholder")}
              className="bg-background w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-semibold">{t("language")}</span>
            <div className="inline-flex rounded-lg border p-0.5">
              {(["ar", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLanguage(l)}
                  aria-pressed={language === l}
                  className={cn("rounded-md px-3 py-1 text-xs font-medium", language === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {l === "ar" ? t("langAr") : t("langEn")}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold">{t("alerts")}</span>
            <span className="flex gap-1.5">
              {(["SUPERVISION", "ACCOUNTING"] as const).map((c) => (
                <Button key={c} size="xs" variant="outline" onClick={() => applyPreset(c)}>
                  {t("usePreset", { preset: t(`presets.${c}`) })}
                </Button>
              ))}
            </span>
          </div>

          {(["SUPERVISION", "ACCOUNTING"] as const).map((category) => (
            <fieldset key={category} className="rounded-lg border p-3">
              <legend className="text-muted-foreground px-1 text-[11px] font-semibold uppercase tracking-wide">
                {t(`categories.${category}`)}
              </legend>
              <div className="space-y-2.5">
                {catalog.categories[category].map((e) => (
                  <div key={e} className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                      <input type="checkbox" className="mt-0.5" checked={events.includes(e)} onChange={() => toggle(e)} data-testid={`wa-event-${e}`} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{t(`events.${e}.label`)}</span>
                        <span className="text-muted-foreground block text-xs">{t(`events.${e}.desc`)}</span>
                      </span>
                    </label>
                    {e === "SESSION_NOT_MARKED" && events.includes(e) && (
                      <TimingInput
                        id="wa-not-marked"
                        value={settings.not_marked_after_minutes}
                        unit={t("minutes")}
                        bounds={catalog.setting_bounds.not_marked_after_minutes}
                        onChange={(v) => setTiming("not_marked_after_minutes", v)}
                      />
                    )}
                    {e === "REPORT_OVERDUE" && events.includes(e) && (
                      <TimingInput
                        id="wa-report-hours"
                        value={settings.report_overdue_hours}
                        unit={t("hours")}
                        bounds={catalog.setting_bounds.report_overdue_hours}
                        onChange={(v) => setTiming("report_overdue_hours", v)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </section>
      </div>
    </Modal>
  );
}

/**
 * A bounded whole-number field that lets the operator clear it and type: the draft is free text,
 * only an in-range number is committed while typing, and leaving the field clamps whatever is left.
 */
function TimingInput({
  id,
  value,
  unit,
  bounds,
  onChange,
}: {
  id: string;
  value: number;
  unit: string;
  bounds: [number, number];
  onChange: (value: number) => void;
}) {
  const [min, max] = bounds;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <span className="flex items-center gap-1.5 ps-6 sm:ps-0">
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => {
          const n = Math.round(Number(draft));
          const clamped = Number.isFinite(n) && draft !== "" ? Math.min(max, Math.max(min, n)) : value;
          onChange(clamped);
          setDraft(String(clamped));
        }}
        className="bg-background w-16 rounded-md border px-2 py-1 text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
      />
      <label htmlFor={id} className="text-muted-foreground text-xs">{unit}</label>
    </span>
  );
}
