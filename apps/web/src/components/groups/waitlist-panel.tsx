"use client";

import { ArrowDown, ArrowUp, Armchair, ListOrdered, Phone, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass, textareaClass, todayIn } from "@/components/groups/group-format";
import { PASTEL } from "@/components/groups/group-look";
import { StudentPicker } from "@/components/groups/student-picker";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  addToWaitlist,
  getGroupWaitlist,
  removeFromWaitlist,
  reorderWaitlist,
  seatFromWaitlist,
  type GroupDetail,
  type Waitlist,
  type WaitlistEntry,
} from "@/lib/groups-api";
import { useModernLook } from "@/lib/capabilities";
import { cn } from "@/lib/utils";

/**
 * The waiting list of a full group (docs/centre-profile, Phase 2 §2): the names in order, add
 * (a registered student or a walk-in's name and phone), seat / remove, and up-down reordering.
 * Nothing seats itself: when seats are open and someone is waiting, the panel says so and the desk
 * seats the next name — through the same "add member" rule, so a full group still refuses.
 */
export function WaitlistPanel({ group, onGroupChanged }: { group: GroupDetail; onGroupChanged: (g: GroupDetail) => void }) {
  const t = useTranslations("courseTerm");
  const { can } = useAuth();
  const canManage = can("group.manage") && group.status === "ACTIVE";
  const look = useModernLook();
  const [list, setList] = useState<Waitlist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await getGroupWaitlist(group.id));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("waitlist.loadFailed")));
    }
  }, [group.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, action: () => Promise<Waitlist>, message: string) {
    setBusyId(id);
    setError(null);
    try {
      setList(await action());
      setNotice(message);
    } catch (err) {
      setError(apiErrorMessage(err, t("waitlist.failed")));
    } finally {
      setBusyId(null);
    }
  }

  async function seat(entry: WaitlistEntry) {
    setBusyId(entry.id);
    setError(null);
    try {
      const res = await seatFromWaitlist(group.id, entry.id, todayIn(group.timezone));
      setList({ entries: res.entries, waiting_count: res.waiting_count, member_count: res.member_count, capacity: res.capacity, free_seats: res.free_seats });
      setNotice(t("waitlist.seated", { name: entry.name }));
      onGroupChanged(res.group);
    } catch (err) {
      setError(apiErrorMessage(err, t("waitlist.failed")));
    } finally {
      setBusyId(null);
    }
  }

  function move(index: number, dir: -1 | 1) {
    if (!list) return;
    const ids = list.entries.map((e) => e.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void run(ids[target]!, () => reorderWaitlist(group.id, ids), "");
  }

  const entries = list?.entries ?? [];
  const freeSeats = list?.free_seats ?? null;

  return (
    <section className={cn("space-y-3 rounded-2xl border p-4", look && "centre-surface bg-card sm:p-5")} data-testid="waitlist-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={cn("min-w-0", look && "flex items-center gap-3")}>
          {look && (
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", PASTEL.amber)}>
              <ListOrdered className="size-5" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <p className={cn("flex items-center gap-1.5 font-semibold", look && "text-base font-extrabold")}>
              {!look && <ListOrdered className="text-muted-foreground size-4" aria-hidden />}
              {t("waitlist.title")}
              {list && <span className="text-muted-foreground text-sm font-normal tabular-nums">({list.waiting_count})</span>}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">{t("waitlist.hint")}</p>
          </div>
        </div>
        {canManage && (
          <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={() => setAdding(true)} data-testid="waitlist-add">
            <UserPlus className="size-3.5" />
            {t("waitlist.add")}
          </Button>
        )}
      </div>

      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {freeSeats !== null && freeSeats > 0 && entries.length > 0 && (
        <p className="flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-800 dark:text-emerald-200" data-testid="waitlist-free-seats">
          <Armchair className="size-4" aria-hidden />
          {t("waitlist.freeSeats", { count: freeSeats })}
        </p>
      )}

      {list === null ? (
        <p className="text-muted-foreground py-4 text-center text-sm">…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-5 text-center text-sm">{t("waitlist.empty")}</p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-xl border" data-testid="waitlist-entries">
          {entries.map((e, i) => (
            <li key={e.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`waitlist-entry-${e.id}`}>
              <div className="flex min-w-0 items-center gap-3">
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums", look ? PASTEL.violet : "bg-muted text-muted-foreground")}>{e.position}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {e.name}
                    {e.student_id === null && <span className="text-muted-foreground ms-1.5 text-xs font-normal">({t("waitlist.walkInTag")})</span>}
                  </p>
                  <p className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                    {e.phone && (
                      <span className="inline-flex items-center gap-1" dir="ltr">
                        <Phone className="size-3" aria-hidden />
                        {e.phone}
                      </span>
                    )}
                    {e.note && <span>{e.note}</span>}
                    {e.added_by_name && <span>{t("waitlist.addedBy", { name: e.added_by_name })}</span>}
                  </p>
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("waitlist.moveUp")} disabled={i === 0 || busyId !== null} onClick={() => move(i, -1)} data-testid={`waitlist-up-${e.id}`}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("waitlist.moveDown")} disabled={i === entries.length - 1 || busyId !== null} onClick={() => move(i, 1)} data-testid={`waitlist-down-${e.id}`}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={freeSeats === null || freeSeats > 0 ? "default" : "secondary"}
                    className="gap-1"
                    disabled={busyId !== null || e.student_id === null}
                    title={e.student_id === null ? t("waitlist.seatWalkIn") : undefined}
                    onClick={() => void seat(e)}
                    data-testid={`waitlist-seat-${e.id}`}
                  >
                    <Armchair className="size-3.5" />
                    {t("waitlist.seat")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("waitlist.remove")}
                    disabled={busyId !== null}
                    onClick={() => void run(e.id, () => removeFromWaitlist(group.id, e.id), t("waitlist.removed"))}
                    data-testid={`waitlist-remove-${e.id}`}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title={t("waitlist.addTitle")} description={t("waitlist.addHint")} size="lg">
        {adding && (
          <AddToWaitlistForm
            group={group}
            onCancel={() => setAdding(false)}
            onSaved={(l) => {
              setList(l);
              setAdding(false);
              setNotice(t("waitlist.added"));
            }}
          />
        )}
      </Modal>
    </section>
  );
}

function AddToWaitlistForm({ group, onCancel, onSaved }: { group: GroupDetail; onCancel: () => void; onSaved: (l: Waitlist) => void }) {
  const t = useTranslations("courseTerm");
  const tGroups = useTranslations("groups");
  const [mode, setMode] = useState<"student" | "walkIn">("student");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Members already in the group are not offered — the server would refuse them anyway.
  const inGroup = useMemo(() => new Set(group.members.filter((m) => m.status === "ACTIVE").map((m) => m.student_id)), [group.members]);

  // One name at a time: picking another replaces the first.
  function toggle(id: string) {
    setPicked((prev) => (prev.has(id) ? new Set() : new Set([id])));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const studentId = mode === "student" ? [...picked][0] : undefined;
    if (mode === "student" && !studentId) return setError(t("waitlist.errors.pick"));
    if (mode === "walkIn" && !name.trim()) return setError(t("waitlist.errors.name"));
    setBusy(true);
    setError(null);
    try {
      const res = await addToWaitlist(group.id, {
        ...(mode === "student" ? { student_id: studentId } : { name: name.trim(), phone: phone.trim() || null }),
        note: note.trim() || null,
      });
      onSaved({ entries: res.entries, waiting_count: res.waiting_count, member_count: res.member_count, capacity: res.capacity, free_seats: res.free_seats });
    } catch (err) {
      setError(apiErrorMessage(err, t("waitlist.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="waitlist-add-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-2 gap-2" role="radiogroup">
        {(["student", "walkIn"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn("rounded-xl border px-3 py-2 text-sm font-medium transition-colors", mode === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}
            data-testid={`waitlist-mode-${m}`}
          >
            {m === "student" ? t("waitlist.pickStudent") : t("waitlist.walkIn")}
          </button>
        ))}
      </div>

      {mode === "student" ? (
        <StudentPicker picked={picked} onToggle={toggle} exclude={inGroup} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              {t("waitlist.name")} <span className="text-destructive">*</span>
            </span>
            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="waitlist-name" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("waitlist.phone")}</span>
            <input className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" maxLength={40} data-testid="waitlist-phone" />
          </label>
        </div>
      )}

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("waitlist.note")}</span>
        <textarea className={textareaClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("waitlist.notePlaceholder")} maxLength={500} data-testid="waitlist-note" />
      </label>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {tGroups("form.cancel")}
        </Button>
        <Button type="submit" disabled={busy} className="gap-1.5" data-testid="waitlist-save">
          <UserPlus className="size-4" />
          {busy ? t("waitlist.saving") : t("waitlist.save")}
        </Button>
      </div>
    </form>
  );
}
