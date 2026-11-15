"use client";

import { Briefcase, ShieldCheck, ToggleLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { RoleMatrix } from "../roles/screen";
import { StaffDepartmentsPanel } from "../staff-departments/screen";
import { AdminPageHeader } from "@/components/admin/page-header";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import {
  ApiError,
  getFeatureFlags,
  updateFeatureFlag,
  type FeatureFlag,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// Where clients pay (InstaPay / Vodafone Cash) moved to Accounts → Settings on 2026-11-08. The
// "General" tab (support email + SMTP fields) went on 2026-11-15: it saved values nothing read —
// mail is configured in the server's environment. An old ?tab=general lands on the flags.
const TABS = ["flags", "roles", "departments"] as const;
type SettingsTab = (typeof TABS)[number];

function isSettingsTab(v: string | null): v is SettingsTab {
  return v !== null && (TABS as readonly string[]).includes(v);
}

function Toggle({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        on ? "bg-primary" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
          on ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function PlatformSettingsScreen() {
  const t = useTranslations("platformSettings");
  const { can } = useAuth();

  // R3 (client-first redesign): the rare-touch catalogs — role permissions & staff departments —
  // fold in here as tabs, taking their sidebar slots away (9 flat items).
  const [tab, setTab] = useState<SettingsTab>("flags");

  // Deep-linkable tabs (?tab=roles). Read once on mount, mirror on change — plain History API
  // so the page.tsx server component needs no Suspense boundary for useSearchParams.
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("tab");
    if (isSettingsTab(initial)) setTab(initial);
  }, []);
  const switchTab = useCallback((next: SettingsTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }, []);
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getFeatureFlags()
      .then((r) => setFlags(r.flags))
      .catch(() => setError(t("loadError")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  if (!can("platform.manage")) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  async function toggleFlag(flag: FeatureFlag) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await updateFeatureFlag(flag.key, { enabled: !flag.enabled });
      setFlags(
        (fs) =>
          fs?.map((f) =>
            f.key === flag.key ? { ...f, enabled: !f.enabled } : f,
          ) ?? null,
      );
      setNotice(t("saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const TAB_ICON = {
    flags: ToggleLeft,
    roles: ShieldCheck,
    departments: Briefcase,
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} />}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
        {TABS.map((tk) => {
          const Icon = TAB_ICON[tk];
          return (
            <button
              key={tk}
              type="button"
              role="tab"
              aria-selected={tab === tk}
              onClick={() => switchTab(tk)}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors",
                tab === tk
                  ? "border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
              data-testid={`tab-${tk}`}
            >
              <Icon className="size-4" aria-hidden />
              {t(`tab.${tk}`)}
            </button>
          );
        })}
      </div>

      {/* Feature flags */}
      {tab === "flags" && (
        <section className="space-y-3">
          <p className="text-muted-foreground text-sm">{t("flagsHint")}</p>
          {flags === null ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-muted h-16 animate-pulse rounded-xl"
                  aria-hidden
                />
              ))}
            </div>
          ) : flags.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noFlags")}</p>
          ) : (
            <div className="space-y-2">
              {flags.map((f) => (
                <div
                  key={f.key}
                  className="bg-card flex items-center justify-between gap-4 rounded-xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]"
                  data-flag={f.key}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{f.description ?? f.key}</p>
                    <p
                      className="text-muted-foreground font-mono text-xs"
                      dir="ltr"
                    >
                      {f.key}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        f.enabled
                          ? "text-emerald-600"
                          : "text-muted-foreground",
                      )}
                    >
                      {f.enabled ? t("enabled") : t("disabled")}
                    </span>
                    <Toggle
                      on={f.enabled}
                      disabled={busy}
                      onClick={() => void toggleFlag(f)}
                      label={f.key}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Role permissions matrix (moved from /admin/roles — R3). Content-only: this page
          already owns the h1, so the tab renders the matrix, not a second page. */}
      {tab === "roles" && <RoleMatrix />}

      {/* Staff departments catalog (moved from /admin/staff-departments — R3) */}
      {tab === "departments" && <StaffDepartmentsPanel />}
    </div>
  );
}

