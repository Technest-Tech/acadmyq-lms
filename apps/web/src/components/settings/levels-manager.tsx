"use client";

import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { createLevel, deleteLevel, listLevels, type Level, updateLevel } from "@/lib/levels-api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/**
 * Settings → the academy's levels / grades (docs/centre-profile, Phase 2.1): add, rename, move up
 * or down, switch off, delete. The order here is the order every level picker shows. A level that
 * students or groups stand at cannot be deleted (the server says so, 422) — it is switched off and
 * keeps its name on everyone who holds it.
 */
export function LevelsManager() {
  const t = useTranslations("levels");
  const [items, setItems] = useState<Level[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await listLevels();
      setItems(res.levels);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return false;
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    const ok = await run(() => createLevel({ name }));
    if (ok) setNewName("");
    setBusy(false);
  }

  async function saveRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    if (await run(() => updateLevel(id, { name }))) setEditingId(null);
  }

  /** Swap positions with the neighbour: two writes, the list re-reads in its new order. */
  async function move(index: number, direction: -1 | 1) {
    if (!items) return;
    const a = items[index];
    const b = items[index + direction];
    if (!a || !b) return;
    // Positions are whatever the list holds; equal ones (a back-fill) are split by the index.
    const posA = a.sort_order === b.sort_order ? index : a.sort_order;
    const posB = a.sort_order === b.sort_order ? index + direction : b.sort_order;
    await run(async () => {
      await updateLevel(a.id, { sort_order: posB });
      await updateLevel(b.id, { sort_order: posA });
    });
  }

  return (
    <SectionCard
      icon={Layers}
      title={t("cardTitle")}
      description={t("hint")}
      iconClassName="bg-gradient-to-br from-sky-500 to-indigo-500 shadow-sky-500/25"
      testId="levels-manager"
    >
      <div className="space-y-4">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

        <form onSubmit={add} className="flex items-center gap-2">
          <input
            aria-label={t("namePlaceholder")}
            className={cn(inputBase, "px-3.5 py-2.5")}
            placeholder={t("namePlaceholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            data-testid="new-level-name"
          />
          <Button type="submit" size="sm" disabled={busy || newName.trim() === ""} className="shrink-0 gap-1.5" data-testid="add-level">
            <Plus className="size-3.5" />
            {t("add")}
          </Button>
        </form>

        {items === null ? (
          <div className="flex items-center justify-center py-8">
            <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">{t("empty")}</p>
        ) : (
          <ol className="divide-y overflow-hidden rounded-xl border" data-testid="levels-list">
            {items.map((level, index) => (
              <li
                key={level.id}
                className={cn("flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4", !level.is_active && "bg-muted/20")}
                data-level={level.id}
              >
                <span className="text-muted-foreground w-5 shrink-0 text-center text-xs tabular-nums">{index + 1}</span>

                {editingId === level.id ? (
                  <>
                    <input
                      aria-label={t("rename")}
                      className={cn(inputBase, "px-3 py-1.5")}
                      value={editName}
                      autoFocus
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveRename(level.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <Button type="button" size="xs" className="shrink-0 gap-1" onClick={() => void saveRename(level.id)} data-testid="save-level">
                      <Check className="size-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={() => setEditingId(null)}>
                      <X className="size-3.5" />
                    </Button>
                  </>
                ) : confirmDeleteId === level.id ? (
                  <>
                    <span className="text-destructive flex-1 text-sm">{t("confirmDelete")}</span>
                    <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={() => setConfirmDeleteId(null)}>
                      {t("cancel")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      className="shrink-0"
                      onClick={() => void run(() => deleteLevel(level.id)).then((ok) => ok && setConfirmDeleteId(null))}
                      data-testid="confirm-delete-level"
                    >
                      {t("delete")}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm font-medium", !level.is_active && "text-muted-foreground line-through")}>
                        {level.name}
                      </span>
                      {(level.students_count > 0 || level.groups_count > 0) && (
                        <span className="text-muted-foreground block text-[11px] tabular-nums">
                          {t("inUse", { students: level.students_count, groups: level.groups_count })}
                        </span>
                      )}
                    </div>
                    {!level.is_active && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                        {t("inactive")}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground shrink-0"
                      aria-label={t("moveUp")}
                      disabled={index === 0}
                      onClick={() => void move(index, -1)}
                      data-testid={`level-up-${level.id}`}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground shrink-0"
                      aria-label={t("moveDown")}
                      disabled={index === items.length - 1}
                      onClick={() => void move(index, 1)}
                      data-testid={`level-down-${level.id}`}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground shrink-0"
                      aria-label={level.is_active ? t("deactivate") : t("activate")}
                      onClick={() => void run(() => updateLevel(level.id, { is_active: !level.is_active }))}
                    >
                      {level.is_active ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground shrink-0"
                      aria-label={t("rename")}
                      onClick={() => {
                        setEditingId(level.id);
                        setEditName(level.name);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label={t("delete")}
                      onClick={() => setConfirmDeleteId(level.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </SectionCard>
  );
}
