"use client";

import {
  BarChart3,
  Banknote,
  Copy,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShieldHalf,
  Trash2,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  RoleBuilder,
  RoleSummary,
  roleReaches,
} from "@/components/team/role-builder";
import { withLeftovers } from "@/components/team/role-areas";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  type AcademyRoleArea,
  type AcademyRoleSummary,
  type AcademyRolesResponse,
  ApiError,
  createAcademyRole,
  deleteAcademyRole,
  listAcademyRoles,
  resetSystemRole,
  tuneSystemRole,
  updateAcademyRole,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type Draft = {
  id?: string;
  /** Editing a shared built-in role for this academy (no name, no on/off — just its set). */
  systemCode?: string;
  name: string;
  description: string;
  permissions: Set<string>;
  isActive: boolean;
};

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  permissions: new Set(),
  isActive: true,
});

/** The built-ins an academy actually hands out, in the order an owner reaches for them. */
const SYSTEM_ORDER = [
  "MANAGER",
  "SUPERVISOR",
  "ACCOUNTANT",
  "CUSTOMER_SERVICE",
  "STAFF",
  "TEACHER",
  "ACADEMY_OWNER",
];

/**
 * Team & permissions → Roles. The shared built-in roles first (the same five in every academy, so
 * most owners never build one), then the academy's own. A role is read as sections — "Students ·
 * Manage", "Invoices · View" — and built the same way (RoleBuilder), never as a wall of codes.
 */
