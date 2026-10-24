"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { fieldClass } from "@/components/groups/group-format";
import { listStudents, type StudentRow } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Pick students for a group — a search over the academy's active students (name, parent, any of
 * their phone numbers) and a checkbox list. Shared by "Add students" on a group and by the group
 * form itself, so a class can be created with its students in one go. The caller owns the picked
 * set; `exclude` hides whoever is already in.
 */
export function StudentPicker({
  picked,
  onToggle,
  exclude,
}: {
  picked: Set<string>;
  onToggle: (studentId: string) => void;
  exclude?: Set<string>;
}) {
  const t = useTranslations("groups");
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    void listStudents({ pageSize: 200, filter: { status: "active" } })
      .then((res) => setStudents(res.rows))
      .catch(() => setStudents([]));
  }, []);

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // A number is searched by its digits, without the local leading 0 — "0100 123" finds +20100123….
    const digits = needle.replace(/\D/g, "").replace(/^0+/, "");
    const phoneMatches = (s: StudentRow) =>
      digits.length >= 3 &&
      [s.whatsapp_phone, s.secondary_phone, s.guardian_phone].some((p) => (p ?? "").replace(/\D/g, "").includes(digits));
    return (students ?? [])
      .filter((s) => !exclude?.has(s.id))
      .filter(
        (s) =>
          !needle ||
          s.full_name.toLowerCase().includes(needle) ||
          (s.guardian_name ?? "").toLowerCase().includes(needle) ||
          phoneMatches(s),
      );
  }, [students, q, exclude]);

  return (
    <div className="space-y-3" data-testid="student-picker">
      <label className="relative block">
        <Search className="text-muted-foreground absolute top-1/2 size-4 -translate-y-1/2 ltr:left-3 rtl:right-3" />
        <input className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("members.searchStudentsOrPhone")} aria-label={t("members.searchStudents")} />
      </label>

      <div className="max-h-72 overflow-y-auto rounded-xl border">
        {students === null ? (
          <p className="text-muted-foreground p-4 text-center text-sm">{t("loading")}</p>
        ) : options.length === 0 ? (
          <p className="text-muted-foreground p-4 text-center text-sm">{t("members.noStudents")}</p>
        ) : (
          <ul className="divide-y">
            {options.map((s) => (
              <li key={s.id}>
                <label className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => onToggle(s.id)} data-testid={`pick-${s.id}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.full_name}</span>
                    {s.guardian_name && !s.is_self_guardian && (
                      <span className="text-muted-foreground block truncate text-xs">{s.guardian_name}</span>
                    )}
                  </span>
                  {/* The student's own number, else the parent's — enough to tell two same-named students apart. */}
                  {(s.whatsapp_phone ?? s.guardian_phone) && (
                    <span dir="ltr" className="text-muted-foreground shrink-0 text-xs tabular-nums" data-testid={`pick-phone-${s.id}`}>
                      {s.whatsapp_phone ?? s.guardian_phone}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
