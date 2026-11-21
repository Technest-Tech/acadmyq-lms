"use client";

import {
  ArrowLeft,
  CheckCheck,
  CircleDot,
  Inbox,
  LifeBuoy,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  MessagesSquare,
  Plus,
  SendHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { Field, fieldClass } from "@/components/admin/field";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PageHero } from "@/components/ui/page-hero";
import { SegmentTile, type TileTone } from "@/components/ui/segment-tile";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import {
  SUPPORT_CLOSED,
  SUPPORT_OPEN,
  createSupportRequest,
  getSupportRequest,
  getSupportRequests,
  replySupportRequest,
  withdrawSupportRequest,
  type SupportKind,
  type SupportListResult,
  type SupportRequestDetail,
  type SupportRequestRow,
} from "@/lib/support-api";
import { formatLocalDateTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  AttachButton,
  KIND_ICON,
  PickedFiles,
  SupportKindChip,
  SupportStatusChip,
  SupportThread,
  UrgentChip,
  textareaClass,
  useComposer,
} from "./support-ui";

type View = "all" | "open" | "waiting" | "closed";

/** Tells the sidebar badge to read again — a request was opened, answered or raised. */
export function announceSupportChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("support:changed"));
}

/**
 * The academy's Support page (/support): every problem and change request it raised — or that the
 * support team logged for it — with where each one stands, and the conversation under each.
 *
 * `?new=1` opens the new-request form (`&page=/students` says which page it is about — the help
 * drawer links here that way); `?r=<id>` opens one request.
 */
export function SupportPage() {
  const t = useTranslations("support");
  const locale = useLocale();
  const toast = useToast();

  const [data, setData] = useState<SupportListResult | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<View>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ page: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getSupportRequests());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const r = params.get("r");
    if (r) setOpenId(r);
    if (params.get("new") === "1") setForm({ page: params.get("page") });
  }, [load]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    switch (view) {
      case "open":
        return all.filter((r) => SUPPORT_OPEN.includes(r.status));
      case "waiting":
        return all.filter((r) => r.status === "WAITING");
      case "closed":
        return all.filter((r) => SUPPORT_CLOSED.includes(r.status));
      default:
        return all;
    }
  }, [data, view]);

  const n = (v: number) => formatNumber(v, locale);
  const total = data?.rows.length ?? 0;
  const share = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  const tiles: { key: View; icon: LucideIcon; tone: TileTone; value: number }[] = [
    { key: "all", icon: ListChecks, tone: "slate", value: total },
    { key: "open", icon: CircleDot, tone: "emerald", value: data?.counts.open ?? 0 },
    { key: "waiting", icon: MessageCircleQuestion, tone: "gold", value: data?.counts.waiting ?? 0 },
    { key: "closed", icon: CheckCheck, tone: "teal", value: data?.counts.closed ?? 0 },
  ];

  const opened = (id: string) => {
    setOpenId(id);
    // Opening it reads the answer: the row loses its dot without waiting for a reload.
    setData((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            rows: prev.rows.map((r) => (r.id === id ? { ...r, unread: false } : r)),
            counts: { ...prev.counts, unread: prev.rows.filter((r) => r.unread && r.id !== id).length },
          },
    );
  };

  if (openId !== null) {
    return (
      <AcademyRequestView
        id={openId}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="space-y-5" data-testid="support-page">
      <PageHero
        icon={LifeBuoy}
        title={t("title")}
        subtitle={t("subtitle")}
        latticeId="support-hero"
        actions={
          <Button
            onClick={() => setForm({ page: null })}
            className="bg-white text-slate-900 hover:bg-white/90"
            data-testid="support-new"
          >
            <Plus aria-hidden />
            {t("new")}
          </Button>
        }
      />

      <ol className="text-muted-foreground grid gap-2 text-xs sm:grid-cols-3">
        {(["send", "review", "done"] as const).map((step, i) => (
          <li key={step} className="bg-card flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ring-foreground/[0.06]">
            <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
              {n(i + 1)}
            </span>
            <span>{t(`how.${step}`)}</span>
          </li>
        ))}
      </ol>

      {error && <p className="text-destructive text-sm">{t("loadFailed")}</p>}

      {data !== null && total > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <SegmentTile
              key={tile.key}
              testKey={`support-tile-${tile.key}`}
              icon={tile.icon}
              label={t(`tiles.${tile.key}`)}
              value={tile.value}
              share={tile.key === "all" ? null : share(tile.value)}
              tone={tile.tone}
              selected={view === tile.key}
              onSelect={() => setView(tile.key)}
            />
          ))}
        </div>
      )}

      {data === null && !error ? (
        <div className="flex justify-center py-16">
          <Loader2 className="text-muted-foreground size-5 animate-spin" aria-label="…" />
        </div>
      ) : data !== null && total === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          message={t("empty")}
          action={
            <Button onClick={() => setForm({ page: null })}>
              <Plus aria-hidden />
              {t("new")}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        data !== null && <EmptyState icon={Inbox} message={t("emptyFilter")} />
      ) : (
        <ul className="space-y-2.5" data-testid="support-list">
          {rows.map((row) => (
            <RequestCard key={row.id} row={row} onOpen={() => opened(row.id)} />
          ))}
        </ul>
      )}

      <NewRequestModal
        open={form !== null}
        page={form?.page ?? null}
        onClose={() => setForm(null)}
        onCreated={(detail) => {
          setForm(null);
          toast.success(t("sent", { n: n(detail.request.number) }));
          announceSupportChange();
          void load();
        }}
      />
    </div>
  );
}

