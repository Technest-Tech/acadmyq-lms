"use client";

import { useState } from "react";
import { TeacherDetail } from "@/components/teachers/teacher-detail";
import { TeacherForm } from "@/components/teachers/teacher-form";
import { TeachersList } from "@/components/teachers/teachers-list";

type View = { kind: "list" } | { kind: "new" } | { kind: "detail"; id: string };

/** The teachers container: list ↔ create ↔ detail, inside the authenticated shell. */
export function TeacherManager() {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "new") {
    return (
      <TeacherForm
        onCancel={() => setView({ kind: "list" })}
        onCreated={(id) => setView({ kind: "detail", id })}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <TeacherDetail
        teacherId={view.id}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <TeachersList
      onNew={() => setView({ kind: "new" })}
      onOpen={(id) => setView({ kind: "detail", id })}
    />
  );
}
