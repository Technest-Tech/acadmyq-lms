"use client";

import { useState } from "react";
import { StudentDetail } from "@/components/students/student-detail";
import { StudentForm } from "@/components/students/student-form";
import { StudentsList } from "@/components/students/students-list";

type View = { kind: "list" } | { kind: "new" } | { kind: "detail"; id: string };

/**
 * The students container: routes between the server-driven list, the create form, and a
 * student's detail (subscription, teacher, history) — all inside the authenticated shell.
 */
export function StudentManager() {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "new") {
    return (
      <StudentForm
        onCancel={() => setView({ kind: "list" })}
        onCreated={(id) => setView({ kind: "detail", id })}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <StudentDetail
        studentId={view.id}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <StudentsList
      onNew={() => setView({ kind: "new" })}
      onOpen={(id) => setView({ kind: "detail", id })}
    />
  );
}
