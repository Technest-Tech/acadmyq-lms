"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { MODULE_STYLE } from "@/components/clients/module-chips";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  updateClientModuleFeatures,
  type ClientFeatureCatalog,
  type ModuleCode,
  type ModuleSubscription,
} from "@/lib/api";
import { cn } from "@/lib/utils";

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
    <section
      className="bg-card overflow-hidden rounded-xl shadow-sm ring-1 ring-foreground/[0.06]"
      data-testid="features-card"
    >
      <header className="bg-muted/40 border-b px-4 py-2.5">
        <h2 className="text-muted-foreground text-[11px] font-bold uppercase tracking-[0.08em]">
          {t("title")}
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">{t("hint")}</p>
      </header>

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
    </section>
  );
}

/** `overrides` arrives as jsonb — an object from the directory read, a string from a write. */
function decodeOverrides(raw: ModuleSubscription["overrides"]): {
  disabled: string[];
  limits: Record<string, number>;
} {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const obj = (parsed ?? {}) as { disabled?: unknown; limits?: unknown };

  return {
    disabled: Array.isArray(obj.disabled) ? obj.disabled.map(String) : [],
    limits:
      obj.limits !== null && typeof obj.limits === "object"
        ? Object.fromEntries(
            Object.entries(obj.limits as Record<string, unknown>).map(([k, v]) => [k, Number(v)]),
          )
        : {},
  };
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
  const toast = useToast();
  const stored = useMemo(() => decodeOverrides(sub.overrides), [sub.overrides]);

  const [disabled, setDisabled] = useState<string[]>(stored.disabled);
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(stored.limits).map(([k, v]) => [k, String(v)])),
  );
  const [busy, setBusy] = useState(false);

  // A refetch (or another edit on the page) re-seeds the form from the server's truth.
  useEffect(() => {
    setDisabled(stored.disabled);
    setLimits(Object.fromEntries(Object.entries(stored.limits).map(([k, v]) => [k, String(v)])));
  }, [stored]);

  const dirty =
    JSON.stringify([...disabled].sort()) !== JSON.stringify([...stored.disabled].sort()) ||
    JSON.stringify(cleanLimits(limits)) !== JSON.stringify(stored.limits);

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
    <div className="px-4 py-3" data-testid={`features-${sub.module}`}>
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm font-bold">
          <span
            className={cn(
              "inline-flex size-5 items-center justify-center rounded-md text-[10px] ring-1",
              MODULE_STYLE[sub.module as ModuleCode].on,
            )}
            aria-hidden
          >
            {MODULE_STYLE[sub.module as ModuleCode].label}
          </span>
          {label}
        </span>
        <span className="text-muted-foreground text-xs">
          {offCount === 0
            ? t("allOn")
            : t("someOff", { count: offCount, total: Object.keys(capabilities).length })}
        </span>
        {canManage && dirty && (
          <div className="ms-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDisabled(stored.disabled);
                setLimits(
                  Object.fromEntries(
                    Object.entries(stored.limits).map(([k, v]) => [k, String(v)]),
                  ),
                );
              }}
            >
              {t("reset")}
            </Button>
            <Button size="sm" disabled={busy} onClick={save} data-testid={`save-${sub.module}`}>
              {t("save")}
            </Button>
          </div>
        )}
      </div>

      <ul className="grid gap-1.5 sm:grid-cols-2">
        {Object.entries(capabilities).map(([key, featureLabel]) => {
          const on = !disabled.includes(key);

          return (
            <li key={key}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-sm",
                  on ? "bg-card" : "bg-muted/40 text-muted-foreground",
                  !canManage && "cursor-default opacity-70",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!canManage}
                  data-testid={`feature-${key}`}
                  onChange={(e) =>
                    setDisabled((prev) =>
                      e.target.checked ? prev.filter((k) => k !== key) : [...prev, key],
                    )
                  }
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">{featureLabel}</span>
                <code className="text-muted-foreground/70 shrink-0 text-[10px]">{key}</code>
              </label>
            </li>
          );
        })}
      </ul>

      {Object.keys(limitKeys).length > 0 && (
        <div className="mt-3">
          <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]">
            {t("caps")}
          </p>
          <div className="flex flex-wrap gap-2.5">
            {Object.entries(limitKeys).map(([key, capLabel]) => (
              <label key={key} className="text-xs font-medium">
                <span className="text-muted-foreground mb-1 block">{capLabel}</span>
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
                  className="bg-card h-8 w-32 rounded-md border px-2 text-sm tabular-nums"
                />
              </label>
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
