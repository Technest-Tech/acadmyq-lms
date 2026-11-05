"use client";

import { AlertTriangle, Check, Loader2, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import {
  assignReminderGroup,
  testReminderGroup,
  type ReminderGroupOption,
  type ReminderPerson,
  type ReminderPersonKind,
} from "@/lib/lesson-reminders-api";
import { foldForSearch } from "@/lib/search-fold";
import { cn } from "@/lib/utils";

const KNOWN_ERRORS = new Set(["not_connected", "gateway_unavailable", "not_a_member", "admins_only", "nobody_to_remind", "no_timing"]);

/** What went wrong in the reader's language, from the code the API answers with. */
export function useReminderError() {
  const t = useTranslations("settings.lessonReminders.errors");

  return (err: unknown): string => {
    if (err instanceof ApiError) {
      const code = (err.body as { error?: unknown } | undefined)?.error;
      return typeof code === "string" && KNOWN_ERRORS.has(code) ? t(code) : err.message;
    }
    return String(err);
  };
}

/**
 * The groups as this person's picker offers them, those named like the person first — academies
 * tend to call a family's group after the child, and a long list is where the wrong family gets
 * picked. A group the number has left is no longer listed, so the current one is added back to stay
 * visible until someone changes it.
 */
export function useGroupOptions(person: ReminderPerson, groups: ReminderGroupOption[]): ComboboxOption[] {
  const t = useTranslations("settings.lessonReminders");

  return useMemo(() => {
    const needle = foldForSearch(person.name);
    const matches = (name: string) => needle !== "" && foldForSearch(name).includes(needle);
    const sorted = [...groups].sort((a, b) => Number(matches(b.name)) - Number(matches(a.name)));

    const options: ComboboxOption[] = [
      { value: "", label: t("noGroup") },
      ...sorted.map((g) => {
        const used = g.assigned_students + g.assigned_teachers + g.assigned_classes;
        return {
          value: g.jid,
          label: g.name,
          sublabel: !g.can_send ? t("adminsOnly") : used > 0 ? t("usedBy", { count: used }) : t("members", { count: g.size }),
        };
      }),
    ];
    if (person.group && !groups.some((g) => g.jid === person.group?.jid)) {
      options.push({ value: person.group.jid, label: person.group.name, sublabel: t("notListedShort") });
    }
    return options;
  }, [groups, person, t]);
}

/**
 * One person's group: the picker, how the last reminder went, and a test message. Saves the moment
 * a group is picked. The list of groups comes from the caller, so a page of rows reads it once.
 */
export function GroupAssignment({
  kind,
  person,
  groups,
  groupsLoaded,
  canEdit,
  onSaved,
  onError,
}: {
  kind: ReminderPersonKind;
  person: ReminderPerson;
  groups: ReminderGroupOption[];
  /** The number's list arrived; until then a missing group proves nothing. */
  groupsLoaded: boolean;
  canEdit: boolean;
  onSaved: (person: ReminderPerson) => void;
  onError: (message: string) => void;
}) {
  const t = useTranslations("settings.lessonReminders");
  const toast = useToast();
  const describe = useReminderError();
  const options = useGroupOptions(person, groups);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const group = person.group;
  const notListed = groupsLoaded && group !== null && !groups.some((g) => g.jid === group.jid);
  const adminsOnly = groupsLoaded && group !== null && groups.some((g) => g.jid === group.jid && !g.can_send);

  async function pick(jid: string) {
    if (jid === (group?.jid ?? "")) return;
    setBusy(true);
    try {
      onSaved((await assignReminderGroup(kind, person.id, jid === "" ? null : jid)).person);
    } catch (err) {
      onError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!group) return;
    setTesting(true);
    try {
      await testReminderGroup(group.id);
      toast.success(t("testSent", { group: group.name }));
    } catch (err) {
      onError(describe(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <Combobox
            options={options}
            value={group?.jid ?? ""}
            onChange={(jid) => void pick(jid)}
            placeholder={t("pickGroup")}
            searchPlaceholder={t("searchGroups")}
            disabled={!canEdit || busy}
            data-testid={`reminder-group-${person.id}`}
          />
        </div>
        {busy && <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" aria-hidden />}
        {group && canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testing}
            onClick={() => void sendTest()}
            data-testid={`reminder-test-${person.id}`}
          >
            {testing ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            {t("test")}
          </Button>
        )}
      </div>

      {notListed || adminsOnly ? (
        <p className="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400" data-testid={`reminder-warning-${person.id}`}>
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {notListed ? t("notListed") : t("adminsOnlyWarning")}
        </p>
      ) : (
        group?.last_status && <LastDelivery status={group.last_status} />
      )}
    </div>
  );
}

function LastDelivery({ status }: { status: string }) {
  const t = useTranslations("settings.lessonReminders.last");
  const good = status === "SENT" || status === "DELIVERED";
  const Icon = good ? Check : X;

  return (
    <p className={cn("flex items-center gap-1.5 text-xs", good ? "text-muted-foreground" : "text-destructive font-medium")}>
      <Icon className="size-3 shrink-0" aria-hidden />
      {t(good ? "ok" : status === "EXPIRED" ? "missed" : "failed")}
    </p>
  );
}
