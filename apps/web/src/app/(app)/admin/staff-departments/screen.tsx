"use client";

import {
  Briefcase,
  CheckCircle2,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
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

// ── Department row ────────────────────────────────────────────────────────────

function DeptRow({
  dept,
  onEdit,
  onDelete,
}: {
  dept: StaffDepartment;
  onEdit: (dept: StaffDepartment) => void;
  onDelete: (dept: StaffDepartment) => void;
}) {
  const t = useTranslations("staffDepartments");
  const hue = deptHue(dept.name);

  return (
    <div className="flex items-center gap-3 border-b px-5 py-3.5 last:border-b-0 hover:bg-muted/20 transition-colors">
      <GripVertical className="size-4 text-muted-foreground/30 shrink-0" aria-hidden />
      <span
        className="size-3 rounded-full shrink-0"
        style={{ backgroundColor: `hsl(${hue} 55% 50%)` }}
        aria-hidden
      />
      <span className="flex-1 text-sm font-semibold">{dept.name}</span>
      <span className="text-xs text-muted-foreground tabular-nums w-8 text-center">
        {dept.sort_order}
      </span>
      {dept.is_active ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="size-3" aria-hidden />
          {t("active")}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
          <XCircle className="size-3" aria-hidden />
          {t("inactive")}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onEdit(dept)}
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
          onClick={() => onDelete(dept)}
          className="gap-1 text-muted-foreground hover:text-destructive"
          data-testid={`delete-dept-${dept.id}`}
        >
          <Trash2 className="size-3.5" />
          {t("delete")}
        </Button>
      </div>
    </div>
  );
}

// ── Department form (create / edit) ───────────────────────────────────────────

const inputBase =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

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
        <Button type="submit" size="sm" disabled={busy} className="gap-1.5">
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {initial ? t("form.save") : t("form.create")}
        </Button>
      </div>
    </form>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "edit"; dept: StaffDepartment }
  | { kind: "delete"; dept: StaffDepartment };

export function StaffDepartmentsScreen() {
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
    void load();
  }, [load]);

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

  const canManage = can("staff_department.manage");

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-violet-400 shadow-lg shadow-violet-500/30">
            <Briefcase className="size-6 text-white" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        {canManage && (
          <Button
            type="button"
            size="lg"
            onClick={() => setModal({ kind: "new" })}
            className="gap-2 px-4 shadow-md shadow-primary/25"
            data-testid="new-department"
          >
            <Plus className="size-4" aria-hidden />
            {t("new")}
          </Button>
        )}
      </div>

      {/* ── Alert ──────────────────────────────────────────────────────────── */}
      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* ── Departments table ───────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {/* Table header */}
        <div className="flex items-center gap-3 border-b bg-muted/20 px-5 py-3">
          <span className="w-4" />
          <span className="w-3" />
          <span className="flex-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("colName")}
          </span>
          <span className="w-8 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("colOrder")}
          </span>
          <span className="w-20 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("colStatus")}
          </span>
          <span className="w-28" />
        </div>

        {loading ? (
          <div className="space-y-px p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-muted/40" />
            ))}
          </div>
        ) : departments.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Briefcase className="size-10 text-muted-foreground/20" aria-hidden />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
            {canManage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModal({ kind: "new" })}
              >
                {t("new")}
              </Button>
            )}
          </div>
        ) : (
          departments.map((dept) => (
            <DeptRow
              key={dept.id}
              dept={dept}
              onEdit={(d) => setModal({ kind: "edit", dept: d })}
              onDelete={(d) => setModal({ kind: "delete", dept: d })}
            />
          ))
        )}
      </div>

      {/* ── Info note ───────────────────────────────────────────────────────── */}
      <p className="text-xs text-muted-foreground text-center">
        {t("note")}
      </p>

      {/* ── Create modal ────────────────────────────────────────────────────── */}
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

      {/* ── Edit modal ──────────────────────────────────────────────────────── */}
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

      {/* ── Delete confirmation ──────────────────────────────────────────────── */}
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
                className="gap-1.5"
                data-testid="confirm-delete-dept"
                onClick={() => void handleDelete((modal as { dept: StaffDepartment }).dept)}
              >
                {deleteBusy && (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {t("deleteYes")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
