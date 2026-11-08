"use client";

import { AlertTriangle, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/admin/empty-state";
import { AdminPageHeader } from "@/components/admin/page-header";
import { AccountPanel } from "@/components/finance/account-panel";
import { accountHref } from "@/components/finance/account-format";
import { AccountsTabs } from "@/components/finance/accounts-tabs";
import { ClientFormModal } from "@/components/finance/client-form-modal";
import { Button } from "@/components/ui/button";
import { ApiError, getAccount, type AccountPayload } from "@/lib/api";

/**
 * One account off our servers — a client who bought the whole system, a course site, a custom
 * job. A platform client's account is a tab of its client page, so this page sends it there:
 * one place per client, never two.
 */
export function AccountScreen({ clientId }: { clientId: string }) {
  const t = useTranslations("accounts");
  const tf = useTranslations("finance");
  const router = useRouter();
  const [data, setData] = useState<AccountPayload | null>(null);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const payload = await getAccount(clientId);
      if (payload.account.academy_id) {
        router.replace(accountHref(payload.account));
        return;
      }
      setData(payload);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "missing" : "failed");
    }
  }, [clientId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-5">
        <AdminPageHeader title={t("title")} backHref="/admin/accounts/contracts" backLabel={t("contracts.back")} />
        <EmptyState
          icon={AlertTriangle}
          message={error === "missing" ? t("contracts.notFound") : t("loadError")}
          action={
            error === "failed" ? (
              <Button variant="outline" size="sm" onClick={load}>
                {t("retry")}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const account = data?.account ?? null;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        backHref="/admin/accounts/contracts"
        backLabel={t("contracts.back")}
        title={account?.name ?? "…"}
        subtitle={account ? [t("contracts.external"), account.phone, account.email].filter(Boolean).join(" · ") : undefined}
        actions={
          account ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil data-icon="inline-start" />
              {tf("actions.edit")}
            </Button>
          ) : undefined
        }
      />
      <AccountsTabs />

      {data === null ? (
        <div className="space-y-4" aria-busy>
          <div className="bg-muted h-40 animate-pulse rounded-xl" />
          <div className="bg-muted h-60 animate-pulse rounded-xl" />
        </div>
      ) : (
        <AccountPanel
          payload={data}
          target={{ kind: "account", clientId, name: data.account.name }}
          onChanged={(p) => (p ? setData(p) : void load())}
        />
      )}

      <ClientFormModal
        open={editing}
        client={account}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          void load();
        }}
        onDeleted={() => router.push("/admin/accounts/contracts")}
      />
    </div>
  );
}
