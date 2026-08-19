"use client";

import { Plus, UserCheck, UserCog, Users, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { GuardianDetail } from "@/components/guardians/guardian-detail";
import { GuardianForm } from "@/components/guardians/guardian-form";
import { GuardiansList } from "@/components/guardians/guardians-list";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import { listGuardians } from "@/lib/api";

interface Stats {
  total: number;
  active: number;
  inactive: number;
}

type ModalState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "detail"; id: string; name: string };

/**
 * The guardians book. Same shape as the students roll (hero → segment tiles → one table), because
 * they are the same job done from the other side: a guardian is who the academy bills, and a
 * student is who it teaches.
 */
type SegmentKey = "total" | "active" | "inactive";

const SEGMENT_FILTERS: Record<SegmentKey, Record<string, string>> = {
  total: {},
  active: { status: "active" },
  inactive: { status: "inactive" },
};

export function GuardianManager() {
  const t = useTranslations("guardians");
  const { can } = useAuth();
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [segment, setSegment] = useState<SegmentKey>("total");
  const [presetToken, setPresetToken] = useState(0);
  const [alert, setAlert] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);

  function refresh() {
    setRefreshToken((n) => n + 1);
  }

  /** Clicking the active tile returns to the whole book — a toggle, not a one-way trip. */
  function selectSegment(key: SegmentKey) {
    setSegment((prev) => (prev === key ? "total" : key));
    setPresetToken((n) => n + 1);
  }

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") {
      const timer = setTimeout(() => setAlert(null), 4500);
      return () => clearTimeout(timer);
    }
  }

  useEffect(() => {
    void Promise.all([
      listGuardians({ pageSize: 1 }),
      listGuardians({ pageSize: 1, filter: { status: "active" } }),
      listGuardians({ pageSize: 1, filter: { status: "inactive" } }),
    ])
      .then(([all, active, inactive]) =>
        setStats({
          total: all.total,
          active: active.total,
          inactive: inactive.total,
        }),
      )
      .catch(() => {});
  }, [refreshToken]);

  const detailId = modal.kind === "detail" ? modal.id : null;
  const detailName = modal.kind === "detail" ? modal.name : "";

  const pct = (value: number | null) =>
    stats && stats.total > 0 && value !== null
      ? Math.round((value / stats.total) * 100)
      : null;

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="guardians-hero-lattice"
        icon={UserCog}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {stats && (
              <HeroPill>
                <Users className="size-3.5" aria-hidden />
                {t("hero.onBook", { count: stats.total })}
              </HeroPill>
            )}
            {can("guardian.create") && (
              <Button
                type="button"
                size="lg"
                onClick={() => setModal({ kind: "new" })}
                data-testid="new-guardian"
                className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
              >
                <Plus className="size-4" aria-hidden />
                {t("new")}
              </Button>
            )}
          </>
        }
      />

      {/* ── Segment tiles ───────────────────────────────────────────────── */}
      <div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SegmentTile
            testKey="total"
            icon={Users}
            label={t("stats.total")}
            hint={t("stats.totalSub")}
            value={stats?.total ?? null}
            share={null}
            tone="emerald"
            selected={segment === "total"}
            onSelect={() => selectSegment("total")}
          />
          <SegmentTile
            testKey="active"
            icon={UserCheck}
            label={t("stats.active")}
            hint={t("stats.activeSub")}
            value={stats?.active ?? null}
            share={pct(stats?.active ?? null)}
            tone="teal"
            selected={segment === "active"}
            onSelect={() => selectSegment("active")}
          />
          <SegmentTile
            testKey="inactive"
            icon={UserX}
            label={t("stats.inactive")}
            hint={t("stats.inactiveSub")}
            value={stats?.inactive ?? null}
            share={pct(stats?.inactive ?? null)}
            tone="slate"
            selected={segment === "inactive"}
            onSelect={() => selectSegment("inactive")}
          />
        </div>
        <p className="text-muted-foreground/80 mt-2 text-[11px]">
          {t("stats.filterHint")}
        </p>
      </div>

      {/* ── Alert ────────────────────────────────────────────────────────── */}
      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      {/* ── Guardian list ────────────────────────────────────────────────── */}
      <GuardiansList
        refreshToken={refreshToken}
        filterPreset={{ values: SEGMENT_FILTERS[segment], token: presetToken }}
        onNew={() => setModal({ kind: "new" })}
        onOpen={(id, name) => setModal({ kind: "detail", id, name })}
      />

      {/* ── Create modal ─────────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "new"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("new")}
        description={t("newModal.description")}
        size="md"
      >
        <GuardianForm
          onCancel={() => setModal({ kind: "closed" })}
          onCreated={() => {
            setModal({ kind: "closed" });
            refresh();
            showAlert("success", t("form.saved"));
          }}
        />
      </Modal>

      {/* ── Detail modal ─────────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "detail"}
        onClose={() => setModal({ kind: "closed" })}
        title={detailName}
        size="lg"
      >
        {detailId && (
          <GuardianDetail
            guardianId={detailId}
            onBack={() => setModal({ kind: "closed" })}
            onSaved={() => {
              refresh();
              showAlert("success", t("form.saved"));
            }}
            onDeactivated={() => {
              setModal({ kind: "closed" });
              refresh();
              showAlert("success", t("detail.deactivated"));
            }}
          />
        )}
      </Modal>
    </div>
  );
}
