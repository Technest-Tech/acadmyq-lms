"use client";

import { KeyRound, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { ApiError, getAutomationOverview, type AutomationOverviewRow } from "@/lib/api";
import { ManageModal, StatusPill } from "./manage-modal";

/**
 * API Clients directory (docs/whatsapp-api). Lists the academies that can consume the WhatsApp
 * service over the external API, with their connection status and live API-key count. Any academy can
 * be issued keys + a public connect link from its Manage panel (the API Access section).
 */
export function ApiClientsTab() {
  const t = useTranslations("adminAutomation");
  const [rows, setRows] = useState<AutomationOverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyWithKeys, setOnlyWithKeys] = useState(false);
  const [managing, setManaging] = useState<AutomationOverviewRow | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await getAutomationOverview()).academies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!onlyWithKeys || r.api_key_count > 0) &&
        (needle === "" || r.academy_name.toLowerCase().includes(needle)),
    );
  }, [rows, q, onlyWithKeys]);

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} />}

      <p className="text-muted-foreground text-sm">{t("apiClients.intro")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="bg-background w-full rounded-lg border ps-8 pe-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <label className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={onlyWithKeys} onChange={(e) => setOnlyWithKeys(e.target.checked)} />
          {t("apiClients.onlyWithKeys")}
        </label>
      </div>

      <div className="bg-card overflow-x-auto rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b text-xs">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t("apiClients.colClient")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("apiClients.colConnection")}</th>
              <th className="px-4 py-2.5 text-center font-medium">{t("apiClients.colKeys")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("apiClients.colAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered === null ? (
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <td colSpan={4} className="px-4 py-3">
                    <div className="bg-muted h-5 animate-pulse rounded" aria-hidden />
                  </td>
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted-foreground px-4 py-8 text-center">
                  {t("apiClients.empty")}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.academy_id} className="hover:bg-muted/40">
                  <td className="px-4 py-2.5 font-medium">{r.academy_name}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill state={r.wasender_session_status} />
                  </td>
                  <td className="px-4 py-2.5 text-center tabular-nums">
                    {r.api_key_count > 0 ? (
                      <span className="inline-flex items-center gap-1 font-medium">
                        <KeyRound className="size-3.5" aria-hidden />
                        {r.api_key_count}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <button
                      type="button"
                      onClick={() => setManaging(r)}
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                    >
                      <KeyRound className="size-3.5" aria-hidden />
                      {t("apiClients.manageAccess")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {managing && (
        <ManageModal
          academy={managing}
          onClose={() => setManaging(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