function RequestCard({ row, onOpen }: { row: SupportRequestRow; onOpen: () => void }) {
  const t = useTranslations("support");
  const locale = useLocale();
  const Icon = KIND_ICON[row.kind];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="support-row"
        className={cn(
          "bg-card group flex w-full items-start gap-3 rounded-xl p-4 text-start shadow-sm ring-1 ring-foreground/[0.06] transition hover:ring-foreground/15",
          row.unread && "ring-primary/30",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
            row.kind === "PROBLEM"
              ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              : "bg-violet-500/10 text-violet-600 dark:text-violet-400",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-xs font-semibold tabular-nums">
              {t("number", { n: formatNumber(row.number, locale) })}
            </span>
            <SupportStatusChip status={row.status} audience="academy" />
            {row.priority === "URGENT" && <UrgentChip />}
            {row.unread && (
              <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[11px] font-semibold">
                {t("unread")}
              </span>
            )}
          </span>
          <span className="mt-1 block font-semibold break-words">{row.title}</span>
          <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span>{t(`kind.${row.kind}`)}</span>
            <span>{row.source === "ADMIN" ? t("loggedByTeam") : row.createdBy ? t("sentBy", { name: row.createdBy }) : null}</span>
            <span title={formatLocalDateTime(row.lastActivityAt, locale)}>
              {t("updated", { when: formatRelativeTime(row.lastActivityAt, locale) })}
            </span>
            {row.replies > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessagesSquare className="size-3" aria-hidden />
                {formatNumber(row.replies, locale)}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

/** One request: its header, the conversation and the reply box. */
function AcademyRequestView({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useTranslations("support");
  const locale = useLocale();
  const toast = useToast();
  const composer = useComposer();
  const [detail, setDetail] = useState<SupportRequestDetail | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  useEffect(() => {
    let alive = true;
    getSupportRequest(id)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        announceSupportChange();
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [id]);

  const fail = (e: unknown) => toast.error(e instanceof ApiError && e.message ? e.message : t("failed"));

  const send = async () => {
    if (composer.text.trim() === "" && composer.files.length === 0) {
      composer.setError(t("composer.empty"));
      return;
    }
    setBusy(true);
    try {
      setDetail(await replySupportRequest(id, composer.text.trim(), composer.files));
      composer.reset();
      toast.success(t("replied"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!confirmWithdraw) {
      setConfirmWithdraw(true);
      return;
    }
    setBusy(true);
    try {
      setDetail(await withdrawSupportRequest(id));
      toast.success(t("withdrawn"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setConfirmWithdraw(false);
    }
  };

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
      {t("back")}
    </button>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <p className="text-destructive text-sm">{t("loadFailed")}</p>
      </div>
    );
  }
  if (detail === null) {
    return (
      <div className="space-y-4">
        {back}
        <div className="flex justify-center py-16">
          <Loader2 className="text-muted-foreground size-5 animate-spin" aria-label="…" />
        </div>
      </div>
    );
  }

  const r = detail.request;
  const closed = r.status === "REJECTED" || r.status === "CANCELLED";

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="support-request">
      {back}

      <header className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-sm font-semibold tabular-nums">
            {t("number", { n: formatNumber(r.number, locale) })}
          </span>
          <SupportKindChip kind={r.kind} />
          <SupportStatusChip status={r.status} audience="academy" />
          {r.priority === "URGENT" && <UrgentChip />}
        </div>
        <h1 className="mt-2 text-lg font-bold break-words">{r.title}</h1>
        <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          <span>{r.source === "ADMIN" ? t("loggedByTeam") : r.createdBy ? t("sentBy", { name: r.createdBy }) : null}</span>
          <span title={formatLocalDateTime(r.createdAt, locale)}>{formatLocalDateTime(r.createdAt, locale)}</span>
          {r.page && <span dir="ltr">{t("page", { page: r.page })}</span>}
        </p>
      </header>

      {r.status === "WAITING" && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/60">
          {t("waitingBanner")}
        </p>
      )}

      <SupportThread
        detail={detail}
        audience="academy"
        composer={
          closed ? (
            <p className="text-muted-foreground bg-muted/40 rounded-xl px-4 py-3 text-center text-sm">{t("closedNote")}</p>
          ) : (
            <div className="bg-card space-y-2 rounded-xl p-3 shadow-sm ring-1 ring-foreground/[0.06]">
              <textarea
                value={composer.text}
                onChange={(e) => composer.setText(e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder={t("composer.placeholder")}
                className={textareaClass}
                data-testid="support-reply"
              />
              <PickedFiles composer={composer} />
              {composer.error && <p className="text-destructive text-xs">{composer.error}</p>}
              {r.status === "DONE" && <p className="text-muted-foreground text-xs">{t("reopenHint")}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <AttachButton composer={composer} disabled={busy} />
                  {r.status === "NEW" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void withdraw()}
                      disabled={busy}
                      className="text-muted-foreground"
                      data-testid="support-withdraw"
                    >
                      {confirmWithdraw ? t("withdrawConfirm") : t("withdraw")}
                    </Button>
                  )}
                </div>
                <Button onClick={() => void send()} disabled={busy} data-testid="support-send">
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : <SendHorizontal className="rtl:rotate-180" aria-hidden />}
                  {t("composer.send")}
                </Button>
              </div>
            </div>
          )
        }
      />
    </div>
  );
}

/** Raise a problem or a change request: the type, a title, the details, urgent or not, screenshots. */
export function NewRequestModal({
  open,
  page,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** The in-app page the request is about, when opened from one. */
  page: string | null;
  onClose: () => void;
  onCreated: (detail: SupportRequestDetail) => void;
}) {
  const t = useTranslations("support");
  const toast = useToast();
  const composer = useComposer();
  const [kind, setKind] = useState<SupportKind>("PROBLEM");
  const [title, setTitle] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind("PROBLEM");
    setTitle("");
    setUrgent(false);
    setTitleError(null);
    composer.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset once per opening
  }, [open]);

  const submit = async () => {
    if (title.trim() === "") {
      setTitleError(t("form.titleRequired"));
      return;
    }
    setBusy(true);
    try {
      const detail = await createSupportRequest({
        kind,
        title: title.trim(),
        body: composer.text.trim(),
        priority: urgent ? "URGENT" : "NORMAL",
        page,
        files: composer.files,
      });
      onCreated(detail);
    } catch (e) {
      toast.error(e instanceof ApiError && e.message ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("form.title")}
      description={t("form.description")}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy} data-testid="support-submit">
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("form.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-xs font-medium">{t("form.kind")}</span>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("form.kind")}>
            {(["PROBLEM", "CHANGE"] as const).map((k) => {
              const Icon = KIND_ICON[k];
              const on = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKind(k)}
                  data-testid={`support-kind-${k}`}
                  className={cn(
                    "flex items-start gap-3 rounded-xl p-3 text-start ring-1 transition",
                    on ? "bg-primary/[0.06] ring-primary/40" : "ring-foreground/10 hover:ring-foreground/25",
                  )}
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  <span>
                    <span className="block text-sm font-semibold">{t(`kind.${k}`)}</span>
                    <span className="text-muted-foreground block text-xs">{t(`kindHint.${k}`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Field label={t("form.titleLabel")} error={titleError ?? undefined}>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleError(null);
            }}
            maxLength={200}
            placeholder={t(`form.titlePlaceholder.${kind}`)}
            className={fieldClass}
            data-testid="support-title"
          />
        </Field>

        <Field label={t("form.body")}>
          <textarea
            value={composer.text}
            onChange={(e) => composer.setText(e.target.value)}
            rows={5}
            maxLength={5000}
            placeholder={t(`form.bodyPlaceholder.${kind}`)}
            className={textareaClass}
            data-testid="support-body"
          />
        </Field>

        <div className="space-y-2">
          <span className="block text-xs font-medium">{t("form.files")}</span>
          <PickedFiles composer={composer} />
          <div className="flex flex-wrap items-center gap-2">
            <AttachButton composer={composer} disabled={busy} />
            <span className="text-muted-foreground text-xs">{t("form.filesHint")}</span>
          </div>
          {composer.error && <p className="text-destructive text-xs">{composer.error}</p>}
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ring-foreground/10">
          <span className="text-sm font-medium">{t("form.urgent")}</span>
          <Switch
            checked={urgent}
            onChange={(e) => setUrgent(e.target.checked)}
            aria-label={t("form.urgent")}
            data-testid="support-urgent"
          />
        </label>

        {page && (
          <p className="text-muted-foreground text-xs" dir="auto">
            {t("form.page", { page })}
          </p>
        )}
      </div>
    </Modal>
  );
}
