"use client";

import {
  ChevronDown,
  FolderPlus,
  GripVertical,
  ListChecks,
  Percent,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  createQualityCategory,
  createQualityCriterion,
  deleteQualityCategory,
  deleteQualityCriterion,
  getQualityRubric,
  type QualityCategory,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:opacity-50";

/**
 * The rubric editor: categories, their checkable criteria, and the percent each one docks.
 *
 * Deliberately inline rather than modal-per-item — building a rubric is a burst of many small
 * additions, and a dialog for each would make the common case (typing eight criteria in a row) the
 * slowest one. Editing is safe by construction: {@see createQualityReport} snapshots names and
 * percents onto every report, so re-pricing a criterion changes what future reports cost and never
 * restates one a teacher has already been docked for.
 */
export function RubricBuilder({
  canManage,
  onChanged,
}: {
  canManage: boolean;
  onChanged?: () => void;
}) {
  const t = useTranslations("quality");

  const [categories, setCategories] = useState<QualityCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [addingCategory, setAddingCategory] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getQualityRubric();
      setCategories(res.categories);
      // First load: open everything. A collapsed-by-default rubric hides the very thing the
      // page exists to show.
      setOpen((prev) =>
        prev.size === 0 ? new Set(res.categories.map((c) => c.id)) : prev,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  async function removeCategory(category: QualityCategory) {
    if (!window.confirm(t("rubric.confirmDeleteCategory", { name: category.name }))) return;
    setBusy(true);
    try {
      await deleteQualityCategory(category.id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeCriterion(id: string) {
    setBusy(true);
    try {
      await deleteQualityCriterion(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (categories === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="quality-rubric">
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListChecks className="text-primary size-4" aria-hidden />
          <h2 className="text-sm font-semibold">{t("rubric.title")}</h2>
          <span className="text-muted-foreground text-xs">
            {t("rubric.count", { count: categories.length })}
          </span>
        </div>
        {canManage && !addingCategory && (
          <Button size="sm" variant="outline" onClick={() => setAddingCategory(true)} data-testid="quality-add-category">
            <FolderPlus className="size-4" aria-hidden />
            {t("rubric.addCategory")}
          </Button>
        )}
      </div>

      <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
        {t("rubric.explainer")}
      </p>

      {addingCategory && (
        <CategoryForm
          onCancel={() => setAddingCategory(false)}
          onSaved={async () => {
            setAddingCategory(false);
            await refresh();
          }}
          onError={setError}
        />
      )}

      {categories.length === 0 && !addingCategory ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-16 text-center">
          <ListChecks className="text-muted-foreground/40 size-6" aria-hidden />
          <p className="text-muted-foreground text-sm">{t("rubric.empty")}</p>
          <p className="text-muted-foreground/70 max-w-sm text-xs">{t("rubric.emptyHint")}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {categories.map((category) => {
            const isOpen = open.has(category.id);
            const total = category.criteria.reduce((sum, c) => sum + c.discount_percent, 0);

            return (
              <li
                key={category.id}
                className="bg-card overflow-hidden rounded-2xl border shadow-sm"
              >
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggle(category.id)}
                    className="flex flex-1 items-center gap-2 text-start"
                    aria-expanded={isOpen}
                  >
                    <ChevronDown
                      className={cn(
                        "text-muted-foreground size-4 shrink-0 transition-transform",
                        !isOpen && "-rotate-90 rtl:rotate-90",
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{category.name}</p>
                      {category.description && (
                        <p className="text-muted-foreground truncate text-xs">
                          {category.description}
                        </p>
                      )}
                    </div>
                  </button>

                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {t("rubric.criteriaCount", { count: category.criteria.length })}
                  </span>
                  {total > 0 && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {t("rubric.maxPercent", { percent: Math.round(total * 100) / 100 })}
                    </span>
                  )}
                  {canManage && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void removeCategory(category)}
                      aria-label={t("rubric.deleteCategory")}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </div>

                {isOpen && (
                  <div className="border-t">
                    {category.criteria.length === 0 ? (
                      <p className="text-muted-foreground px-4 py-4 text-xs">
                        {t("rubric.noCriteria")}
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {category.criteria.map((criterion) => (
                          <li
                            key={criterion.id}
                            className="flex items-center gap-3 px-4 py-2.5"
                          >
                            <GripVertical
                              className="text-muted-foreground/30 size-3.5 shrink-0"
                              aria-hidden
                            />
                            <span className="flex-1 truncate text-sm">{criterion.name}</span>
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-600 dark:bg-red-950/30 dark:text-red-300">
                              <Percent className="size-3" aria-hidden />
                              {criterion.discount_percent}
                            </span>
                            {canManage && (
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => void removeCriterion(criterion.id)}
                                aria-label={t("rubric.deleteCriterion")}
                              >
                                <X className="size-3.5" aria-hidden />
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {canManage && (
                      <CriterionForm
                        categoryId={category.id}
                        onSaved={refresh}
                        onError={setError}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Inline forms ──────────────────────────────────────────────────────────────

function CategoryForm({
  onCancel,
  onSaved,
  onError,
}: {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations("quality");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createQualityCategory({
        name: name.trim(),
        description: description.trim() || null,
      });
      setName("");
      setDescription("");
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card space-y-3 rounded-2xl border border-dashed p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("rubric.categoryNamePlaceholder")}
          maxLength={120}
          className={cn(inputBase, "px-3 py-2")}
          data-testid="quality-category-name"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("rubric.categoryDescPlaceholder")}
          maxLength={500}
          className={cn(inputBase, "px-3 py-2")}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !name.trim()} onClick={() => void save()} data-testid="quality-category-save">
          {t("rubric.saveCategory")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The add-a-criterion row. Stays mounted and self-clears after each save so a rubric can be typed
 * straight down the page without re-opening anything.
 */
function CriterionForm({
  categoryId,
  onSaved,
  onError,
}: {
  categoryId: string;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations("quality");
  const [name, setName] = useState("");
  const [percent, setPercent] = useState("");
  const [busy, setBusy] = useState(false);

  const percentValue = Number.parseFloat(percent);
  const valid =
    name.trim().length > 0 &&
    Number.isFinite(percentValue) &&
    percentValue > 0 &&
    percentValue <= 100;

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      await createQualityCriterion({
        category_id: categoryId,
        name: name.trim(),
        discount_percent: percentValue,
      });
      setName("");
      setPercent("");
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted/30 flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) void save();
        }}
        placeholder={t("rubric.criterionNamePlaceholder")}
        maxLength={200}
        className={cn(inputBase, "min-w-40 flex-1 px-3 py-1.5")}
        data-testid="quality-criterion-name"
      />
      <div className="relative">
        <input
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valid) void save();
          }}
          inputMode="decimal"
          dir="ltr"
          placeholder="5"
          className={cn(inputBase, "w-24 px-3 py-1.5 pe-7 text-end tabular-nums")}
          aria-label={t("rubric.percentLabel")}
          data-testid="quality-criterion-percent"
        />
        <Percent
          className="text-muted-foreground pointer-events-none absolute end-2.5 top-1/2 size-3 -translate-y-1/2"
          aria-hidden
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !valid}
        onClick={() => void save()}
        data-testid="quality-criterion-save"
      >
        <Plus className="size-3.5" aria-hidden />
        {t("rubric.addCriterion")}
      </Button>
    </div>
  );
}
