"use client";

import { Users2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { GroupAssignment, useReminderError } from "@/components/lesson-reminders/group-assignment";
import { AlertBanner } from "@/components/ui/alert";
import { ProfileCard } from "@/components/ui/profile-card";
import {
  getReminderPerson,
  listReminderGroups,
  type ReminderGroupOption,
  type ReminderPerson,
  type ReminderPersonKind,
} from "@/lib/lesson-reminders-api";

/**
 * The WhatsApp group on a student's or teacher's profile. It does not exist unless a Super Admin
 * switched the feature on for this client (opt-in, so strict: no capability list means off) and the
 * reader may edit this person.
 */
export function PersonGroupCard({ kind, personId }: { kind: ReminderPersonKind; personId: string }) {
  const { can, session } = useAuth();
  const enabled =
    (session?.capabilities?.includes("whatsapp.group_reminders") ?? false) && can(kind === "student" ? "student.update" : "teacher.update");

  return enabled ? <Card kind={kind} personId={personId} /> : null;
}

function Card({ kind, personId }: { kind: ReminderPersonKind; personId: string }) {
  const t = useTranslations("settings.lessonReminders");
  const describe = useReminderError();
  const [person, setPerson] = useState<ReminderPerson | null>(null);
  const [groups, setGroups] = useState<ReminderGroupOption[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getReminderPerson(kind, personId)
      .then((res) => {
        if (live) setPerson(res.person);
      })
      .catch((err: unknown) => {
        if (live) setError(describe(err));
      });
    listReminderGroups()
      .then((res) => {
        if (!live) return;
        setGroups(res.groups);
        setGroupsLoaded(true);
      })
      .catch((err: unknown) => {
        if (live) setError(describe(err));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `describe` only formats; reload per person.
  }, [kind, personId]);

  return (
    <ProfileCard
      icon={Users2}
      title={t("cardTitle")}
      description={t(kind === "student" ? "cardDescStudent" : "cardDescTeacher")}
      tone="emerald"
      testId="person-group-card"
    >
      {error && (
        <div className="mb-3">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {person && (
        <GroupAssignment
          kind={kind}
          person={person}
          groups={groups}
          groupsLoaded={groupsLoaded}
          canEdit
          onSaved={setPerson}
          onError={setError}
        />
      )}
    </ProfileCard>
  );
}
