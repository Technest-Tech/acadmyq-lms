"use client";

import {
  ArchiveRestore,
  BookOpen,
  Briefcase,
  CalendarClock,
  Check,
  FileText,
  GraduationCap,
  Loader2,
  Package,
  Search,
  ShieldX,
  Trash2,
  UserRound,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/admin/section-card";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  getClientDeleted,
  restoreClientDeleted,
  type DeletedItem,
  type DeletedKind,
  type DeletedLogEntry,
  type RestoreLine,
  type RestoreReport,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { fmtDate } from "./client-summary";

const KIND_ICON: Record<DeletedKind, LucideIcon> = {
  family: UsersRound,
  student: GraduationCap,
  teacher: UserRound,
  staff: Briefcase,
  trial: CalendarClock,
  lead: Users,
  group: Users,
  course: BookOpen,
  post: FileText,
  product: Package,
};

const KIND_ORDER: DeletedKind[] = ["family", "student", "teacher", "staff", "group", "trial", "lead", "course", "post", "product"];

type Filter = DeletedKind | "all";

/**
 * The client page's "Deleted" tab: everything this client deleted, and the way back.
 *
 * A restore is looked at first — the preview runs the very restore on the server and rolls it
 * back, so the lines it shows (what comes back, what does not) are exactly what Restore will do.
 * Permanent deletes (a teacher deleted for good, a hand-made bill, a lesson) are listed below
 * for the record: their rows are gone, so there is nothing to restore.
 */
export function ClientDeletedTab({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.deleted");
  const locale = useLocale();
  const { can } = useAuth();
  const toast = useToast();
  const allowed = can("platform.manage");

  const [items, setItems] = useState<DeletedItem[] | null>(null);
  const [log, setLog] = useState<DeletedLogEntry[]>([]);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  /** The item whose preview is open, and that preview. */
  const [open, setOpen] = useState<{ item: DeletedItem; report: RestoreReport } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getClientDeleted(clientId);
      setItems(r.items);
      setLog(r.log);
      setError(false);
    } catch {
      setError(true);
    }
  }, [clientId]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const counts = useMemo(() => {
    const c: Partial<Record<DeletedKind, number>> = {};
    for (const i of items ?? []) c[i.kind] = (c[i.kind] ?? 0) + 1;
    return c;
  }, [items]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        (filter === "all" || i.kind === filter) &&
        (q === "" ||
          i.label.toLowerCase().includes(q) ||
          (i.detail.children ?? []).some((c) => c.toLowerCase().includes(q)) ||
          (i.detail.phone ?? "").includes(q)),
    );
  }, [items, filter, query]);

  if (!allowed) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const fail = (e: unknown) => toast.error(e instanceof ApiError && e.message ? e.message : t("failed"));

  const preview = async (item: DeletedItem) => {
    setBusy(item.id);
    try {
      const report = await restoreClientDeleted(clientId, item.kind, item.id, false);
      setOpen({ item, report });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const apply = async (item: DeletedItem) => {
    setBusy(item.id);
    try {
      await restoreClientDeleted(clientId, item.kind, item.id, true);
      toast.success(t("restored", { name: item.label }));
      setOpen(null);
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const line = (l: RestoreLine) =>
    t(`line.${l.key}`, { name: l.label ?? "—", n: formatNumber(l.n ?? 0, locale) });

  const kinds = KIND_ORDER.filter((k) => (counts[k] ?? 0) > 0);

  return (
    <div className="space-y-4" role="tabpanel" data-testid="client-deleted-tab">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">{t("title")}</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">{t("hint")}</p>
      </div>

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      {items === null && !error && (
        <div className="space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-16 animate-pulse rounded-xl" aria-hidden />
          ))}
        </div>
      )}

      {items !== null && (
        <SectionCard icon={ArchiveRestore} title={t("restorableTitle")} description={t("restorableHint")} testId="deleted-restorable">
          {items.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm" data-testid="deleted-empty">
              {t("empty")}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="no-scrollbar flex gap-1 overflow-x-auto" role="tablist">
                  {(["all", ...kinds] as Filter[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={filter === k}
                      onClick={() => setFilter(k)}
                      className={cn(
                        "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                        filter === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                      )}
                      data-testid={`deleted-filter-${k}`}
                    >
                      {t(`kinds.${k}`)}{" "}
                      <span className="tabular-nums opacity-70">
                        {formatNumber(k === "all" ? items.length : (counts[k] ?? 0), locale)}
                      </span>
                    </button>
                  ))}
                </div>
                <label className="relative block lg:w-64">
                  <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("search")}
                    aria-label={t("search")}
                    className="bg-background w-full rounded-lg border py-1.5 ps-8 pe-3 text-sm"
                    data-testid="deleted-search"
                  />
                </label>
              </div>

              {shown.length === 0 && <p className="text-muted-foreground py-4 text-center text-sm">{t("noMatch")}</p>}

              <ul className="divide-y rounded-xl border">
                {shown.map((item) => {
                  const Icon = KIND_ICON[item.kind];
                  const isOpen = open?.item.id === item.id;
                  const sub = subline(item, t, locale);
                  return (
                    <li key={`${item.kind}-${item.id}`} className="p-3" data-testid={`deleted-${item.kind}-${item.id}`}>
                      <div className="flex items-start gap-3">
                        <span className="bg-muted text-muted-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg">
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold break-words">
                            {item.label}
                            <span className="text-muted-foreground ms-2 text-xs font-normal">{t(`kind.${item.kind}`)}</span>
                          </p>
                          {sub && <p className="text-muted-foreground mt-0.5 text-xs break-words">{sub}</p>}
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {item.deleted_by
                              ? t("deletedOnBy", { date: fmtDate(item.deleted_at, locale), name: item.deleted_by })
                              : t("deletedOn", { date: fmtDate(item.deleted_at, locale) })}
                          </p>
                        </div>
                        {!isOpen && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => void preview(item)}
                            data-testid={`preview-${item.id}`}
                          >
                            {busy === item.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArchiveRestore className="size-3.5" aria-hidden />}
                            {t("restore")}
                          </Button>
                        )}
                      </div>

                      {isOpen && open && (
                        <div className="bg-muted/40 mt-3 space-y-3 rounded-lg p-3" data-testid={`report-${item.id}`}>
                          <p className="text-muted-foreground text-xs font-semibold">{t("previewNote")}</p>
                          {open.report.done.length > 0 && (
                            <div>
                              <p className="text-sm font-bold">{t("willReturn")}</p>
                              <ul className="mt-1 space-y-1">
                                {open.report.done.map((l, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm">
                                    <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                                    <span>{line(l)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {open.report.skipped.length > 0 && (
                            <div>
                              <p className="text-sm font-bold">{t("wontReturn")}</p>
                              <ul className="mt-1 space-y-1">
                                {open.report.skipped.map((l, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm" data-testid="report-skipped">
                                    <X className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                                    <span>{line(l)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setOpen(null)}>
                              {t("cancel")}
                            </Button>
                            <Button size="sm" disabled={busy !== null} onClick={() => void apply(item)} data-testid={`apply-${item.id}`}>
                              {busy === item.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ArchiveRestore className="size-3.5" aria-hidden />}
                              {t("confirm")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </SectionCard>
      )}

      {items !== null && log.length > 0 && (
        <SectionCard icon={ShieldX} title={t("logTitle")} description={t("logHint")} testId="deleted-log">
          <ul className="divide-y rounded-xl border">
            {log.map((e) => (
              <li key={e.id} className="flex items-start gap-3 p-3" data-testid="deleted-log-row">
                <span className="bg-muted text-muted-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg">
                  <Trash2 className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words">
                    {t.has(`action.${e.action}`) ? t(`action.${e.action}`) : e.action}
                    {e.label && <span className="ms-1.5 font-normal">— {e.label}</span>}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {[
                      e.amount_minor !== null && e.currency ? formatMoney({ amount: e.amount_minor, currency: e.currency }, locale) : null,
                      e.when ? t("lessonOn", { date: fmtDate(e.when, locale) }) : null,
                      e.deleted_by
                        ? t("deletedOnBy", { date: fmtDate(e.deleted_at, locale), name: e.deleted_by })
                        : t("deletedOn", { date: fmtDate(e.deleted_at, locale) }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

/** The one line under a name that tells two deleted rows apart. */
function subline(item: DeletedItem, t: ReturnType<typeof useTranslations>, locale: string): string | null {
  const d = item.detail;
  const parts: string[] = [];
  if (d.children && d.children.length > 0) parts.push(t("children", { names: d.children.join("، ") }));
  if (d.guardian) parts.push(t("guardian", { name: d.guardian }));
  if (d.department) parts.push(d.department);
  if (d.when) parts.push(t("trialOn", { date: fmtDate(d.when, locale) }));
  if (d.phone) parts.push(d.phone);
  return parts.length > 0 ? parts.join(" · ") : null;
}
