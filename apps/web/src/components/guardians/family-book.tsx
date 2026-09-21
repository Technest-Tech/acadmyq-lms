"use client";

import {
  ArrowDownAZ,
  ChevronDown,
  Coins,
  GraduationCap,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Octagram } from "@/components/ornaments";
import { Button } from "@/components/ui/button";
import { type GuardianRow, listGuardians } from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;

type SortKey = "name" | "children" | "created";

const SORTS: Record<SortKey, string> = {
  name: "name",
  children: "-children",
  created: "-created_at",
};

// ── Pieces ────────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

/** The parent's face on their card — a stable hue, so a family looks the same every visit. */
function ParentAvatar({ name }: { name: string }) {
  const hue = nameHue(name);
  return (
    <div
      className="ring-gold/25 flex size-11 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-sm ring-1"
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 58% 50%), hsl(${(hue + 32) % 360} 56% 40%))`,
      }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

/**
 * One child, as a chip. A trial reads amber and an enrolled student emerald, because the
 * question a card answers at a glance is "is this family settled or still being won".
 */
function ChildChip({ name, status }: { name: string; status: string | null }) {
  const trial = status === "TRIAL" || status === "TRIAL_BOOKED";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ring-1 ring-inset",
        trial
          ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300"
          : "bg-primary/8 text-primary ring-primary/15",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          trial ? "bg-amber-500" : "bg-primary/70",
        )}
        aria-hidden
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

const VISIBLE_CHILDREN = 4;

function FamilyCard({ row, onOpen }: { row: GuardianRow; onOpen: () => void }) {
  const t = useTranslations("guardians");
  const children = row.children ?? [];
  const count = row.children_count ?? children.length;
  const shown = children.slice(0, VISIBLE_CHILDREN);
  const rest = children.length - shown.length;
  const country = COUNTRIES.find((c) => c.code === row.country);
  const inactive = row.deleted_at != null;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="family-card"
      data-family={row.id}
      className={cn(
        "bg-card group relative flex flex-col overflow-hidden rounded-2xl border text-start shadow-sm transition-all",
        "hover:border-primary/30 hover:shadow-md focus-visible:ring-primary/30 focus-visible:ring-2 focus-visible:outline-none",
        inactive && "opacity-70",
      )}
    >
      {/* ── Who ──────────────────────────────────────────────────────── */}
      <div className="from-primary/[0.06] flex items-start gap-3 bg-gradient-to-br to-transparent px-4 pb-3.5 pt-4">
        <ParentAvatar name={row.full_name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-tight">
            {row.full_name}
          </p>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {row.whatsapp_phone && (
              <span
                dir="ltr"
                className="inline-flex items-center gap-1 tabular-nums"
              >
                <MessageCircle
                  className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
                {row.whatsapp_phone}
              </span>
            )}
            {country && (
              <span className="inline-flex items-center gap-1">
                {country.flag ? (
                  <span aria-hidden>{country.flag}</span>
                ) : (
                  <MapPin className="size-3 shrink-0" aria-hidden />
                )}
                <span className="truncate">{country.name}</span>
              </span>
            )}
          </div>
        </div>
        <span className="bg-primary/8 text-primary ring-primary/15 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1">
          <Coins className="size-3" aria-hidden />
          {row.currency}
        </span>
      </div>

      <span
        className="via-gold/35 h-px bg-gradient-to-r from-transparent to-transparent"
        aria-hidden
      />

      {/* ── Their students ───────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-2 px-4 py-3.5">
        <p className="text-muted-foreground/80 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
          <GraduationCap className="size-3.5" aria-hidden />
          {t("book.students", { count })}
        </p>
        {children.length === 0 ? (
          <p className="text-muted-foreground/60 text-xs italic">
            {t("book.noStudents")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {shown.map((c) => (
              <ChildChip key={c.id} name={c.full_name} status={c.status} />
            ))}
            {rest > 0 && (
              <span className="text-muted-foreground bg-muted/60 rounded-lg px-2 py-1 text-xs font-medium">
                {t("book.more", { count: rest })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div className="border-t px-4 py-2.5">
        <span className="text-primary group-hover:text-primary inline-flex items-center gap-1 text-xs font-semibold">
          {t("book.open")}
          <ChevronDown
            className="size-3 -rotate-90 rtl:rotate-90"
            aria-hidden
          />
        </span>
      </div>
    </button>
  );
}

function FamilyCardSkeleton() {
  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="flex items-start gap-3 px-4 pb-3.5 pt-4">
        <div className="bg-muted size-11 animate-pulse rounded-xl" />
        <div className="flex-1 space-y-2 py-0.5">
          <div className="bg-muted h-3.5 w-28 animate-pulse rounded" />
          <div className="bg-muted h-2.5 w-36 animate-pulse rounded" />
        </div>
      </div>
      <div className="space-y-2 border-t px-4 py-3.5">
        <div className="bg-muted h-2.5 w-20 animate-pulse rounded" />
        <div className="flex gap-1.5">
          <div className="bg-muted h-6 w-20 animate-pulse rounded-lg" />
          <div className="bg-muted h-6 w-16 animate-pulse rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * The parents page, as a book of FAMILIES rather than a row per billing contact. A table could
 * only ever show a parent's children as a number, so the one thing the screen exists to answer —
 * who is in this family, and are they trials or enrolled — cost a click per row to find out.
 *
 * Search reaches the children too (the API's own family search), because a parent is most often
 * looked up as "Yusuf's dad" rather than by their own name.
 */
export function FamilyBook({
  filter,
  refreshToken = 0,
  onNew,
}: {
  /** Set by the segment tiles above — see `guardian-manager`. */
  filter: Record<string, string>;
  refreshToken?: number;
  onNew: () => void;
}) {
  const t = useTranslations("guardians");
  const router = useRouter();
  const { can } = useAuth();

  const [rows, setRows] = useState<GuardianRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>("name");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [loading, setLoading] = useState(true);

  // Debounce typing, so a six-letter name is one query and not six.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Any change to what is being asked for starts the list again at page one. This is done DURING
  // the render rather than in an effect: an effect would run after the fetch below had already
  // fired for "page 4 of the new filter", throwing away a request and a page of results before
  // the reset landed. React re-renders immediately on a set during render, so nothing sees the
  // stale page.
  const filterKey = JSON.stringify(filter);
  const askedFor = `${filterKey}|${term}|${sort}|${refreshToken}`;
  const lastAsked = useRef(askedFor);
  if (lastAsked.current !== askedFor) {
    lastAsked.current = askedFor;
    if (page !== 1) setPage(1);
  }

  // A late response from an abandoned query must never overwrite a newer one.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++requestRef.current;
    setLoading(true);
    try {
      const res = await listGuardians({
        page,
        pageSize: PAGE_SIZE,
        search: term || undefined,
        sort: SORTS[sort],
        filter,
      });
      if (ticket !== requestRef.current) return;
      // Page one replaces; every page after it appends, because the pager is "show more".
      setRows((prev) => (page === 1 ? res.rows : [...prev, ...res.rows]));
      setTotal(res.total);
    } catch {
      if (ticket === requestRef.current) {
        setRows([]);
        setTotal(0);
      }
    } finally {
      if (ticket === requestRef.current) setLoading(false);
    }
    // `filter` is an object literal from the parent; key on its contents, not its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, term, sort, filterKey, refreshToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasMore = rows.length < total;

  return (
    <section
      className="bg-card overflow-hidden rounded-2xl border shadow-sm"
      data-testid="family-book"
    >
      {/* ── Panel header ─────────────────────────────────────────────── */}
      <div className="relative border-b">
        <div className="from-primary/[0.07] via-primary/[0.025] flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r to-transparent px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
              <Users className="text-primary size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                {t("book.title")}
                <Octagram className="text-gold/60 size-2 shrink-0" />
              </h2>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {t("book.hint")}
              </p>
            </div>
          </div>
          {can("guardian.create") && (
            <Button
              type="button"
              size="lg"
              onClick={onNew}
              data-testid="new-guardian-top"
              className="shadow-primary/20 gap-1.5 shadow-sm"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("new")}
            </Button>
          )}
        </div>
        <span
          className="via-gold/45 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
          aria-hidden
        />
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            aria-label={t("book.searchPlaceholder")}
            placeholder={t("book.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="family-search"
            className="border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border py-2 ps-9 pe-3 text-sm outline-none transition-colors focus:ring-3"
          />
        </div>
        <div className="relative shrink-0">
          <ArrowDownAZ
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <select
            aria-label={t("book.sort")}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            data-testid="family-sort"
            className="border-input bg-background focus:border-primary focus:ring-primary/15 rounded-xl border py-2 ps-9 pe-3 text-sm outline-none transition-colors focus:ring-3"
          >
            <option value="name">{t("book.sortName")}</option>
            <option value="children">{t("book.sortLargest")}</option>
            <option value="created">{t("book.sortNewest")}</option>
          </select>
        </div>
      </div>

      {/* ── The board ────────────────────────────────────────────────── */}
      <div className="p-4">
        {loading && rows.length === 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <FamilyCardSkeleton key={i} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-14 text-center">
            <Users className="text-muted-foreground/30 size-9" aria-hidden />
            <p className="text-muted-foreground text-sm">
              {term ? t("book.empty") : t("empty")}
            </p>
            {!term && can("guardian.create") && (
              <Button
                type="button"
                size="sm"
                onClick={onNew}
                className="gap-1.5"
              >
                <Plus className="size-3.5" aria-hidden />
                {t("new")}
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <FamilyCard
                  key={row.id}
                  row={row}
                  onOpen={() => router.push(`/guardians/${row.id}`)}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-col items-center gap-2">
              {hasMore && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => setPage((n) => n + 1)}
                  data-testid="family-load-more"
                >
                  {loading ? t("book.loading") : t("book.loadMore")}
                </Button>
              )}
              <p className="text-muted-foreground/70 text-xs tabular-nums">
                {t("book.showing", { shown: rows.length, total })}
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
