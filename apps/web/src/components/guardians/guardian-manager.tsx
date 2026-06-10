"use client";

import { useState } from "react";
import { GuardianDetail } from "@/components/guardians/guardian-detail";
import { GuardianForm } from "@/components/guardians/guardian-form";
import { GuardiansList } from "@/components/guardians/guardians-list";

type View = { kind: "list" } | { kind: "new" } | { kind: "detail"; id: string };

/** The guardians container: list ↔ create ↔ detail (with inline add-child), in the shell. */
export function GuardianManager() {
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "new") {
    return (
      <GuardianForm
        onCancel={() => setView({ kind: "list" })}
        onCreated={(id) => setView({ kind: "detail", id })}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <GuardianDetail
        guardianId={view.id}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <GuardiansList
      onNew={() => setView({ kind: "new" })}
      onOpen={(id) => setView({ kind: "detail", id })}
    />
  );
}
