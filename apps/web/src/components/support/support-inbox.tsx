"use client";

import {
  ArrowLeft,
  ExternalLink,
  Flame,
  Inbox,
  Loader2,
  MessagesSquare,
  NotebookPen,
  RefreshCw,
  Search,
  SendHorizontal,
  StickyNote,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { Field, fieldClass } from "@/components/admin/field";
import { clientTabHref } from "@/components/clients/client-summary";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ApiError, listClients } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import {
  getSupportInbox,
  getSupportInboxRequest,
  logSupportRequest,
  respondSupportRequest,
  updateSupportRequest,
  type SupportInboxFilter,
  type SupportInboxResult,
  type SupportKind,
  type SupportRequestDetail,
  type SupportRequestRow,
  type SupportStatus,
} from "@/lib/support-api";
import { formatLocalDateTime, formatRelativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { announceSupportChange } from "./support-page";
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

const FILTERS: readonly SupportInboxFilter[] = ["UNREAD", "OPEN", "NEW", "IN_PROGRESS", "WAITING", "DONE", "REJECTED", "ALL"];

/** A status the team can only set with words the client reads. Mirrors SupportRequests::NEEDS_WORDS. */
const NEEDS_WORDS: readonly SupportStatus[] = ["WAITING", "REJECTED"];

type Action = { key: "accept" | "ask" | "done" | "reject" | "reopen"; to: SupportStatus };

/** The moves offered from each status — never one that would change nothing. */
function actionsFor(status: SupportStatus): Action[] {
  switch (status) {
    case "NEW":
      return [
        { key: "accept", to: "IN_PROGRESS" },
        { key: "ask", to: "WAITING" },
        { key: "done", to: "DONE" },
        { key: "reject", to: "REJECTED" },
      ];
    case "IN_PROGRESS":
      return [
        { key: "ask", to: "WAITING" },
        { key: "done", to: "DONE" },
        { key: "reject", to: "REJECTED" },
      ];
    case "WAITING":
      return [
        { key: "accept", to: "IN_PROGRESS" },
        { key: "done", to: "DONE" },
        { key: "reject", to: "REJECTED" },
      ];
    default:
      return [{ key: "reopen", to: "IN_PROGRESS" }];
  }
}

/**
 * The platform team's support inbox: every client's requests (the /admin/support page), or one
 * client's (its page's "Requests" tab, `academyId` set). Filter pills count the whole inbox; a row
 * opens the request with its conversation and the moves — accept, ask, done, decline, reply,
 * internal note.
 */
export function SupportInbox({ academyId, academyName }: { academyId?: string; academyName?: string }) {
  const t = useTranslations("adminSupport");
  const ts = useTranslations("support");
  const locale = useLocale();

  const [filter, setFilter] = useState<SupportInboxFilter>(academyId ? "ALL" : "OPEN");
  const [kind, setKind] = useState<SupportKind | "">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SupportInboxResult | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);

  // Typing settles for a moment before the inbox is asked again.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getSupportInbox({ status: filter, academyId, kind, search: query, page }));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [filter, academyId, kind, query, page]);

  useEffect(() => {
    if (openId === null) void load();
  }, [load, openId]);

  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("r");
    if (r) setOpenId(r);
  }, []);

  const n = (v: number) => formatNumber(v, locale);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  if (openId !== null) {
    return <AdminRequestView id={openId} inClientPage={academyId !== undefined} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="space-y-4" data-testid="support-inbox">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {FILTERS.map((f) => {
          const count = data?.counts[f] ?? null;
          const on = filter === f;
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setFilter(f);
                setPage(1);
              }}
              data-testid={`support-filter-${f}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                on
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-card text-muted-foreground ring-foreground/10 hover:text-foreground hover:ring-foreground/25",
              )}
            >
              {t(`tiles.${f}`)}
              {count !== null && count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 tabular-nums",
                    on ? "bg-white/20" : f === "UNREAD" ? "bg-rose-500 text-white" : "bg-muted",
                  )}
                >
                  {n(count)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search")}
            className={cn(fieldClass, "ps-9")}
            data-testid="support-search"
          />
        </div>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as SupportKind | "");
            setPage(1);
          }}
          className={cn(fieldClass, "w-auto")}
          aria-label={t("kindAll")}
        >
          <option value="">{t("kindAll")}</option>
          <option value="PROBLEM">{ts("kind.PROBLEM")}</option>
          <option value="CHANGE">{ts("kind.CHANGE")}</option>
        </select>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground rounded-lg border p-2 transition-colors disabled:opacity-50"
          aria-label={t("refresh")}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden />
        </button>
        <Button onClick={() => setLogging(true)} data-testid="support-log">
          <NotebookPen aria-hidden />
          {t("log.button")}
        </Button>
      </div>

      {error && <p className="text-destructive text-sm">{t("loadFailed")}</p>}

      {data === null && !error ? (
        <div className="flex justify-center py-12">
          <Loader2 className="text-muted-foreground size-5 animate-spin" aria-label="…" />
        </div>
      ) : data !== null && data.rows.length === 0 ? (
        <EmptyState icon={Inbox} message={t("empty")} />
      ) : (
        data !== null && (
          <ul className="admin-surface bg-card divide-y overflow-hidden rounded-xl shadow-sm ring-1 ring-foreground/[0.06]" data-testid="support-inbox-list">
            {data.rows.map((row) => (
              <InboxRow key={row.id} row={row} showClient={academyId === undefined} onOpen={() => setOpenId(row.id)} />
            ))}
          </ul>
        )
      )}

      {data !== null && pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("pager.prev")}
          </Button>
          <span className="text-muted-foreground text-xs">{t("pager.of", { page: n(page), pages: n(pages) })}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t("pager.next")}
          </Button>
        </div>
      )}

      <LogRequestModal
        open={logging}
        academyId={academyId}
        academyName={academyName}
        onClose={() => setLogging(false)}
        onLogged={() => {
          setLogging(false);
          void load();
        }}
      />
    </div>
  );
}

function InboxRow({ row, showClient, onOpen }: { row: SupportRequestRow; showClient: boolean; onOpen: () => void }) {
  const t = useTranslations("adminSupport");
  const ts = useTranslations("support");
  const locale = useLocale();
  const Icon = KIND_ICON[row.kind];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="support-inbox-row"
        className="hover:bg-muted/40 flex w-full items-start gap-3 px-4 py-3 text-start transition-colors"
      >
        <span className="relative mt-0.5 shrink-0">
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              row.kind === "PROBLEM"
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "bg-violet-500/10 text-violet-600 dark:text-violet-400",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
          {row.unread && (
            <span className="ring-card absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-rose-500 ring-2" aria-label={ts("unread")} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            {showClient && row.academy && <span className="text-sm font-semibold">{row.academy.name}</span>}
            <span className="text-muted-foreground text-xs tabular-nums">{ts("number", { n: formatNumber(row.number, locale) })}</span>
            <SupportStatusChip status={row.status} audience="admin" />
            {row.priority === "URGENT" && <UrgentChip />}
          </span>
          <span className={cn("mt-0.5 block break-words", row.unread ? "font-semibold" : "font-medium")}>{row.title}</span>
          <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
            <span>{ts(`kind.${row.kind}`)}</span>
            {row.createdBy && (
              <span>{row.source === "ADMIN" ? t("loggedBy", { name: row.createdBy }) : ts("sentBy", { name: row.createdBy })}</span>
            )}
            {row.replies > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessagesSquare className="size-3" aria-hidden />
                {formatNumber(row.replies, locale)}
              </span>
            )}
          </span>
        </span>
        <span className="text-muted-foreground shrink-0 text-xs" title={formatLocalDateTime(row.lastActivityAt, locale)}>
          {formatRelativeTime(row.lastActivityAt, locale)}
        </span>
      </button>
    </li>
  );
}

/** One request, the team's view: everything including internal notes, plus the moves. */
function AdminRequestView({ id, inClientPage, onBack }: { id: string; inClientPage: boolean; onBack: () => void }) {
  const t = useTranslations("adminSupport");
  const ts = useTranslations("support");
  const locale = useLocale();
  const toast = useToast();
  const composer = useComposer();
  const [detail, setDetail] = useState<SupportRequestDetail | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [internal, setInternal] = useState(false);

  useEffect(() => {
    let alive = true;
    getSupportInboxRequest(id)
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

  const act = async (action: Action | null) => {
    const text = composer.text.trim();
    if (action && NEEDS_WORDS.includes(action.to) && text === "") {
      composer.setError(t(`needsWords.${action.to as "WAITING" | "REJECTED"}`));
      return;
    }
    if (!action && text === "" && composer.files.length === 0) {
      composer.setError(ts("composer.empty"));
      return;
    }
    setBusy(action?.key ?? "send");
    try {
      setDetail(
        await respondSupportRequest(id, {
          body: text,
          status: action?.to ?? null,
          internal: action ? false : internal,
          files: composer.files,
        }),
      );
      composer.reset();
      toast.success(t("saved"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const patch = async (change: Parameters<typeof updateSupportRequest>[1]) => {
    setBusy("patch");
    try {
      setDetail(await updateSupportRequest(id, change));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
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

  if (error || detail === null) {
    return (
      <div className="space-y-4">
        {back}
        {error ? (
          <p className="text-destructive text-sm">{t("loadFailed")}</p>
        ) : (
          <div className="flex justify-center py-12">
            <Loader2 className="text-muted-foreground size-5 animate-spin" aria-label="…" />
          </div>
        )}
      </div>
    );
  }

  const r = detail.request;
  const other: SupportKind = r.kind === "PROBLEM" ? "CHANGE" : "PROBLEM";

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="support-admin-request">
      {back}

      <header className="admin-surface bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-sm font-semibold tabular-nums">
                {ts("number", { n: formatNumber(r.number, locale) })}
              </span>
              <SupportKindChip kind={r.kind} />
              <SupportStatusChip status={r.status} audience="admin" />
              {r.priority === "URGENT" && <UrgentChip />}
            </div>
            <h2 className="mt-2 text-lg font-bold break-words">{r.title}</h2>
            <p className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {r.academy && <span className="text-foreground font-semibold">{r.academy.name}</span>}
              {r.createdBy && (
                <span>{r.source === "ADMIN" ? t("loggedBy", { name: r.createdBy }) : ts("sentBy", { name: r.createdBy })}</span>
              )}
              <span>{formatLocalDateTime(r.createdAt, locale)}</span>
              {r.page && <span dir="ltr">{ts("page", { page: r.page })}</span>}
            </p>
          </div>
          {!inClientPage && r.academy && (
            <Link
              href={clientTabHref(r.academy.id, "support")}
              className="text-primary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              {t("openClient")}
            </Link>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void patch({ priority: r.priority === "URGENT" ? "NORMAL" : "URGENT" })}
          >
            <Flame aria-hidden />
            {r.priority === "URGENT" ? t("markNormal") : t("markUrgent")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void patch({ kind: other })}>
            {t("switchKind", { kind: ts(`kind.${other}`) })}
          </Button>
        </div>
      </header>

      <SupportThread
        detail={detail}
        audience="admin"
        composer={
          <div
            className={cn(
              "admin-surface space-y-2 rounded-xl p-3 shadow-sm ring-1",
              internal ? "bg-amber-50/70 ring-amber-200 dark:bg-amber-950/20 dark:ring-amber-900/60" : "bg-card ring-foreground/[0.06]",
            )}
          >
            <label className="flex items-center gap-2 text-xs font-medium">
              <Switch
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
                data-testid="support-internal-toggle"
                aria-label={t("reply.internal")}
              />
              <StickyNote className="size-3.5 text-amber-600" aria-hidden />
              {t("reply.internal")}
            </label>
            <textarea
              value={composer.text}
              onChange={(e) => {
                composer.setText(e.target.value);
                composer.setError(null);
              }}
              rows={4}
              maxLength={5000}
              placeholder={internal ? t("reply.internalPlaceholder") : t("reply.placeholder")}
              className={textareaClass}
              data-testid="support-admin-reply"
            />
            <PickedFiles composer={composer} />
            {composer.error && <p className="text-destructive text-xs">{composer.error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <AttachButton composer={composer} disabled={busy !== null} />
              <div className="flex flex-wrap items-center gap-1.5">
                {!internal &&
                  actionsFor(r.status).map((a) => (
                    <Button
                      key={a.key}
                      variant={a.key === "reject" ? "destructive" : a.key === "done" ? "secondary" : "outline"}
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void act(a)}
                      data-testid={`support-action-${a.key}`}
                    >
                      {busy === a.key && <Loader2 className="animate-spin" aria-hidden />}
                      {t(`action.${a.key}`)}
                    </Button>
                  ))}
                <Button size="sm" disabled={busy !== null} onClick={() => void act(null)} data-testid="support-admin-send">
                  {busy === "send" ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <SendHorizontal className="rtl:rotate-180" aria-hidden />
                  )}
                  {internal ? t("reply.saveNote") : t("reply.send")}
                </Button>
              </div>
            </div>
          </div>
        }
      />
    </div>
  );
}

/**
 * Log something onto a client's page on its behalf: a problem we fixed, a change we made, a request
 * it made by phone. It shows on the client's Support page as raised by the support team.
 */
function LogRequestModal({
  open,
  academyId,
  academyName,
  onClose,
  onLogged,
}: {
  open: boolean;
  /** Set on a client's own page: the client is fixed. */
  academyId?: string;
  academyName?: string;
  onClose: () => void;
  onLogged: () => void;
}) {
  const t = useTranslations("adminSupport");
  const ts = useTranslations("support");
  const toast = useToast();
  const composer = useComposer();
  const [clients, setClients] = useState<{ value: string; label: string }[] | null>(null);
  const [client, setClient] = useState("");
  const [kind, setKind] = useState<SupportKind>("CHANGE");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<SupportStatus>("DONE");
  const [errors, setErrors] = useState<{ client?: string; title?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClient(academyId ?? "");
    setKind("CHANGE");
    setTitle("");
    setStatus("DONE");
    setErrors({});
    composer.reset();
    if (academyId === undefined && clients === null) {
      listClients()
        .then((r) =>
          setClients(
            r.clients
              .map((c) => ({ value: c.id, label: c.name }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          ),
        )
        .catch(() => setClients([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset once per opening
  }, [open]);

  const submit = async () => {
    const next: typeof errors = {};
    if (client === "") next.client = t("log.clientRequired");
    if (title.trim() === "") next.title = ts("form.titleRequired");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      await logSupportRequest({
        academyId: client,
        kind,
        title: title.trim(),
        body: composer.text.trim(),
        status,
        priority: "NORMAL",
        files: composer.files,
      });
      const name = academyName ?? clients?.find((c) => c.value === client)?.label ?? "";
      toast.success(t("log.done", { name }));
      onLogged();
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
      title={t("log.title")}
      description={t("log.description")}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {ts("form.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy} data-testid="support-log-submit">
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t("log.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {academyId === undefined ? (
          <Field label={t("log.client")} error={errors.client}>
            <Combobox
              options={clients ?? []}
              value={client}
              onChange={(v) => {
                setClient(v);
                setErrors((e) => ({ ...e, client: undefined }));
              }}
              placeholder={t("log.clientPlaceholder")}
              searchPlaceholder={t("log.clientPlaceholder")}
              data-testid="support-log-client"
            />
          </Field>
        ) : (
          academyName && <p className="text-sm font-semibold">{academyName}</p>
        )}

        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={ts("form.kind")}>
          {(["CHANGE", "PROBLEM"] as const).map((k) => {
            const Icon = KIND_ICON[k];
            const on = kind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(k)}
                className={cn(
                  "flex items-center gap-2 rounded-xl p-3 text-start text-sm font-semibold ring-1 transition",
                  on ? "bg-primary/[0.06] ring-primary/40" : "ring-foreground/10 hover:ring-foreground/25",
                )}
              >
                <Icon className={cn("size-4", on ? "text-primary" : "text-muted-foreground")} aria-hidden />
                {ts(`kind.${k}`)}
              </button>
            );
          })}
        </div>

        <Field label={ts("form.titleLabel")} error={errors.title}>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setErrors((x) => ({ ...x, title: undefined }));
            }}
            maxLength={200}
            className={fieldClass}
            data-testid="support-log-title"
          />
        </Field>

        <Field label={ts("form.body")}>
          <textarea
            value={composer.text}
            onChange={(e) => composer.setText(e.target.value)}
            rows={4}
            maxLength={5000}
            className={textareaClass}
          />
        </Field>

        <Field label={t("log.status")}>
          <select value={status} onChange={(e) => setStatus(e.target.value as SupportStatus)} className={fieldClass}>
            {(["DONE", "IN_PROGRESS", "NEW"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </Field>

        <div className="space-y-2">
          <PickedFiles composer={composer} />
          <AttachButton composer={composer} disabled={busy} />
          {composer.error && <p className="text-destructive text-xs">{composer.error}</p>}
        </div>
      </div>
    </Modal>
  );
}
