"use client";

import {
  Ban,
  BellRing,
  Building2,
  CheckCircle2,
  ChevronRight,
  Hourglass,
  Plus,
  Search,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fieldClass } from "@/components/admin/field";
import { AdminPageHeader } from "@/components/admin/page-header";
import { TableCard, Th, TR_HEAD } from "@/components/admin/table";
import { useAuth } from "@/components/auth-provider";
import {
  clockTone,
  daysSince,
  fmtDate,
  isInactive,
  agreementPrice,
  monthlyOf,
  nextUpcoming,
  type UpcomingDate,
} from "@/components/clients/client-summary";
import { MODULE_GLYPH, ModuleTags } from "@/components/clients/module-chips";
import { pastelFor } from "@/components/groups/group-look";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SegmentTile, type TileTone } from "@/components/ui/segment-tile";
import {
  ApiError,
  listClients,
  MODULE_CODES,
  type ClientDirectoryEntry,
  type ModuleCode,
} from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * /admin/clients — THE client hub (04-CLIENT-FIRST-REDESIGN §3), in the modern look. It answers
 * "who needs me?" before "who is there?": five tiles that are also the filters (every client, the
 * three lifecycle states, and the clients whose clock is ringing — an overdue renewal, an ended or
 * ending trial), one toolbar (search, module, sort), and a roster sorted most-urgent-first where each
 * row says in words what is about to happen to that client. Rows open the client page, where every
 * subscription, trial and module control lives.
 */

type Segment = "ALL" | "ACTIVE" | "TRIAL" | "SUSPENDED" | "ATTENTION";
type SortKey = "ATTENTION" | "NEWEST" | "REVENUE" | "STUDENTS" | "NAME";

const SEGMENTS: readonly { key: Segment; icon: typeof Building2; tone: TileTone }[] = [
  { key: "ALL", icon: Building2, tone: "emerald" },
  { key: "ACTIVE", icon: CheckCircle2, tone: "teal" },
  { key: "TRIAL", icon: Hourglass, tone: "gold" },
  { key: "SUSPENDED", icon: Ban, tone: "slate" },
  { key: "ATTENTION", icon: BellRing, tone: "rose" },
];
const SORTS: readonly SortKey[] = ["ATTENTION", "NEWEST", "REVENUE", "STUDENTS", "NAME"];

const TONE_TEXT = {
  crit: "text-rose-600 dark:text-rose-400",
  warn: "text-amber-700 dark:text-amber-400",
  neutral: "text-muted-foreground",
} as const;
const TONE_RANK = { crit: 0, warn: 1, neutral: 2 } as const;

interface Row {
  client: ClientDirectoryEntry;
  clock: UpcomingDate | null;
  /** Bills past their due date — money the client owes us now. */
  overdueBills: boolean;
  /** Nobody signing in: the earliest sign the client is drifting away. */
  inactive: boolean;
  tone: "crit" | "warn" | "neutral";
  /** Paid modules normalised to a month, for sorting only (currencies are not converted). */
  monthly: number;
}

/** A suspended client is its own tile; "needs follow-up" is about the clients still running. */
function inSegment(row: Row, s: Segment): boolean {
  if (s === "ALL") return true;
  if (s === "ATTENTION") return row.client.status !== "SUSPENDED" && row.tone !== "neutral";
  return row.client.status === s;
}

/** Words almost every client name starts with — they say nothing about which client it is. */
const GENERIC_NAME_WORDS = new Set(["أكاديمية", "اكاديمية", "أكاديميه", "اكاديميه", "مركز", "سنتر", "academy", "center", "centre"]);

/**
 * The avatar letters. "أكاديمية التوبة" gives "ت", not "أأ"/"أت": the generic first word is skipped,
 * and Arabic gets ONE letter because two Arabic letters side by side join into a word-like shape.
 * A Latin name keeps two ("Luqman Academy" → "LA").
 */
function initials(name: string): string {
  const all = name.trim().split(/\s+/).filter(Boolean);
  const words = all.filter((w) => !GENERIC_NAME_WORDS.has(w.toLowerCase()));
  const picked = words.length > 0 ? words : all;
  const first = (w: string | undefined) => (w === undefined ? "" : (Array.from(w.replace(/^ال/, ""))[0] ?? ""));
  if (/[؀-ۿ]/.test(picked[0] ?? "")) return first(picked[0]);
  return (first(all[0]) + first(all[1])).toUpperCase();
}

