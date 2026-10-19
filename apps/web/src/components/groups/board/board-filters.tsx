"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { fieldClass } from "@/components/groups/group-format";
import { listTeachers } from "@/lib/api";
import { listGroups } from "@/lib/groups-api";

export interface BoardFilterOptions {
  groups: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
}

/**
 * The groups and teachers a section page can be narrowed to. A TEACHER only ever sees their own
 * groups (the API scopes the list), and is not offered a teacher filter at all.
 */
export function useBoardFilterOptions(): BoardFilterOptions {
  const { can, session } = useAuth();
  const isTeacher = session?.role === "TEACHER";
  const [options, setOptions] = useState<BoardFilterOptions>({ groups: [], teachers: [] });

  useEffect(() => {
    let live = true;
    void listGroups({ state: "ACTIVE" })
      .then((res) => live && setOptions((o) => ({ ...o, groups: res.groups.map((g) => ({ id: g.id, name: g.name })) })))
      .catch(() => {});
    if (!isTeacher && can("teacher.read")) {
      void listTeachers({ pageSize: 200, filter: { status: "active" } })
        .then((res) => live && setOptions((o) => ({ ...o, teachers: res.rows.map((r) => ({ id: r.id, name: r.full_name })) })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [isTeacher, can]);

  return options;
}

export function BoardFilters({
  options,
  groupId,
  onGroup,
  teacherId,
  onTeacher,
}: {
  options: BoardFilterOptions;
  groupId: string;
  onGroup: (id: string) => void;
  teacherId?: string;
  onTeacher?: (id: string) => void;
}) {
  const t = useTranslations("groups");

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:w-[28rem]">
      <select className={fieldClass} value={groupId} onChange={(e) => onGroup(e.target.value)} aria-label={t("board.filters.group")} data-testid="board-filter-group">
        <option value="">{t("board.filters.allGroups")}</option>
        {options.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      {onTeacher && options.teachers.length > 0 && (
        <select className={fieldClass} value={teacherId ?? ""} onChange={(e) => onTeacher(e.target.value)} aria-label={t("board.filters.teacher")}>
          <option value="">{t("allTeachers")}</option>
          {options.teachers.map((te) => (
            <option key={te.id} value={te.id}>
              {te.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
