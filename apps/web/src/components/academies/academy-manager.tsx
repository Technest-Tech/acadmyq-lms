"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AcademiesList } from "@/components/academies/academies-list";
import { AcademyDetail } from "@/components/academies/academy-detail";
import { AcademyWizard } from "@/components/academies/academy-wizard";
import { type AcademyListItem, listAcademies } from "@/lib/api";

type View = { kind: "list" } | { kind: "new" } | { kind: "detail"; id: string };

/**
 * The academy-management container (Super Admin). Routes between the platform list, the
 * create wizard, and an academy's detail view — all inside the authenticated shell. After a
 * create the new academy opens directly so its report fields can be reviewed.
 */
export function AcademyManager() {
  const t = useTranslations("academies");
  const [view, setView] = useState<View>({ kind: "list" });
  const [academies, setAcademies] = useState<AcademyListItem[] | null>(null);

  const refresh = useCallback(async () => {
    const res = await listAcademies();
    setAcademies(res.academies);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (view.kind === "new") {
    return (
      <AcademyWizard
        onCancel={() => setView({ kind: "list" })}
        onCreated={(id) => {
          void refresh();
          setView({ kind: "detail", id });
        }}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <AcademyDetail
        academyId={view.id}
        onBack={() => {
          void refresh();
          setView({ kind: "list" });
        }}
      />
    );
  }

  if (academies === null) {
    return <p className="text-muted-foreground text-sm">{t("loading")}</p>;
  }

  return (
    <AcademiesList
      academies={academies}
      onNew={() => setView({ kind: "new" })}
      onOpen={(id) => setView({ kind: "detail", id })}
    />
  );
}
