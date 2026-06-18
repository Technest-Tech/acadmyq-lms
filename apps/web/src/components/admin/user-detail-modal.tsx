"use client";

import {
  Building2,
  KeyRound,
  Plus,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  deactivateUser,
  getPlatformUser,
  listAcademies,
  reactivateUser,
  resetUserPassword,
  setUserRole,
  type AcademyListItem,
  type PlatformUserDetail,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background w-full rounded-lg border px-3 py-2 text-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none";

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

/**
 * Super Admin user detail + actions (admin panel — Phase 4): roles across academies (with
 * revoke), assign a new role, deactivate/reactivate the login, and send a password reset.
 * Every action hits an audited endpoint; the modal re-reads the user after each one.
 */
export function UserDetailModal({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("platformUsers");
  const locale = useLocale();

  const [user, setUser] = useState<PlatformUserDetail | null>(null);
  const [academies, setAcademies] = useState<AcademyListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [assignAcademy, setAssignAcademy] = useState("");
  const [assignRole, setAssignRole] = useState<"ACADEMY_OWNER" | "TEACHER">(
    "TEACHER",
  );

  const load = useCallback(async () => {
    const res = await getPlatformUser(userId);
    setUser(res.user);
  }, [userId]);

  useEffect(() => {
    void load();
    void listAcademies().then((r) => setAcademies(r.academies));
  }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
      setNotice(ok);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const title = user?.full_name ?? t("loading");

  return (
    <Modal open onClose={() => !busy && onClose()} title={title} size="lg">
      {user === null ? (
        <div className="space-y-3">
          <div className="bg-muted h-16 animate-pulse rounded-xl" aria-hidden />
          <div className="bg-muted h-24 animate-pulse rounded-xl" aria-hidden />
        </div>
      ) : (
        <div className="space-y-5">
          {error && <AlertBanner variant="error" message={error} />}
          {notice && <AlertBanner variant="success" message={notice} />}

          {/* Identity header */}
          <div className="bg-muted/30 flex items-center gap-3.5 rounded-xl p-4">
            <div
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-base font-bold text-white shadow-sm",
                avatarFor(user.id),
              )}
              aria-hidden
            >
              {initials(user.full_name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{user.full_name}</p>
              <p className="text-muted-foreground truncate text-sm" dir="ltr">
                {user.email}
              </p>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                user.is_active
                  ? "bg-emerald-100 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-rose-100 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300",
              )}
            >
              {user.is_active ? t("active") : t("inactive")}
            </span>
          </div>

          {/* Roles */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="text-muted-foreground size-4" aria-hidden />
              {t("roles")}
            </h3>
            {user.roles.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noRoles")}</p>
            ) : (
              <div className="space-y-1.5">
                {user.roles.map((r, i) => (
                  <div
                    key={`${r.academy_id}-${r.role}-${i}`}
                    className="bg-card flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                          ROLE_STYLE[r.role] ?? "bg-muted",
                        )}
                      >
                        {t(`role.${r.role}`)}
                      </span>
                      {r.academy_name && (
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                          <Building2 className="size-3" aria-hidden />
                          {r.academy_name}
                        </span>
                      )}
                    </span>
                    {r.role !== "SUPER_ADMIN" && r.academy_id && (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              setUserRole(user.id, {
                                academy_id: r.academy_id as string,
                                role: r.role as "ACADEMY_OWNER" | "TEACHER",
                                grant: false,
                              }),
                            t("roleRevoked"),
                          )
                        }
                      >
                        {t("revoke")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Assign a role */}
          <section className="bg-muted/20 space-y-2 rounded-xl border p-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="text-muted-foreground size-4" aria-hidden />
              {t("assignRole")}
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-40 flex-1 space-y-1">
                <span className="text-muted-foreground text-xs font-medium">
                  {t("academy")}
                </span>
                <select
                  aria-label={t("academy")}
                  className={inputClass}
                  value={assignAcademy}
                  onChange={(e) => setAssignAcademy(e.target.value)}
                >
                  <option value="">{t("selectAcademy")}</option>
                  {academies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-muted-foreground text-xs font-medium">
                  {t("roleLabel")}
                </span>
                <select
                  aria-label={t("roleLabel")}
                  className={inputClass}
                  value={assignRole}
                  onChange={(e) =>
                    setAssignRole(e.target.value as "ACADEMY_OWNER" | "TEACHER")
                  }
                >
                  <option value="TEACHER">{t("role.TEACHER")}</option>
                  <option value="ACADEMY_OWNER">
                    {t("role.ACADEMY_OWNER")}
                  </option>
                </select>
              </label>
              <Button
                type="button"
                size="sm"
                disabled={busy || !assignAcademy}
                onClick={() =>
                  void run(
                    () =>
                      setUserRole(user.id, {
                        academy_id: assignAcademy,
                        role: assignRole,
                        grant: true,
                      }),
                    t("roleAssigned"),
                  )
                }
                data-testid="assign-role"
              >
                {t("assign")}
              </Button>
            </div>
          </section>

          {/* Account actions */}
          <section className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(() => resetUserPassword(user.id), t("resetSent"))
              }
              data-testid="reset-password"
            >
              <KeyRound className="size-4" aria-hidden />
              {t("resetPassword")}
            </Button>
            {user.academy_id &&
              (user.is_active ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void run(() => deactivateUser(user.id), t("deactivated"))
                  }
                  data-testid="deactivate-user"
                >
                  <UserX className="size-4" aria-hidden />
                  {t("deactivate")}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() => reactivateUser(user.id), t("reactivated"))
                  }
                  data-testid="reactivate-user"
                >
                  <UserCheck className="size-4" aria-hidden />
                  {t("reactivate")}
                </Button>
              ))}
          </section>

          <p className="text-muted-foreground text-center text-xs">
            {t("created", {
              date: new Date(user.created_at).toLocaleDateString(
                locale === "ar" ? "ar" : locale,
              ),
            })}
          </p>
        </div>
      )}
    </Modal>
  );
}
