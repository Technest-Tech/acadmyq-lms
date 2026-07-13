"use client";

import { Search, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UserDetailModal } from "@/components/admin/user-detail-modal";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  listAcademies,
  listPlatformUsers,
  type AcademyListItem,
  type AppRole,
  type PlatformUserResult,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const inputClass =
  "border-input bg-background rounded-lg border px-3 py-2 text-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none";

const ROLE_STYLE: Record<string, string> = {
  SUPER_ADMIN:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  ACADEMY_OWNER:
    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  TEACHER:
    "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
};

const AVATAR_GRADIENTS = [
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-violet-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-600",
];

function avatarFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]!;
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

export function PlatformUsersScreen() {
  const t = useTranslations("platformUsers");
  const { can } = useAuth();

  const [academies, setAcademies] = useState<AcademyListItem[]>([]);
  const [data, setData] = useState<PlatformUserResult | null>(null);
  const [error, setError] = useState(false);

  const [academy, setAcademy] = useState("");
  const [role, setRole] = useState<"" | AppRole>("");
  const [active, setActive] = useState<"" | "true" | "false">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(false);
    setData(null);
    listPlatformUsers({
      academy: academy || undefined,
      role: role || undefined,
      active: active === "" ? undefined : active === "true",
      search: search || undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then(setData)
      .catch(() => setError(true));
  }, [academy, role, active, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void listAcademies().then((r) => setAcademies(r.academies));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [academy, role, active, search]);

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1),
    [data],
  );

  if (!can("user.read_platform")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
              <Users className="size-5.5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {t("subtitle")}
              </p>
            </div>
          </div>
          {data && (
            <span className="text-muted-foreground hidden text-sm sm:block">
              {t("countLabel", { total: data.total })}
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
        }}
      >
        <div className="relative min-w-52 flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            aria-label={t("search")}
            className={cn(inputClass, "w-full ps-9")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        </div>
        <select
          aria-label={t("academy")}
          className={inputClass}
          value={academy}
          onChange={(e) => setAcademy(e.target.value)}
        >
          <option value="">{t("allAcademies")}</option>
          {academies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t("roleLabel")}
          className={inputClass}
          value={role}
          onChange={(e) => setRole(e.target.value as "" | AppRole)}
        >
          <option value="">{t("allRoles")}</option>
          <option value="SUPER_ADMIN">{t("role.SUPER_ADMIN")}</option>
          <option value="ACADEMY_OWNER">{t("role.ACADEMY_OWNER")}</option>
          <option value="TEACHER">{t("role.TEACHER")}</option>
        </select>
        <select
          aria-label={t("status")}
          className={inputClass}
          value={active}
          onChange={(e) => setActive(e.target.value as "" | "true" | "false")}
        >
          <option value="">{t("allStatuses")}</option>
          <option value="true">{t("active")}</option>
          <option value="false">{t("inactive")}</option>
        </select>
        <Button type="submit" size="sm" variant="outline">
          {t("apply")}
        </Button>
      </form>

      {error && <AlertBanner variant="error" message={t("loadError")} />}

      {/* Table */}
      <div className="bg-card overflow-hidden rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
        <table className="w-full text-sm" data-testid="platform-users-table">
          <thead>
            <tr className="border-b text-xs">
              <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                {t("colName")}
              </th>
              <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                {t("colAcademy")}
              </th>
              <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                {t("colRoles")}
              </th>
              <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                {t("colStatus")}
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {data === null ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={5} className="px-4 py-3.5">
                    <div
                      className="bg-muted h-6 animate-pulse rounded"
                      aria-hidden
                    />
                  </td>
                </tr>
              ))
            ) : data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="text-muted-foreground px-4 py-12 text-center"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : (
              data.rows.map((u) => (
                <tr
                  key={u.id}
                  data-user={u.id}
                  className="hover:bg-muted/30 group cursor-pointer transition-colors"
                  onClick={() => setOpenUserId(u.id)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-sm",
                          avatarFor(u.id),
                        )}
                        aria-hidden
                      >
                        {initials(u.full_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{u.full_name}</p>
                        <p
                          className="text-muted-foreground truncate text-xs"
                          dir="ltr"
                        >
                          {u.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {u.academy_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span
                          key={r}
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                            ROLE_STYLE[r] ?? "bg-muted",
                          )}
                        >
                          {t(`role.${r}`)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-medium",
                        u.is_active
                          ? "text-emerald-600"
                          : "text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          u.is_active ? "bg-emerald-500" : "bg-muted-foreground/50",
                        )}
                        aria-hidden
                      />
                      {u.is_active ? t("active") : t("inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenUserId(u.id);
                      }}
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      data-testid={`manage-user-${u.id}`}
                    >
                      {t("manage")}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t("countLabel", { total: data.total })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("prev")}
            </Button>
            <span className="text-muted-foreground tabular-nums">
              {t("pageOf", { page: data.page, total: totalPages })}
            </span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("next")}
            </Button>
          </div>
        </div>
      )}

      {openUserId && (
        <UserDetailModal
          userId={openUserId}
          onClose={() => setOpenUserId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
