"use client";

import { Building2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ModuleChips } from "@/components/clients/module-chips";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  listClients,
  MODULE_CODES,
  type ClientDirectoryEntry,
  type ModuleCode,
} from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * /admin/clients — THE client hub (R2, 04-CLIENT-FIRST-REDESIGN §3): every client with its three
 * module chips, filterable by status and module. Rows open the client page, where every
 * subscription/trial/module control lives. Replaces the /academies roster.
 */

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  TRIAL: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  SUSPENDED:
    "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};

type StatusFilter = "ALL" | "ACTIVE" | "TRIAL" | "SUSPENDED";

export function ClientsScreen() {
  const t = useTranslations("clients");
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAuth();

  const [clients, setClients] = useState<ClientDirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [moduleFilter, setModuleFilter] = useState<ModuleCode | "ALL">("ALL");

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

  const filtered = useMemo(() => {
    if (clients === null) return [];
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (status !== "ALL" && c.status !== status) return false;
      if (
        moduleFilter !== "ALL" &&
        !c.modules.some((m) => m.module === moduleFilter)
      ) {
        return false;
      }
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
  }, [clients, query, status, moduleFilter]);

  const counts = useMemo(() => {
    const all = clients ?? [];
    return {
      ALL: all.length,
      ACTIVE: all.filter((c) => c.status === "ACTIVE").length,
      TRIAL: all.filter((c) => c.status === "TRIAL").length,
      SUSPENDED: all.filter((c) => c.status === "SUSPENDED").length,
    };
  }, [clients]);

  /** A client's monthly total per currency, e.g. "EGP 1,599" (+ second currency when mixed). */
  const monthlyLabel = (c: ClientDirectoryEntry): string => {
    const active = c.modules.filter((m) => m.status === "ACTIVE" && !m.is_trial);
    if (active.length === 0) return "—";
    const byCurrency = new Map<string, number>();
    for (const m of active) {
      byCurrency.set(m.currency, (byCurrency.get(m.currency) ?? 0) + m.total_cost_minor);
    }
    return [...byCurrency.entries()]
      .map(([currency, amount]) => formatMoney({ amount, currency }, locale))
      .join(" + ");
  };

  return (
    <div className="space-y-5" data-testid="clients-screen">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {can("academy.create") && (
          <Button onClick={() => router.push("/admin/clients/new")}>
            <Plus className="size-4" aria-hidden />
            {t("newClient")}
          </Button>
        )}
      </div>

      {error !== null && <AlertBanner variant="error" message={error} />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search
            className="text-muted-foreground absolute inset-y-0 start-2.5 my-auto size-4"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="bg-card focus-visible:ring-ring/50 h-9 w-64 max-w-full rounded-lg border ps-8 pe-3 text-sm outline-none focus-visible:ring-2"
          />
        </div>

        <div className="bg-card inline-flex overflow-hidden rounded-lg border text-xs font-medium">
          {(["ALL", "ACTIVE", "TRIAL", "SUSPENDED"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={cn(
                "px-3 py-2 transition-colors",
                status === s
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t(`status.${s}`)}
              <span className="text-muted-foreground/70 ms-1 tabular-nums">
                {counts[s]}
              </span>
            </button>
          ))}
        </div>

        <div className="bg-card inline-flex overflow-hidden rounded-lg border text-xs font-medium">
          <button
            type="button"
            onClick={() => setModuleFilter("ALL")}
            aria-pressed={moduleFilter === "ALL"}
            className={cn(
              "px-3 py-2 transition-colors",
              moduleFilter === "ALL"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {t("allModules")}
          </button>
          {MODULE_CODES.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setModuleFilter(code)}
              aria-pressed={moduleFilter === code}
              className={cn(
                "px-3 py-2 transition-colors",
                moduleFilter === code
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t(`modules.${code}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Roster */}
      <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-start text-[11px] font-semibold uppercase tracking-wider">
                <th className="px-4 py-3 text-start">{t("table.client")}</th>
                <th className="px-4 py-3 text-start">{t("table.modules")}</th>
                <th className="px-4 py-3 text-start">{t("table.status")}</th>
                <th className="px-4 py-3 text-start">{t("table.monthly")}</th>
                <th className="px-4 py-3 text-start">{t("table.people")}</th>
                <th className="px-4 py-3" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {clients === null ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground px-4 py-10 text-center">
                    {t("loading")}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground px-4 py-10 text-center">
                    <Building2 className="mx-auto mb-2 size-6 opacity-40" aria-hidden />
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr
                    key={c.id}
                    data-testid={`client-row-${c.id}`}
                    onClick={() => router.push(`/admin/clients/${c.id}`)}
                    className="hover:bg-accent/50 cursor-pointer border-b transition-colors last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {c.owner_email ?? t("noOwner")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ModuleChips modules={c.modules} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          STATUS_STYLE[c.status],
                        )}
                        title={c.suspended_reason ?? undefined}
                      >
                        {t(`status.${c.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums">
                      {monthlyLabel(c)}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 tabular-nums">
                      {t("people", {
                        students: c.student_count,
                        teachers: c.teacher_count,
                      })}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Link
                        href={`/admin/clients/${c.id}`}
                        className="text-primary text-xs font-semibold hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t("open")}
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
