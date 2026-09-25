"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Field, fieldClass } from "@/components/admin/field";
import { SectionCard } from "@/components/admin/section-card";
import { useAuth } from "@/components/auth-provider";
import { ModuleIcon } from "@/components/clients/module-chips";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  updateClientModuleFeatures,
  type ClientFeatureCatalog,
  type ModuleCode,
  type ModuleSubscription,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { decodeOverrides } from "./client-summary";
import { useFeatureLabels } from "./feature-labels";

/**
 * The per-client feature switches (05-MODULES-NOT-PACKAGES §4) — the whole point of dropping
 * packages. A module gives this client EVERY feature it owns; this panel is where a Super Admin
 * takes one away, and where an optional cap gets set. Everything is on until we decide otherwise,
 * so a switch that is off is always a deliberate decision about this one client.
 */
export function FeaturesCard({
  clientId,
  catalog,
  modules,
  onChanged,
}: {
  clientId: string;
  catalog: ClientFeatureCatalog;
  modules: ModuleSubscription[];
  onChanged: () => void;
}) {
  const t = useTranslations("clients.features");
  const tm = useTranslations("clients.modules");
  const { can } = useAuth();
  const canManage = can("academy_billing.manage");

  // Only modules the client actually holds can have their features switched.
  const live = modules.filter((m) => catalog.modules[m.module] !== undefined);

  if (live.length === 0) {
    return null;
  }

  return (
    <SectionCard
      icon={SlidersHorizontal}
      title={t("title")}
      description={t("hint")}
      flush
      testId="features-card"
    >
      <div className="divide-y">
        {live.map((sub) => (
          <ModuleFeatures
            key={sub.module}
            clientId={clientId}
            sub={sub}
            label={tm(sub.module)}
            capabilities={catalog.modules[sub.module]?.capabilities ?? {}}
            limitKeys={catalog.modules[sub.module]?.limits ?? {}}
            canManage={canManage}
            onChanged={onChanged}
          />
        ))}
      </div>
    </SectionCard>
  );
}

function ModuleFeatures({
  clientId,
  sub,
  label,
  capabilities,
  limitKeys,
  canManage,
  onChanged,
}: {
  clientId: string;
  sub: ModuleSubscription;
  label: string;
  capabilities: Record<string, string>;
  limitKeys: Record<string, string>;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("clients.features");
  const labels = useFeatureLabels();
  const toast = useToast();
  const stored = useMemo(() => decodeOverrides(sub.overrides), [sub.overrides]);

  const [disabled, setDisabled] = useState<string[]>(stored.disabled);
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(stored.limits).map(([k, v]) => [k, String(v)]),
    ),
  );
  const [busy, setBusy] = useState(false);

  // A refetch (or another edit on the page) re-seeds the form from the server's truth.
  useEffect(() => {
    setDisabled(stored.disabled);
    setLimits(
      Object.fromEntries(
        Object.entries(stored.limits).map(([k, v]) => [k, String(v)]),
      ),
    );
  }, [stored]);

  const dirty =
    JSON.stringify([...disabled].sort()) !==
      JSON.stringify([...stored.disabled].sort()) ||
    JSON.stringify(cleanLimits(limits)) !== JSON.stringify(stored.limits);

  const reset = () => {
    setDisabled(stored.disabled);
    setLimits(
      Object.fromEntries(
        Object.entries(stored.limits).map(([k, v]) => [k, String(v)]),
      ),
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      await updateClientModuleFeatures(clientId, sub.module as ModuleCode, {
        disabled,
        limits: cleanLimits(limits),
      });
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const offCount = disabled.length;

  return (
    <div className="px-5 py-4" data-testid={`features-${sub.module}`}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <ModuleIcon
          code={sub.module as ModuleCode}
          className="size-7 text-[10px]"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{label}</p>
          <p
            className={cn(
              "text-xs",
              offCount === 0
                ? "text-muted-foreground"
                : "text-amber-700 dark:text-amber-300",
            )}
          >
            {offCount === 0
              ? t("allOn")
              : t("someOff", {
                  count: offCount,
                  total: Object.keys(capabilities).length,
                })}
          </p>
        </div>
        {canManage && dirty && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={reset}>
              {t("reset")}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={save}
              data-testid={`save-${sub.module}`}
            >
              {t("save")}
            </Button>
          </div>
        )}
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(capabilities).map(([key, featureLabel]) => {
          const on = !disabled.includes(key);

          return (
            <li key={key}>
              <label
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  on ? "bg-card hover:bg-muted/30" : "bg-muted/40",
                  canManage ? "cursor-pointer" : "cursor-default opacity-70",
                )}
              >
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-sm font-medium",
                      !on && "text-muted-foreground",
                    )}
                  >
                    {labels.capability(key, featureLabel)}
                  </span>
                  <code className="text-muted-foreground/60 block truncate font-mono text-[10px]">
                    {key}
                  </code>
                </span>
                <Switch
                  checked={on}
                  disabled={!canManage}
                  data-testid={`feature-${key}`}
                  onChange={(e) =>
                    setDisabled((prev) =>
                      e.target.checked
                        ? prev.filter((k) => k !== key)
                        : [...prev, key],
                    )
                  }
                />
              </label>
            </li>
          );
        })}
      </ul>

      {Object.keys(limitKeys).length > 0 && (
        <div className="mt-4">
          <p className="text-muted-foreground mb-2 text-xs font-semibold">
            {t("caps")}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {Object.entries(limitKeys).map(([key, capLabel]) => (
              <Field key={key} label={labels.limit(key, capLabel)}>
                <input
                  type="number"
                  min={0}
                  value={limits[key] ?? ""}
                  disabled={!canManage}
                  placeholder={t("unlimited")}
                  data-testid={`cap-${key}`}
                  onChange={(e) =>
                    setLimits((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  className={cn(fieldClass, "tabular-nums")}
                />
              </Field>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Blank cap ⇒ the key is dropped ⇒ unlimited (limits fail open). */
function cleanLimits(limits: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(limits)) {
    if (value !== "" && value !== null && Number.isFinite(Number(value))) {
      out[key] = Number(value);
    }
  }

  return out;
}