export function RolesPanel() {
  const t = useTranslations("academyRoles");
  const { can } = useAuth();

  const [data, setData] = useState<AcademyRolesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<AcademyRoleSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<AcademyRoleSummary | null>(null);

  const load = useCallback(() => {
    setError(null);
    listAcademyRoles()
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : t("loadError")),
      );
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const areas: AcademyRoleArea[] = useMemo(
    () => (data ? withLeftovers(data.areas ?? [], data.grantable) : []),
    [data],
  );

  const systemRoles = useMemo(
    () =>
      [...(data?.system ?? [])].sort(
        (a, b) => SYSTEM_ORDER.indexOf(a.code) - SYSTEM_ORDER.indexOf(b.code),
      ),
    [data],
  );

  const roleLabel = useCallback(
    (role: AcademyRoleSummary) =>
      role.system
        ? t.has(`role.${role.code}`)
          ? t(`role.${role.code}`)
          : role.code
        : role.name,
    [t],
  );

  if (!can("role.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const grantable = new Set(data?.grantable ?? []);

  /** A new role, optionally starting from a built-in's set (clamped to what this user may grant). */
  function openCreate(from?: {
    name: string;
    description: string;
    permissions: string[];
  }) {
    setNotice(null);
    setViewing(null);
    setDraft({
      ...emptyDraft(),
      name: from?.name ?? "",
      description: from?.description ?? "",
      permissions: new Set(
        (from?.permissions ?? []).filter((c) => grantable.has(c)),
      ),
    });
  }

  function startFromPreset(key: string) {
    const preset = data?.presets?.find((p) => p.key === key);
    if (!preset || draft === null) return;
    setDraft({
      ...draft,
      name: draft.name || t(`presets.${key}.name`),
      description: draft.description || t(`presets.${key}.description`),
      permissions: new Set(preset.permissions),
    });
  }

  function openEdit(role: AcademyRoleSummary) {
    setNotice(null);
    setViewing(null);
    if (role.system) {
      setDraft({
        ...emptyDraft(),
        systemCode: role.code,
        name: roleLabel(role),
        permissions: new Set(role.permissions),
      });
      return;
    }
    setDraft({
      id: role.id,
      name: role.name,
      description: role.description ?? "",
      permissions: new Set(role.permissions),
      isActive: role.isActive ?? true,
    });
  }

  async function save() {
    if (draft === null) return;
    setError(null);
    setBusy(true);
    try {
      const perms = Array.from(draft.permissions);
      if (draft.systemCode) {
        await tuneSystemRole(draft.systemCode, perms);
      } else if (draft.id) {
        await updateAcademyRole(draft.id, {
          name: draft.name,
          description: draft.description || null,
          permissions: perms,
          is_active: draft.isActive,
        });
      } else {
        await createAcademyRole({
          name: draft.name,
          description: draft.description || null,
          permissions: perms,
        });
      }
      setDraft(null);
      setNotice(t("saved"));
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resetDefault(code: string) {
    setError(null);
    setBusy(true);
    try {
      await resetSystemRole(code);
      setDraft(null);
      setViewing(null);
      setNotice(t("resetDone"));
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (toDelete?.id === undefined) return;
    setError(null);
    setBusy(true);
    try {
      await deleteAcademyRole(toDelete.id);
      setToDelete(null);
      setNotice(t("deleted"));
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setToDelete(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="roles-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        <Button
          type="button"
          size="sm"
          className="gap-1.5 self-start sm:self-auto"
          onClick={() => openCreate()}
          data-testid="new-role"
        >
          <Plus className="size-4" aria-hidden />
          {t("newRole")}
        </Button>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} />}

      {/* ── Built-in roles: shared by every academy ───────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          icon={Lock}
          title={t("systemRoles")}
          hint={t("systemRolesSub")}
        />
        {data === null ? (
          <div
            className="bg-muted h-24 animate-pulse rounded-2xl"
            aria-hidden
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {systemRoles.map((role) => (
              <RoleCard
                key={role.code}
                role={role}
                title={roleLabel(role)}
                hint={
                  t.has(`systemRoleHint.${role.code}`)
                    ? t(`systemRoleHint.${role.code}`)
                    : (role.description ?? null)
                }
                areas={areas}
                onView={() => setViewing(role)}
                onEdit={role.editable ? () => openEdit(role) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── The academy's own roles ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          icon={ShieldCheck}
          title={t("customRoles")}
          hint={t("customRolesSub")}
        />
        {data === null ? (
          <div
            className="bg-muted h-20 animate-pulse rounded-2xl"
            aria-hidden
          />
        ) : data.custom.length === 0 ? (
          <p className="text-muted-foreground rounded-2xl border border-dashed p-6 text-center text-sm">
            {t("noCustomRoles")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.custom.map((role) => (
              <RoleCard
                key={role.code}
                role={role}
                title={roleLabel(role)}
                hint={role.description ?? null}
                areas={areas}
                onView={() => setViewing(role)}
                onEdit={() => openEdit(role)}
                onDelete={() => setToDelete(role)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Role details ─────────────────────────────────────────────────── */}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? roleLabel(viewing) : ""}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setViewing(null)}
            >
              {t("close")}
            </Button>
            {viewing &&
              viewing.system &&
              viewing.code !== "ACADEMY_OWNER" &&
              viewing.code !== "TEACHER" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  data-testid="copy-role"
                  onClick={() =>
                    openCreate({
                      name: t("copyName", { name: roleLabel(viewing) }),
                      description: t.has(`systemRoleHint.${viewing.code}`)
                        ? t(`systemRoleHint.${viewing.code}`)
                        : "",
                      permissions: viewing.permissions,
                    })
                  }
                >
                  <Copy className="size-4" aria-hidden />
                  {t("copyAsCustom")}
                </Button>
              )}
            {viewing && (!viewing.system || viewing.editable) && (
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => openEdit(viewing)}
              >
                <Pencil className="size-4" aria-hidden />
                {t("edit")}
              </Button>
            )}
          </>
        }
      >
        {viewing !== null && (
          <div className="space-y-4" data-testid="role-details">
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <span className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5">
                {viewing.system ? (
                  <Lock className="size-3" />
                ) : (
                  <ShieldCheck className="size-3" />
                )}
                {viewing.system ? t("builtIn") : t("customBadge")}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" />{" "}
                {t("assigned", { count: viewing.assignedCount })}
              </span>
              {viewing.isActive === false && <span>· {t("inactive")}</span>}
            </div>
            {(viewing.system
              ? t.has(`systemRoleHint.${viewing.code}`)
              : viewing.description) && (
              <p className="text-muted-foreground text-sm">
                {viewing.system
                  ? t(`systemRoleHint.${viewing.code}`)
                  : viewing.description}
              </p>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("featuresLabel")}</p>
              <RoleSummary areas={areas} permissions={viewing.permissions} />
            </div>
          </div>
        )}
      </Modal>

      {/* ── Create / edit ─────────────────────────────────────────────────── */}
      <Modal
        open={draft !== null}
        onClose={() => !busy && setDraft(null)}
        title={
          draft?.systemCode
            ? t("editSystemTitle", { role: draft.name })
            : draft?.id
              ? t("editTitle")
              : t("createTitle")
        }
        size="xl"
        footer={
          <>
            <span
              className="text-muted-foreground me-auto text-xs"
              data-testid="role-count"
            >
              {t("capabilities", { count: draft?.permissions.size ?? 0 })}
            </span>
            {draft?.systemCode &&
              data?.system.find((r) => r.code === draft.systemCode)?.tuned && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => void resetDefault(draft.systemCode as string)}
                  data-testid="reset-role"
                >
                  <RotateCcw className="size-4" aria-hidden />
                  {t("resetSystem")}
                </Button>
              )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || (draft?.name.trim() ?? "") === ""}
              onClick={() => void save()}
              data-testid="save-role"
            >
              {busy ? t("saving") : t("save")}
            </Button>
          </>
        }
      >
        {draft !== null && (
          <div className="space-y-4">
            {draft.systemCode ? (
              <AlertBanner variant="info" message={t("editSystemHint")} />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">
                    {t("nameLabel")}
                    <span className="text-destructive ms-0.5">*</span>
                  </span>
                  <input
                    className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-3"
                    value={draft.name}
                    maxLength={120}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                    data-testid="role-name"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">
                    {t("descriptionLabel")}
                  </span>
                  <input
                    className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-3"
                    value={draft.description}
                    maxLength={500}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                  />
                </label>
              </div>
            )}

            {draft.systemCode ? null : draft.id ? (
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) =>
                    setDraft({ ...draft, isActive: e.target.checked })
                  }
                  className="border-input accent-primary size-4 rounded"
                />
                <span className="font-medium">{t("activeLabel")}</span>
              </label>
            ) : (
              (data?.presets?.length ?? 0) > 0 && (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  data-testid="role-presets"
                >
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("builder.startFrom")}
                  </span>
                  {data?.presets?.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => startFromPreset(p.key)}
                      data-testid={`preset-${p.key}`}
                      className="hover:border-primary/40 hover:bg-primary/5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                    >
                      {t(`presets.${p.key}.name`)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({ ...draft, permissions: new Set() })
                    }
                    className="text-muted-foreground hover:text-foreground rounded-full px-2 py-1 text-xs"
                  >
                    {t("builder.clear")}
                  </button>
                </div>
              )
            )}

            <RoleBuilder
              areas={areas}
              value={draft.permissions}
              onChange={(next) => setDraft({ ...draft, permissions: next })}
            />
          </div>
        )}
      </Modal>

      {/* ── Delete confirm ────────────────────────────────────────────────── */}
      <Modal
        open={toDelete !== null}
        onClose={() => !busy && setToDelete(null)}
        title={t("deleteTitle")}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setToDelete(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void confirmDelete()}
              data-testid="confirm-delete-role"
            >
              {busy ? t("deleting") : t("delete")}
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground text-sm">
          {t("deleteBody", { name: toDelete?.name ?? "" })}
        </p>
      </Modal>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof ShieldCheck;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="bg-primary/10 ring-primary/15 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1">
        <Icon className="text-primary size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-bold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
    </div>
  );
}

