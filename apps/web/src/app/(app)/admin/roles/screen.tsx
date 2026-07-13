"use client";

import { Lock, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  getRoles,
  setRolePermissions,
  type AppRole,
  type RoleCatalog,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const ROLE_ORDER: AppRole[] = ["SUPER_ADMIN", "ACADEMY_OWNER", "TEACHER"];

type GrantMap = Record<string, Set<string>>;

function cloneGrants(data: RoleCatalog): GrantMap {
  const g: GrantMap = {};
  for (const r of data.roles) g[r.role] = new Set(r.permissions);
  return g;
}

export function RoleEditorScreen() {
  const t = useTranslations("roleEditor");
  const { can } = useAuth();

  const [data, setData] = useState<RoleCatalog | null>(null);
  const [grants, setGrants] = useState<GrantMap>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getRoles()
      .then((d) => {
        setData(d);
        setGrants(cloneGrants(d));
      })
      .catch(() => setError(t("loadError")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // Which roles changed vs the loaded baseline.
  const dirtyRoles = useMemo(() => {
    if (!data) return [];
    return data.roles
      .filter((r) => {
        const now = grants[r.role] ?? new Set<string>();
        return (
          now.size !== r.permissions.length ||
          r.permissions.some((p) => !now.has(p))
        );
      })
      .map((r) => r.role);
  }, [data, grants]);

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const isLocked = (role: AppRole, cap: string) =>
    role === "SUPER_ADMIN" && (data?.lockoutCritical.includes(cap) ?? false);

  function toggle(role: AppRole, cap: string) {
    if (isLocked(role, cap)) return;
    setNotice(null);
    setGrants((g) => {
      const set = new Set(g[role]);
      if (set.has(cap)) set.delete(cap);
      else set.add(cap);
      return { ...g, [role]: set };
    });
  }

  async function save() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      for (const role of dirtyRoles) {
        await setRolePermissions(
          role as AppRole,
          Array.from(grants[role] ?? []),
        );
      }
      setConfirm(false);
      setNotice(t("saved"));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <ShieldCheck className="size-5.5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {t("subtitle")}
            </p>
          </div>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} />}

      {/* Matrix */}
      <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
        <table className="w-full text-sm" data-testid="role-matrix">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="px-3 py-2.5 text-start">{t("capability")}</th>
              {ROLE_ORDER.map((r) => (
                <th key={r} className="px-3 py-2.5 text-center">
                  {t(`role.${r}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {data === null ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={4} className="px-3 py-3">
                    <div
                      className="bg-muted h-4 animate-pulse rounded"
                      aria-hidden
                    />
                  </td>
                </tr>
              ))
            ) : (
              data.catalog.map((cap) => (
                <tr
                  key={cap}
                  data-cap={cap}
                  className="hover:bg-muted/30 transition-colors"
                >
                  <td
                    className="px-3 py-1.5 font-mono text-xs"
                    dir="ltr"
                  >
                    {cap}
                  </td>
                  {ROLE_ORDER.map((role) => {
                    const locked = isLocked(role, cap);
                    const checked = grants[role]?.has(cap) ?? false;
                    return (
                      <td key={role} className="px-3 py-1.5 text-center">
                        <span className="inline-flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked}
                            onChange={() => toggle(role, cap)}
                            aria-label={`${cap} · ${role}`}
                            data-testid={`grant-${role}-${cap}`}
                            className={cn("accent-primary size-4", locked && "opacity-60")}
                          />
                          {locked && (
                            <Lock
                              className="text-muted-foreground ms-1 size-3"
                              aria-hidden
                            />
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Save bar */}
      <div className="bg-card flex items-center justify-between rounded-2xl border px-4 py-3 shadow-sm ring-1 ring-foreground/[0.04]">
        <p className="text-muted-foreground text-sm">
          {dirtyRoles.length === 0
            ? t("noChanges")
            : t("dirtyCount", { count: dirtyRoles.length })}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || dirtyRoles.length === 0}
            onClick={() => data && setGrants(cloneGrants(data))}
          >
            {t("discard")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || dirtyRoles.length === 0}
            onClick={() => setConfirm(true)}
            data-testid="save-roles"
          >
            {t("save")}
          </Button>
        </div>
      </div>

      <Modal
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title={t("confirmTitle")}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void save()}
              data-testid="confirm-save-roles"
            >
              {busy ? t("saving") : t("confirmSave")}
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground text-sm">
          {t("confirmBody", {
            roles: dirtyRoles.map((r) => t(`role.${r}`)).join(", "),
          })}
        </p>
      </Modal>
    </div>
  );
}
