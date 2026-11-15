"use client";

import { CalendarPlus, Eraser, Loader2, Play, ScanSearch, Undo2, UserMinus, Wrench, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { SectionCard } from "@/components/admin/section-card";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  getClientTools,
  runClientTool,
  type ClientTool,
  type ClientToolKey,
  type ClientToolRun,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const TOOL_ICON: Record<ClientToolKey, LucideIcon> = {
  generate_lessons: CalendarPlus,
  finish_removals: UserMinus,
  restore_half_undone: Undo2,
  clear_deleted_dues: Eraser,
};

/**
 * The client page's "Maintenance" tab: the repair commands that used to need an SSH session, for
 * this one client. A tool that can list what it would do is looked at first — the Apply button
 * only appears under a preview — and a tool with nothing to preview (rolling the lessons forward,
 * which is what the nightly job does anyway) has a single Run button.
 *
 * What comes back is the command's own output, shown as it was printed.
 */
export function ClientToolsTab({ clientId }: { clientId: string }) {
  const t = useTranslations("clients.tools");
  const { can } = useAuth();
  const toast = useToast();

  const [tools, setTools] = useState<ClientTool[] | null>(null);
  const [runnable, setRunnable] = useState(true);
  const [error, setError] = useState(false);
  /** The tool running right now (one at a time: they write to the same client). */
  const [busy, setBusy] = useState<ClientToolKey | null>(null);
  const [results, setResults] = useState<Partial<Record<ClientToolKey, ClientToolRun>>>({});

  const allowed = can("platform.manage");

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    getClientTools(clientId)
      .then((r) => {
        if (!alive) return;
        setTools(r.tools);
        setRunnable(r.runnable);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [allowed, clientId]);

  if (!allowed) {
    return <p className="text-muted-foreground text-sm">{t("noPermission")}</p>;
  }

  const run = async (tool: ClientToolKey, apply: boolean) => {
    setBusy(tool);
    try {
      const result = await runClientTool(clientId, tool, apply);
      setResults((r) => ({ ...r, [tool]: result }));
      if (apply) {
        if (result.ok) toast.success(t("applied"));
        else toast.error(t("failed"));
      }
    } catch (e) {
      toast.error(e instanceof ApiError && e.message ? e.message : t("failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4" role="tabpanel" data-testid="client-tools-tab">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight">{t("title")}</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">{t("hint")}</p>
      </div>

      {error && <AlertBanner variant="error" message={t("loadError")} />}
      {!runnable && <AlertBanner variant="info" message={t("notActive")} />}

      {tools === null && !error && (
        <div className="space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-20 animate-pulse rounded-xl" aria-hidden />
          ))}
        </div>
      )}

      {(tools ?? []).map((tool) => {
        const result = results[tool.key];
        const running = busy === tool.key;
        const disabled = busy !== null || !runnable;
        // Apply is offered only under a preview of the same tool that has not been applied yet.
        const canApply = tool.preview && result !== undefined && !result.applied && result.ok;

        return (
          <SectionCard
            key={tool.key}
            icon={TOOL_ICON[tool.key] ?? Wrench}
            title={t(`tool.${tool.key}.title`)}
            description={t(`tool.${tool.key}.hint`)}
            testId={`tool-${tool.key}`}
            action={
              tool.preview ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void run(tool.key, false)}
                  data-testid={`preview-${tool.key}`}
                >
                  {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <ScanSearch className="size-3.5" aria-hidden />}
                  {t("preview")}
                </Button>
              ) : (
                <Button size="sm" disabled={disabled} onClick={() => void run(tool.key, true)} data-testid={`run-${tool.key}`}>
                  {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                  {t("runNow")}
                </Button>
              )
            }
          >
            {result !== undefined ? (
              <div className="space-y-3">
                <p className={cn("text-xs font-semibold", result.applied ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                  {t(result.applied ? "outputApplied" : "outputPreview")}
                </p>
                <pre
                  dir="ltr"
                  className="bg-muted/50 max-h-72 overflow-auto rounded-lg p-3 text-start text-xs leading-relaxed whitespace-pre-wrap"
                  data-testid={`output-${tool.key}`}
                >
                  {result.output === "" ? t("noOutput") : result.output}
                </pre>
                {canApply && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-muted-foreground text-xs">{t("applyHint")}</span>
                    <Button size="sm" disabled={disabled} onClick={() => void run(tool.key, true)} data-testid={`apply-${tool.key}`}>
                      {running ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                      {t("apply")}
                    </Button>
                  </div>
                )}
              </div>
            ) : undefined}
          </SectionCard>
        );
      })}
    </div>
  );
}