export function ClientsScreen() {
  const t = useTranslations("clients");
  const tr = useTranslations("clients.roster");
  const tf = useTranslations("finance");
  const tg = useTranslations("accounts.agreement");
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAuth();

  const [clients, setClients] = useState<ClientDirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<Segment>("ALL");
  const [moduleFilter, setModuleFilter] = useState<ModuleCode | "ALL">("ALL");
  const [sort, setSort] = useState<SortKey>("ATTENTION");

  const load = useCallback(async () => {
    try {
      const res = await listClients();
      setClients(res.clients);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Each client once: its most urgent clock, how loud it is, and what it pays a month.
  const rows = useMemo<Row[]>(
    () =>
      (clients ?? []).map((client) => {
        const clock = nextUpcoming(client.modules, client.account);
        const running = client.status !== "SUSPENDED";
        const overdueBills = running && (client.account?.has_overdue ?? false);
        // A WhatsApp-only client has no login by design.
        const inactive = running && client.client_type !== "WHATSAPP" && isInactive(client.last_login_at, client.created_at);
        const clockLevel = clock === null ? "neutral" : clockTone(clock);
        const tone: Row["tone"] =
          !running || clockLevel === "crit" || overdueBills
            ? "crit"
            : clockLevel === "warn" || inactive
              ? "warn"
              : "neutral";
        const monthly = monthlyOf(client.account);
        return { client, clock, overdueBills, inactive, tone, monthly };
      }),
    [clients],
  );

  const counts = useMemo(() => {
    const out = {} as Record<Segment, number>;
    for (const s of SEGMENTS) out[s.key] = rows.filter((r) => inSegment(r, s.key)).length;
    return out;
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter((row) => {
      const c = row.client;
      if (!inSegment(row, segment)) return false;
      if (moduleFilter !== "ALL" && !c.modules.some((m) => m.module === moduleFilter)) return false;
      if (
        q !== "" &&
        !c.name.toLowerCase().includes(q) &&
        !(c.owner_email ?? "").toLowerCase().includes(q) &&
        !(c.subdomain ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
    const byName = (a: Row, b: Row) => a.client.name.localeCompare(b.client.name, locale);
    return list.sort((a, b) => {
      switch (sort) {
        case "NEWEST":
          return b.client.created_at.localeCompare(a.client.created_at);
        case "REVENUE":
          return b.monthly - a.monthly || byName(a, b);
        case "STUDENTS":
          return b.client.student_count - a.client.student_count || byName(a, b);
        case "NAME":
          return byName(a, b);
        default: {
          // The loudest first, then the soonest clock, then the alphabet.
          const rank = TONE_RANK[a.tone] - TONE_RANK[b.tone];
          if (rank !== 0) return rank;
          const days = (a.clock?.days ?? Infinity) - (b.clock?.days ?? Infinity);
          return Number.isNaN(days) || days === 0 ? byName(a, b) : days;
        }
      }
    });
  }, [rows, query, segment, moduleFilter, sort, locale]);

  /** What the client pays, from its account: "EGP 1,000 / month", or the agreement's name, or a dash. */
  const revenueLabel = (c: ClientDirectoryEntry): string => {
    const price = agreementPrice(c.account, locale, (iv) => tf(`intervalShort.${iv}`));
    if (price !== "") return price;
    return c.account?.plan ? tg(`plan.${c.account.plan}`) : "—";
  };

  /** What is about to happen to this client, in words — the loudest thing first. */
  const clockLine = ({ client, clock, overdueBills, inactive }: Row): string => {
    if (client.status === "SUSPENDED") {
      return client.suspended_reason ? tr("clock.suspendedReason", { reason: client.suspended_reason }) : tr("clock.suspended");
    }
    const clockLoud = clock !== null && clockTone(clock) === "crit";
    if (overdueBills && !clockLoud) {
      return tr("clock.unpaidOverdue", {
        amount: Object.entries(client.account?.overdue ?? {})
          .map(([currency, amount]) => formatMoney({ amount, currency }, locale, { trimZeroDecimals: true }))
          .join(" · "),
      });
    }
    if (inactive && (clock === null || clockTone(clock) === "neutral")) {
      const since = daysSince(client.last_login_at);
      return since === null ? tr("clock.neverLoggedIn") : tr("clock.inactive", { days: formatNumber(since, locale) });
    }
    if (clock === null) {
      const paused = client.modules.find((m) => m.status === "PAUSED");
      if (paused) return tr("clock.paused", { module: t(`modules.${paused.module}`) });
      return client.modules.length === 0 ? tr("clock.noModules") : "";
    }
    const name = t(`modules.${clock.module}`);
    const days = formatNumber(Math.abs(clock.days), locale);
    const date = fmtDate(clock.date, locale);
    if (clock.trial) {
      if (clock.days < 0) return tr("clock.trialEnded", { module: name, days });
      if (clock.days === 0) return tr("clock.trialToday", { module: name });
      return clock.days <= 3 ? tr("clock.trialSoon", { module: name, days }) : tr("clock.trialUntil", { module: name, date });
    }
    if (clock.days < 0) return tr("clock.renewalOverdue", { module: name, days });
    if (clock.days === 0) return tr("clock.renewalToday", { module: name });
    return clock.days <= 7 ? tr("clock.renewalSoon", { module: name, days }) : tr("clock.renewsOn", { date });
  };

  const total = clients?.length ?? 0;

  return (
    <div className="space-y-5" data-testid="clients-screen">
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          can("academy.create") && (
            <Button onClick={() => router.push("/admin/clients/new")}>
              <Plus className="size-4" aria-hidden />
              {t("newClient")}
            </Button>
          )
        }
      />

      {error !== null && <AlertBanner variant="error" message={error} />}

      {/* ── The tiles are the filters ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SEGMENTS.map(({ key, icon, tone }) => (
          <SegmentTile
            key={key}
            testKey={key}
            icon={icon}
            tone={tone}
            label={tr(`tiles.${key}`)}
            hint={key === "ATTENTION" ? tr("tiles.attentionHint") : undefined}
            value={clients === null ? null : counts[key]}
            share={key === "ALL" || total === 0 ? null : Math.round((counts[key] / total) * 100)}
            selected={segment === key}
            onSelect={() => setSegment(key)}
          />
        ))}
      </div>

      {/* ── One toolbar: who, which module, in what order ── */}
      <div className="admin-surface bg-card flex flex-col gap-3 rounded-xl p-3 shadow-sm ring-1 ring-foreground/[0.06] lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute inset-y-0 start-3 my-auto size-4" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className={cn(fieldClass, "h-10 rounded-xl ps-9")}
          />
        </div>

        <div className="no-scrollbar flex max-w-full items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setModuleFilter("ALL")}
            aria-pressed={moduleFilter === "ALL"}
            className={cn(
              "h-9 shrink-0 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap transition-colors",
              moduleFilter === "ALL" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {t("allModules")}
          </button>
          {MODULE_CODES.map((code) => {
            const Icon = MODULE_GLYPH[code];
            return (
              <button
                key={code}
                type="button"
                onClick={() => setModuleFilter(code)}
                aria-pressed={moduleFilter === code}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap transition-colors",
                  moduleFilter === code ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {t(`modules.${code}`)}
              </button>
            );
          })}
        </div>

        <label className="flex shrink-0 items-center gap-2 text-sm">
          <span className="text-muted-foreground font-semibold whitespace-nowrap">{tr("sort.label")}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className={cn(fieldClass, "h-10 w-auto rounded-xl pe-8")}
            data-testid="clients-sort"
          >
            {SORTS.map((key) => (
              <option key={key} value={key}>
                {tr(`sort.${key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── The roster ── On a phone a row keeps the name, the state line and the money; the
          modules move under the name and the numbers drop. */}
      <TableCard testId="clients-table">
        <table className="w-full text-sm lg:min-w-[880px]">
          <thead>
            <tr className={TR_HEAD}>
              <Th className="lg:w-[26%]">{tr("columns.client")}</Th>
              <Th className="hidden lg:table-cell">{tr("columns.modules")}</Th>
              <Th className="hidden sm:table-cell">{tr("columns.state")}</Th>
              <Th className="whitespace-nowrap">{tr("columns.revenue")}</Th>
              <Th className="hidden md:table-cell">{tr("columns.students")}</Th>
              <Th className="hidden w-10 sm:table-cell" />
            </tr>
          </thead>
          <tbody>
            {clients === null ? (
              [0, 1, 2, 3].map((k) => (
                <tr key={k} className="border-b last:border-b-0">
                  <td colSpan={6} className="px-4 py-3">
                    <div className="bg-muted h-11 animate-pulse rounded-xl" />
                  </td>
                </tr>
              ))
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-4 py-14 text-center">
                  <Building2 className="mx-auto mb-2 size-7 opacity-40" aria-hidden />
                  {t("empty")}
                </td>
              </tr>
            ) : (
              shown.map((row) => {
                const { client: c, tone } = row;
                const line = clockLine(row);
                const contact = c.owner_email ?? c.subdomain;
                return (
                  <tr
                    key={c.id}
                    data-testid={`client-row-${c.id}`}
                    data-tone={tone}
                    onClick={() => router.push(`/admin/clients/${c.id}`)}
                    className="hover:bg-muted/50 group cursor-pointer border-b transition-colors last:border-b-0"
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={cn(
                            "flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold",
                            pastelFor(c.name),
                          )}
                          aria-hidden
                        >
                          {initials(c.name)}
                        </span>
                        <div className="min-w-0">
                          {/* <bdi>, not dir="auto" on the line: an English name keeps its own letter order
                              but the line stays in the page's direction, so it lines up with the email. */}
                          <p className="truncate font-bold">
                            <bdi>{c.name}</bdi>
                          </p>
                          <p className="text-muted-foreground truncate text-xs">
                            {contact !== null ? <span dir="ltr">{contact}</span> : tr("noOwner")}
                          </p>
                          {/* The state line under the name on a phone; its own column from sm up. */}
                          {line !== "" && (
                            <p className={cn("mt-0.5 truncate text-xs font-semibold sm:hidden", TONE_TEXT[tone])}>{line}</p>
                          )}
                          <div className="mt-1.5 lg:hidden">
                            <ModuleTags modules={c.modules} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3.5 lg:table-cell">
                      <ModuleTags modules={c.modules} />
                    </td>
                    <td className="hidden px-4 py-3.5 sm:table-cell">
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            tone === "crit" ? "bg-rose-500" : tone === "warn" ? "bg-amber-500" : c.status === "TRIAL" ? "bg-amber-400" : "bg-emerald-500",
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-bold">{t(`status.${c.status}`)}</p>
                          {line !== "" && <p className={cn("text-xs font-semibold", TONE_TEXT[tone])}>{line}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-bold whitespace-nowrap tabular-nums">{revenueLabel(c)}</td>
                    <td className="hidden px-4 py-3.5 md:table-cell">
                      {/* Three labelled numbers side by side — a bare "21" on its own read as nothing. */}
                      <dl className="flex items-start gap-4" data-testid={`client-usage-${c.id}`}>
                        {(
                          [
                            ["students", c.student_count],
                            ["teachers", c.teacher_count],
                            ["lessons", c.lessons_this_month ?? 0],
                          ] as const
                        ).map(([key, n]) => (
                          <div key={key} className="flex min-w-[2.75rem] flex-col-reverse items-center text-center">
                            <dt className="text-muted-foreground mt-0.5 text-[11px] leading-tight whitespace-nowrap">{tr(`usage.${key}`)}</dt>
                            <dd className={cn("text-base leading-tight font-extrabold tabular-nums", n === 0 && "text-muted-foreground/60")}>
                              {formatNumber(n, locale)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                    <td className="hidden px-3 py-3.5 sm:table-cell">
                      <ChevronRight
                        className="text-muted-foreground/50 group-hover:text-foreground size-5 transition-colors rtl:rotate-180"
                        aria-hidden
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableCard>

      {clients !== null && clients.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {tr("shown", { shown: formatNumber(shown.length, locale), total: formatNumber(total, locale) })}
        </p>
      )}
    </div>
  );
}
