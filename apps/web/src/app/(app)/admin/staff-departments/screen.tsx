"use client";

import {
  Briefcase,
  CheckCircle2,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusChip } from "@/components/admin/status-chip";
import { TableCard, Td, Th, TR_HEAD } from "@/components/admin/table";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ApiError,
  createStaffDepartment,
  deleteStaffDepartment,
  listStaffDepartments,
  type StaffDepartment,
  updateStaffDepartment,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Color helper (hash-based, same as staff components) ───────────────────────

function deptHue(name: string): number {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

// ── Department form (create / edit) ───────────────────────────────────────────

const inputBase =
  "border-input bg-background focus:border-primary focus:ring-primary/20 w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-2 disabled:opacity-50";

function DeptForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: StaffDepartment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("staffDepartments");
  const [name, setName] = useState(initial?.name ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 99));
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (initial) {
        await updateStaffDepartment(initial.id, {
          name: name.trim(),
          sort_order: parseInt(sortOrder, 10),
          is_active: isActive,
        });
      } else {
        await createStaffDepartment({
          name: name.trim(),
          sort_order: parseInt(sortOrder, 10),
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error && <AlertBanner variant="error" message={error} />}

      <div className="space-y-1.5">
        <label className="text-sm font-medium">
          {t("form.name")}
          <span className="text-destructive ms-0.5">*</span>
        </label>
        <input
          aria-label={t("form.name")}
          className={inputBase}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("form.namePlaceholder")}
          required
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">{t("form.sortOrder")}</label>
        <input
          type="number"
          min="0"
          step="1"
          aria-label={t("form.sortOrder")}
          className={cn(inputBase, "tabular-nums")}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("form.sortOrderHint")}</p>
      </div>

      {initial && (
        <label className="flex items-center gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="size-4 rounded border-input accent-primary"
          />
          <span>{t("form.isActive")}</span>
        </label>
      )}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {initial
            ? busy
              ? t("form.save") + "…"
              : t("form.save")
            : busy
              ? t("form.create") + "…"
              : t("form.create")}
        </Button>
      </div>
    </form>
  );
}

// ── Panel (content-only — rendered by the settings tab AND the standalone route) ──

type ModalState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "edit"; dept: StaffDepartment }
  | { kind: "delete"; dept: StaffDepartment };

/**
 * Staff department catalog, CONTENT-ONLY (superadmin-reorg): no page chrome, so the settings
 * "departments" tab and the standalone route each render exactly one header. This screen was
 * the panel's strongest visual outlier (own page width, violet hero, div-table, one-off input
 * tokens) — it now sits on the shared kit, and the read is permission-gated like every other
 * admin surface (previously the list rendered for anyone who reached the route).
 */
export function StaffDepartmentsPanel({
  toolbar,
}: {
  /** Where the standalone route puts the New button (the page header renders it). */
  toolbar?: boolean;
} = {}) {
  const t = useTranslations("staffDepartments");
  const { can } = useAuth();

  const [departments, setDepartments] = useState<StaffDepartment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [alert, setAlert] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const canManage = can("staff_department.manage");

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listStaffDepartments();
      setDepartments(res.departments);
    } catch {
      showAlert("error", t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (canManage) void load();
  }, [load, canManage]);

  if (!canManage) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  async function handleDelete(dept: StaffDepartment) {
    setDeleteBusy(true);
    try {
      await deleteStaffDepartment(dept.id);
      setModal({ kind: "closed" });
      showAlert("success", t("deleted", { name: dept.name }));
      await load();
    } catch (err) {
      setModal({ kind: "closed" });
      showAlert("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {toolbar !== false && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => setModal({ kind: "new" })}
            data-testid="new-department"
          >
            <Plus className="size-4" aria-hidden />
            {t("new")}
          </Button>
        </div>
      )}

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-muted h-12 animate-pulse rounded-xl" aria-hidden />
          ))}
        </div>
      ) : departments.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          message={t("empty")}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setModal({ kind: "new" })}
            >
              {t("new")}
            </Button>
          }
        />
      ) : (
        <TableCard>
          <table className="w-full text-sm" data-testid="departments-table">
            <thead>
              <tr className={TR_HEAD}>
                <Th>{t("colName")}</Th>
                <Th className="text-center">{t("colOrder")}</Th>
                <Th>{t("colStatus")}</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y">
              {departments.map((dept) => (
                <tr key={dept.id} className="hover:bg-muted/20 transition-colors">
                  <Td>
                    <span className="flex items-center gap-2.5">
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: `hsl(${deptHue(dept.name)} 55% 50%)` }}
                        aria-hidden
                      />
                      <span className="font-semibold">{dept.name}</span>
                    </span>
                  </Td>
                  <Td className="text-muted-foreground text-center tabular-nums">
                    {dept.sort_order}
                  </Td>
                  <Td>
                    {dept.is_active ? (
                      <StatusChip tone="good" icon={CheckCircle2}>
                        {t("active")}
                      </StatusChip>
                    ) : (
                      <StatusChip tone="neutral" icon={XCircle}>
                        {t("inactive")}
                      </StatusChip>
                    )}
                  </Td>
                  <Td className="text-end">
                    <span className="inline-flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setModal({ kind: "edit", dept })}
                        className="gap-1"
                        data-testid={`edit-dept-${dept.id}`}
                      >
                        <Pencil className="size-3" />
                        {t("edit")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setModal({ kind: "delete", dept })}
                        className="gap-1 text-muted-foreground hover:text-destructive"
                        data-testid={`delete-dept-${dept.id}`}
                      >
                        <Trash2 className="size-3.5" />
                        {t("delete")}
                      </Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      <p className="text-xs text-muted-foreground">{t("note")}</p>

      {/* Create modal */}
      <Modal
        open={modal.kind === "new"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("newTitle")}
        size="sm"
      >
        <DeptForm
          onCancel={() => setModal({ kind: "closed" })}
          onDone={async () => {
            setModal({ kind: "closed" });
            showAlert("success", t("created"));
            await load();
          }}
        />
      </Modal>

      {/* Edit modal */}
      <Modal
        open={modal.kind === "edit"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("editTitle")}
        size="sm"
      >
        {modal.kind === "edit" && (
          <DeptForm
            initial={modal.dept}
            onCancel={() => setModal({ kind: "closed" })}
            onDone={async () => {
              setModal({ kind: "closed" });
              showAlert("success", t("saved"));
              await load();
            }}
          />
        )}
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={modal.kind === "delete"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("deleteTitle")}
        size="sm"
      >
        {modal.kind === "delete" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("deleteBody", { name: modal.dept.name })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deleteBusy}
                onClick={() => setModal({ kind: "closed" })}
              >
                {t("deleteCancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleteBusy}
                data-testid="confirm-delete-dept"
                onClick={() => void handleDelete(modal.dept)}
              >
                {t("deleteYes")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Standalone /admin/staff-departments route: the one page header + the shared panel. */
export function StaffDepartmentsScreen() {
  const t = useTranslations("staffDepartments");
  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />
      <StaffDepartmentsPanel />
    </div>
  );
}
