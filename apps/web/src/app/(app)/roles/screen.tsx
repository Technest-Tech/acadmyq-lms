"use client";

import { Check, Lock, Pencil, Plus, ShieldCheck, ShieldHalf, Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  type AcademyRoleSummary,
  type AcademyRolesResponse,
  ApiError,
  createAcademyRole,
  deleteAcademyRole,
  listAcademyRoles,
  updateAcademyRole,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// Display order for capability groups — the domains an academy admin cares about first.
const DOMAIN_ORDER = [
  "student", "guardian", "teacher", "schedule", "session", "trial",
  "invoice", "payout", "certificate", "student_report", "teacher_report",
  "report_field", "specialization", "payment_settings", "staff", "staff_department",
  "user", "role", "notification", "audit",
  "academy", "plan", "academy_billing", "automation", "platform",
];

// The capability's domain prefix. Multi-word domains (report_field, student_report,
// staff_department, payment_settings, academy_billing) keep their underscore — only the part
// before the FINAL dot is the domain.
function domainOf(code: string): string {
  return code.includes(".") ? code.slice(0, code.lastIndexOf(".")) : code;
}

// Group flat capability codes by domain for a readable picker/list, ordered by DOMAIN_ORDER
// (unknown domains fall to the end) so the layout is stable and admin-friendly.
function groupByDomain(codes: string[]): Array<[string, string[]]> {
  const groups = new Map<string, string[]>();
  for (const code of codes) {
    const domain = domainOf(code);
    const list = groups.get(domain) ?? [];
    list.push(code);
    groups.set(domain, list);
  }
  const rank = (d: string) => {
    const i = DOMAIN_ORDER.indexOf(d);
    return i < 0 ? DOMAIN_ORDER.length : i;
  };
  return Array.from(groups.entries()).sort(([a], [b]) => rank(a) - rank(b));
}

type Draft = {
  id?: string;
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

export function AcademyRolesScreen() {
  const t = useTranslations("academyRoles");
  const tp = useTranslations("permissions");
  const { can } = useAuth();

  // Friendly, localized labels for raw capability codes (falls back to the code if unmapped).
  const itemKey = (code: string) => code.replace(/\./g, "_");
  const permLabel = (code: string) => {
    const k = `items.${itemKey(code)}.label`;
    return tp.has(k) ? tp(k) : code;
  };
  const permDesc = (code: string) => {
    const k = `items.${itemKey(code)}.desc`;
    return tp.has(k) ? tp(k) : "";
  };
  const groupLabel = (domain: string) => {
    const k = `groups.${domain}`;
    return tp.has(k) ? tp(k) : domain;
  };

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
      .catch((e) => setError(e instanceof ApiError ? e.message : t("loadError")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const grantableGroups = useMemo(
    () => (data ? groupByDomain(data.grantable) : []),
    [data],
  );

  // Display label for a role: system roles get a translated name, custom roles their own.
  const roleLabel = useCallback(
    (role: AcademyRoleSummary) => (role.system ? t(`role.${role.code}`) : role.name),
    [t],
  );

  if (!can("role.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  function openCreate() {
    setNotice(null);
    setDraft(emptyDraft());
  }

  function openEdit(role: AcademyRoleSummary) {
    setNotice(null);
    setViewing(null);
    setDraft({
      id: role.id,
      name: role.name,
      description: role.description ?? "",
      permissions: new Set(role.permissions),
      isActive: role.isActive ?? true,
    });
  }

  function toggleGroup(codes: string[], on: boolean) {
    setDraft((d) => {
      if (d === null) return d;
      const next = new Set(d.permissions);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return { ...d, permissions: next };
    });
  }

  function togglePerm(code: string) {
    setDraft((d) =>
      d === null
        ? d
        : {
            ...d,
            permissions: (() => {
              const next = new Set(d.permissions);
              if (next.has(code)) next.delete(code);
              else next.add(code);
              return next;
            })(),
          },
    );
  }

  async function save() {
    if (draft === null) return;
    setError(null);
    setBusy(true);
    try {
      const perms = Array.from(draft.permissions);
      if (draft.id) {
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
    <div className="space-y-6">
      {/* Hero */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex items-center gap-3.5">
          <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
            <ShieldCheck className="size-5.5" aria-hidden />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">{t("subtitle")}</p>
          </div>
          <Button type="button" size="sm" className="gap-1.5" onClick={openCreate} data-testid="new-role">
            <Plus className="size-4" />
            {t("newRole")}
          </Button>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} />}

      {/* Custom roles */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t("customRoles")}
        </h2>
        {data === null ? (
          <div className="bg-muted h-20 animate-pulse rounded-2xl" aria-hidden />
        ) : data.custom.length === 0 ? (
          <p className="text-muted-foreground rounded-2xl border border-dashed p-6 text-center text-sm">
            {t("noCustomRoles")}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.custom.map((role) => (
              <RoleCard
                key={role.code}
                role={role}
                title={roleLabel(role)}
                onView={() => setViewing(role)}
                onEdit={() => openEdit(role)}
                onDelete={() => setToDelete(role)}
                labels={cardLabels(t, role)}
              />
            ))}
          </div>
        )}
      </section>

      {/* System roles (read-only) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {t("systemRoles")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(data?.system ?? []).map((role) => (
            <RoleCard
              key={role.code}
              role={role}
              title={roleLabel(role)}
              onView={() => setViewing(role)}
              labels={cardLabels(t, role)}
            />
          ))}
        </div>
      </section>

      {/* Role details — features of any clicked role */}
      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing ? roleLabel(viewing) : ""}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(null)}>
              {t("close")}
            </Button>
            {viewing && !viewing.system && (
              <Button type="button" size="sm" className="gap-1.5" onClick={() => openEdit(viewing)}>
                <Pencil className="size-4" />
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
                {viewing.system ? <Lock className="size-3" /> : <ShieldCheck className="size-3" />}
                {viewing.system ? t("builtIn") : t("customBadge")}
              </span>
              <span>{t("capabilities", { count: viewing.permissions.length })}</span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" /> {t("assigned", { count: viewing.assignedCount })}
              </span>
              {viewing.isActive === false && <span>· {t("inactive")}</span>}
            </div>

            {viewing.description && (
              <p className="text-muted-foreground text-sm">{viewing.description}</p>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("featuresLabel")}</p>
              {viewing.permissions.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t("noFeatures")}</p>
              ) : (
                <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl border p-3">
                  {groupByDomain(viewing.permissions).map(([domain, codes]) => (
                    <div key={domain}>
                      <p className="mb-1.5 text-xs font-semibold">{groupLabel(domain)}</p>
                      <ul className="space-y-1">
                        {codes.map((code) => (
                          <li key={code} className="flex items-start gap-2 text-sm" title={code}>
                            <Check className="text-primary mt-0.5 size-3.5 shrink-0" aria-hidden />
                            <span>{permLabel(code)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Create / edit modal */}
      <Modal
        open={draft !== null}
        onClose={() => !busy && setDraft(null)}
        title={draft?.id ? t("editTitle") : t("createTitle")}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
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
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {t("nameLabel")}
                <span className="text-destructive ms-0.5">*</span>
              </label>
              <input
                className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-3"
                value={draft.name}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                data-testid="role-name"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("descriptionLabel")}</label>
              <textarea
                rows={2}
                className="border-input bg-background focus:border-primary focus:ring-primary/15 w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none focus:ring-3"
                value={draft.description}
                maxLength={500}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            {draft.id && (
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  className="size-4 rounded border-input accent-primary"
                />
                <span className="font-medium">{t("activeLabel")}</span>
              </label>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("permissionsLabel")}</label>
              <p className="text-muted-foreground text-xs">{t("permissionsHint")}</p>
              <div className="max-h-80 space-y-2.5 overflow-y-auto rounded-xl border p-2.5">
                {grantableGroups.map(([domain, codes]) => {
                  const selected = codes.filter((c) => draft.permissions.has(c)).length;
                  const allOn = selected === codes.length;
                  return (
                    <div key={domain} className="overflow-hidden rounded-lg border">
                      <div className="bg-muted/40 flex items-center justify-between gap-2 px-3 py-2">
                        <span className="text-sm font-semibold">{groupLabel(domain)}</span>
                        <button
                          type="button"
                          onClick={() => toggleGroup(codes, !allOn)}
                          className="text-primary text-xs font-medium hover:underline"
                          data-testid={`group-toggle-${domain}`}
                        >
                          {allOn ? t("clearAll") : t("selectAll")}
                          <span className="text-muted-foreground ms-1 font-normal">
                            {selected}/{codes.length}
                          </span>
                        </button>
                      </div>
                      <div className="divide-y">
                        {codes.map((code) => {
                          const desc = permDesc(code);
                          return (
                            <label
                              key={code}
                              className="hover:bg-muted/30 flex cursor-pointer items-start gap-2.5 px-3 py-2"
                              title={code}
                            >
                              <input
                                type="checkbox"
                                checked={draft.permissions.has(code)}
                                onChange={() => togglePerm(code)}
                                className="border-input accent-primary mt-0.5 size-4 rounded"
                                data-testid={`perm-${code}`}
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium leading-tight">
                                  {permLabel(code)}
                                </span>
                                {desc && (
                                  <span className="text-muted-foreground block text-xs leading-snug">
                                    {desc}
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={toDelete !== null}
        onClose={() => !busy && setToDelete(null)}
        title={t("deleteTitle")}
        footer={
          <>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setToDelete(null)}>
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

function cardLabels(
  t: ReturnType<typeof useTranslations>,
  role: AcademyRoleSummary,
): RoleCardLabels {
  return {
    capabilities: t("capabilities", { count: role.permissions.length }),
    assigned: t("assigned", { count: role.assignedCount }),
    inactive: t("inactive"),
    edit: t("edit"),
    remove: t("delete"),
    builtIn: t("builtIn"),
  };
}

type RoleCardLabels = {
  capabilities: string;
  assigned: string;
  inactive: string;
  edit: string;
  remove: string;
  builtIn: string;
};

function RoleCard({
  role,
  title,
  onView,
  onEdit,
  onDelete,
  labels,
}: {
  role: AcademyRoleSummary;
  title: string;
  onView: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  labels: RoleCardLabels;
}) {
  return (
    <button
      type="button"
      onClick={onView}
      className={cn(
        "bg-card flex w-full flex-col gap-3 rounded-2xl border p-4 text-start shadow-sm ring-1 ring-foreground/[0.04] transition-colors hover:border-primary/40 hover:bg-muted/20",
        role.isActive === false && "opacity-60",
      )}
      data-testid={`role-card-${role.code}`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-xl">
            {role.system ? <ShieldHalf className="size-4.5" /> : <ShieldCheck className="size-4.5" />}
          </div>
          <div>
            <p className="font-semibold leading-tight">{title}</p>
            {role.system ? (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <Lock className="size-3" /> {labels.builtIn}
              </span>
            ) : (
              role.isActive === false && (
                <span className="text-muted-foreground text-xs">{labels.inactive}</span>
              )
            )}
          </div>
        </div>
        {!role.system && (
          <div className="flex gap-1">
            <span
              role="button"
              tabIndex={0}
              aria-label={labels.edit}
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.();
              }}
              className="text-muted-foreground hover:text-foreground rounded-lg p-1.5"
            >
              <Pencil className="size-4" />
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label={labels.remove}
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.();
              }}
              className="text-muted-foreground hover:text-destructive rounded-lg p-1.5"
            >
              <Trash2 className="size-4" />
            </span>
          </div>
        )}
      </div>

      {role.description && (
        <p className="text-muted-foreground text-sm">{role.description}</p>
      )}

      <div className="text-muted-foreground mt-auto flex items-center gap-4 text-xs">
        <span>{labels.capabilities}</span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" /> {labels.assigned}
        </span>
      </div>
    </button>
  );
}
