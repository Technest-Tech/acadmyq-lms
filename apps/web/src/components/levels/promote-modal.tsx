"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { fieldClass, textareaClass } from "@/components/groups/group-format";
import { LevelSelect } from "@/components/levels/level-select";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError } from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { type GroupRow, listGroups } from "@/lib/groups-api";
import { type Level, type LevelHistoryItem, listLevels, type Promotion, promoteStudent } from "@/lib/levels-api";

/**
 * "ترقية": move a student to a new level (docs/centre-profile, Phase 2.1) and, if wanted, into a
 * group of that level on the same day. The group list follows the level picked — only running
 * groups at that level are offered — and the server does the rest: leaves the old level's group on
 * the day, joins the new one, writes the history line.
 */
export function PromoteModal({
  open,
  onClose,
  studentId,
  studentName,
  currentLevelId,
  currentLevelName,
  onPromoted,
}: {
  open: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  currentLevelId: string | null;
  currentLevelName: string | null;
  onPromoted: (result: { promotion: Promotion; history: LevelHistoryItem[] }) => void;
}) {
  const t = useTranslations("levels");
  const groupsOn = useCapability("groups");
  const [levels, setLevels] = useState<Level[] | undefined>(undefined);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [toLevelId, setToLevelId] = useState("");
  const [toGroupId, setToGroupId] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void listLevels()
      .then((res) => live && setLevels(res.levels))
      .catch(() => live && setLevels([]));
    if (groupsOn) {
      void listGroups({ state: "ACTIVE" })
        .then((res) => live && setGroups(res.groups))
        .catch(() => live && setGroups([]));
    }
    return () => {
      live = false;
    };
  }, [open, groupsOn]);

  // Opening again starts clean — the last promotion's choices must not carry over.
  useEffect(() => {
    if (!open) return;
    setToLevelId("");
    setToGroupId("");
    setNote("");
    setError(null);
    setEffectiveOn(new Date().toISOString().slice(0, 10));
  }, [open]);

  const groupOptions = useMemo(
    () => groups.filter((g) => g.level_id === toLevelId && g.state !== "FINISHED"),
    [groups, toLevelId],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!toLevelId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await promoteStudent(studentId, {
        to_level_id: toLevelId,
        to_group_id: toGroupId || null,
        effective_on: effectiveOn || null,
        note: note.trim() || null,
      });
      onPromoted({ promotion: res.promotion, history: res.history });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("promote.title")} description={t("promote.subtitle", { name: studentName })}>
      <form onSubmit={submit} className="space-y-4" data-testid="promote-form">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

        <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-sm">
          <span className="text-muted-foreground">{t("promote.current")}</span>
          <span className="font-semibold">{currentLevelName ?? t("promote.noCurrent")}</span>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            {t("promote.toLevel")}
            <span className="text-destructive ms-0.5">*</span>
          </label>
          <LevelSelect
            value={toLevelId}
            onChange={(id) => {
              setToLevelId(id);
              setToGroupId("");
            }}
            levels={levels}
            noneLabel={t("promote.toLevelPlaceholder")}
            testId="promote-level"
          />
        </div>

        {groupsOn && toLevelId !== "" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("promote.toGroup")}</label>
            <select
              className={fieldClass}
              value={toGroupId}
              onChange={(e) => setToGroupId(e.target.value)}
              aria-label={t("promote.toGroup")}
              data-testid="promote-group"
            >
              <option value="">{t("promote.toGroupNone")}</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.teacher_name ? ` · ${g.teacher_name}` : ""}
                  {g.capacity != null ? ` (${g.member_count}/${g.capacity})` : ""}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">{groupOptions.length === 0 ? t("promote.noGroups") : t("promote.toGroupHint")}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("promote.effectiveOn")}</label>
            <input
              type="date"
              className={fieldClass}
              value={effectiveOn}
              onChange={(e) => setEffectiveOn(e.target.value)}
              aria-label={t("promote.effectiveOn")}
              data-testid="promote-date"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-sm font-medium">{t("promote.note")}</label>
            <textarea
              className={textareaClass}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("promote.notePlaceholder")}
              maxLength={500}
              aria-label={t("promote.note")}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            disabled={busy || toLevelId === "" || (toLevelId === currentLevelId && toGroupId === "")}
            className="gap-1.5"
            data-testid="promote-submit"
          >
            <ArrowUpRight className="size-4" />
            {busy ? t("promote.saving") : t("promote.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