function RoleCard({
  role,
  title,
  hint,
  areas,
  onView,
  onEdit,
  onDelete,
}: {
  role: AcademyRoleSummary;
  title: string;
  hint: string | null;
  areas: readonly AcademyRoleArea[];
  onView: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("academyRoles");
  const money = roleReaches(areas, role.permissions, "financial");
  const stats = roleReaches(areas, role.permissions, "statistics");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView();
        }
      }}
      className={cn(
        "bg-card group flex w-full cursor-pointer flex-col gap-3 rounded-2xl border p-4 text-start shadow-sm transition-all",
        "hover:border-primary/35 hover:-translate-y-0.5 hover:shadow-md",
        role.isActive === false && "opacity-60",
      )}
      data-testid={`role-card-${role.code}`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
              role.system
                ? "bg-slate-400/10 text-slate-500 ring-slate-400/20 dark:text-slate-400"
                : "bg-primary/10 text-primary ring-primary/15",
            )}
          >
            {role.system ? (
              <ShieldHalf className="size-4.5" />
            ) : (
              <ShieldCheck className="size-4.5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{title}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              {money ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                  <Banknote className="size-2.5" aria-hidden /> {t("seesMoney")}
                </span>
              ) : (
                <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                  {t("noMoney")}
                </span>
              )}
              {stats && (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-950/50 dark:text-violet-300">
                  <BarChart3 className="size-2.5" aria-hidden />{" "}
                  {t("seesStats")}
                </span>
              )}
              {role.tuned && (
                <span
                  className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  data-testid="role-edited"
                >
                  <Pencil className="size-2.5" aria-hidden /> {t("editedTag")}
                </span>
              )}
              {role.isActive === false && (
                <span className="text-muted-foreground text-[10px]">
                  {t("inactive")}
                </span>
              )}
            </div>
          </div>
        </div>
        {(onEdit || onDelete) && (
          <div className="flex shrink-0 gap-0.5">
            {onEdit && (
              <button
                type="button"
                aria-label={t("edit")}
                data-testid={`edit-role-${role.code}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="text-muted-foreground hover:text-foreground rounded-lg p-1.5"
              >
                <Pencil className="size-4" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                aria-label={t("delete")}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.();
                }}
                className="text-muted-foreground hover:text-destructive rounded-lg p-1.5"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {hint && (
        <p className="text-muted-foreground text-xs leading-snug">{hint}</p>
      )}

      <RoleSummary areas={areas} permissions={role.permissions} limit={5} />

      <div className="text-muted-foreground mt-auto flex items-center gap-1 border-t pt-2.5 text-xs">
        <Users className="size-3.5" aria-hidden />{" "}
        {t("assigned", { count: role.assignedCount })}
      </div>
    </div>
  );
}
