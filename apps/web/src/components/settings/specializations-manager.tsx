"use client";

import { BookOpen, Check, Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  createSpecialization,
  deleteSpecialization,
  listSpecializations,
  type Specialization,
  updateSpecialization,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/** Manage the academy's teacher-specialization catalog: add, rename, (de)activate, delete. */
export function SpecializationsManager() {
  const t = useTranslations("settings");
  const [items, setItems] = useState<Specialization[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await listSpecializations();
      setItems(res.specializations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await createSpecialization(name);
      setNewName("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    setError(null);
    try {
      await updateSpecialization(id, { name });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function toggleActive(s: Specialization) {
    setError(null);
    try {
      await updateSpecialization(s.id, { is_active: !s.is_active });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await deleteSpecialization(id);
      setConfirmDeleteId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <SectionCard
      icon={BookOpen}
      title={t("specializations.cardTitle")}
      description={t("specializations.hint")}
      iconClassName="bg-gradient-to-br from-emerald-500 to-teal-500 shadow-emerald-500/25"
      testId="specializations-manager"
    >
      <div className="space-y-4">
        {error && (
          <AlertBanner
            variant="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        )}

        {/* Add new */}
        <form onSubmit={add} className="flex items-center gap-2">
          <input
            aria-label={t("specializations.namePlaceholder")}
            className={cn(inputBase, "px-3.5 py-2.5")}
            placeholder={t("specializations.namePlaceholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            data-testid="new-specialization-name"
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy || newName.trim() === ""}
            className="shrink-0 gap-1.5"
            data-testid="add-specialization"
          >
            <Plus className="size-3.5" />
            {t("specializations.add")}
          </Button>
        </form>

        {/* List */}
        {items === null ? (
          <div className="flex items-center justify-center py-8">
            <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("specializations.empty")}
          </p>
        ) : (
          <ul
            className="divide-y overflow-hidden rounded-xl border"
            data-testid="specializations-list"
          >
            {items.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5",
                  !s.is_active && "bg-muted/20",
                )}
                data-spec={s.id}
              >
                {editingId === s.id ? (
                  <>
                    <input
                      aria-label={t("specializations.rename")}
                      className={cn(inputBase, "px-3 py-1.5")}
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveRename(s.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <Button
                      type="button"
                      size="xs"
                      className="shrink-0 gap-1"
                      onClick={() => void saveRename(s.id)}
                      data-testid="save-specialization"
                    >
                      <Check className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="shrink-0"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </>
                ) : confirmDeleteId === s.id ? (
                  <>
                    <span className="flex-1 text-sm text-destructive">
                      {t("specializations.confirmDelete")}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="shrink-0"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      {t("specializations.cancel")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      className="shrink-0"
                      onClick={() => void remove(s.id)}
                      data-testid="confirm-delete-specialization"
                    >
                      {t("specializations.delete")}
                    </Button>
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        "flex-1 text-sm font-medium",
                        !s.is_active && "text-muted-foreground line-through",
                      )}
                    >
                      {s.name}
                    </span>
                    {!s.is_active && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                        {t("specializations.inactive")}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="shrink-0 text-muted-foreground"
                      aria-label={
                        s.is_active
                          ? t("specializations.deactivate")
                          : t("specializations.activate")
                      }
                      onClick={() => void toggleActive(s)}
                    >
                      {s.is_active ? (
                        <Eye className="size-3.5" />
                      ) : (
                        <EyeOff className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="shrink-0 text-muted-foreground"
                      aria-label={t("specializations.rename")}
                      onClick={() => {
                        setEditingId(s.id);
                        setEditName(s.name);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={t("specializations.delete")}
                      onClick={() => setConfirmDeleteId(s.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
