"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusChip } from "@/components/admin/status-chip";
import { TableCard, Td, Th, TR_HEAD } from "@/components/admin/table";
import { UserAvatar } from "@/components/admin/user-avatar";
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

const ROLE_TONE: Record<string, "accent" | "info" | "neutral"> = {
  SUPER_ADMIN: "accent",
  ACADEMY_OWNER: "info",
  TEACHER: "neutral",
};

/**
 * Platform-wide user directory (superadmin-reorg): kit header + table dialect, client names
 * link to their client page, and the user detail opens in the shared modal.
 */
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
    <div className="space-y-5">
      <AdminPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          data && (
            <span className="text-muted-foreground text-sm">
              {t("countLabel", { total: data.total })}
            </span>
          )
        }
      />

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
      <TableCard>
        <table className="w-full text-sm" data-testid="platform-users-table">
          <thead>
            <tr className={TR_HEAD}>
              <Th>{t("colName")}</Th>
              <Th>{t("colAcademy")}</Th>
              <Th>{t("colRoles")}</Th>
              <Th>{t("colStatus")}</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {data === null ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <Td colSpan={5} className="py-3.5">
                    <div
                      className="bg-muted h-6 animate-pulse rounded"
                      aria-hidden
                    />
                  </Td>
                </tr>
              ))
            ) : data.rows.length === 0 ? (
              <tr>
                <Td
                  colSpan={5}
                  className="text-muted-foreground py-12 text-center"
                >
                  {t("empty")}
                </Td>
              </tr>
            ) : (
              data.rows.map((u) => (
                <tr
                  key={u.id}
                  data-user={u.id}
                  className="hover:bg-muted/30 group cursor-pointer transition-colors"
                  onClick={() => setOpenUserId(u.id)}
                >
                  <Td>
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.full_name} />
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
                  </Td>
                  <Td className="text-muted-foreground">
                    {u.academy_id !== null && u.academy_name !== null ? (
                      <Link
                        href={`/admin/clients/${u.academy_id}`}
                        className="hover:text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {u.academy_name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <StatusChip key={r} tone={ROLE_TONE[r] ?? "neutral"}>
                          {t(`role.${r}`)}
                        </StatusChip>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <StatusChip tone={u.is_active ? "good" : "neutral"} dot>
                      {u.is_active ? t("active") : t("inactive")}
                    </StatusChip>
                  </Td>
                  <Td className="text-end">
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
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableCard>

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
