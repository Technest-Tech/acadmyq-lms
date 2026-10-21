"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { fieldClass } from "@/components/groups/group-format";
import { Modal } from "@/components/ui/modal";
import { listStudents } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Pick who is paying: search a student (or their parent) by name or phone — searched on the server,
 * so a big academy is never cut off at a page — and their family's account opens in Collect.
 */
export function PayerPicker({ open, onClose, onPick, title, hint }: { open: boolean; onClose: () => void; onPick: (studentId: string) => void; title?: string; hint?: string }) {
  const t = useTranslations("accounting");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string; sub: string | null }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const id = setTimeout(() => {
      void listStudents({ search: q.trim() || undefined, pageSize: 20, sort: "name" })
        .then((res) =>
          alive &&
          setRows(
            res.rows.map((s) => ({
              id: s.id,
              name: s.full_name,
              sub: !s.is_self_guardian && s.guardian_name ? t("register.pickParent", { name: s.guardian_name }) : s.whatsapp_phone,
            })),
          ),
        )
        .catch(() => alive && setRows([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [open, q, t]);

  useEffect(() => {
    if (open) setQ("");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title ?? t("register.pickTitle")} description={hint ?? t("register.pickHint")} size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <input autoFocus className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("register.pickPlaceholder")} data-testid="picker-search" />
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border" data-testid="picker-results">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)} className="hover:bg-muted/60 flex w-full flex-col items-start p-3 text-start" data-testid={`picker-${r.id}`}>
                <span className="font-medium break-words">{r.name}</span>
                {r.sub && <span className="text-muted-foreground text-xs break-words">{r.sub}</span>}
              </button>
            </li>
          ))}
          {!loading && rows.length === 0 && <li className="text-muted-foreground p-4 text-center text-sm">{t("register.pickNone")}</li>}
        </ul>
      </div>
    </Modal>
  );
}
