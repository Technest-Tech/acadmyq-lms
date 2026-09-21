"use client";

import {
  LayoutGrid,
  Plus,
  Table2,
  UserCog,
  UserX,
  Users,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { FamilyBook } from "@/components/guardians/family-book";
import { GuardianForm } from "@/components/guardians/guardian-form";
import { GuardiansList } from "@/components/guardians/guardians-list";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import { listGuardians } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Stats {
  total: number;
  multi: number;
  single: number;
  inactive: number;
}

/**
 * The segments are FAMILY SHAPES, not record states. "Active vs inactive" was a distinction the
 * status filter already made and nobody came to this page to ask; "which families have more than
 * one child here" is the question that actually changes what an academy does — siblings share an
 * invoice, a phone number and usually a decision to leave.
 */
type SegmentKey = "total" | "multi" | "single" | "inactive";

const SEGMENT_FILTERS: Record<SegmentKey, Record<string, string>> = {
  total: {},
  multi: { family: "multi" },
  single: { family: "single" },
  inactive: { status: "inactive" },
};

type View = "board" | "table";

export function GuardianManager() {
  const t = useTranslations("guardians");
  const router = useRouter();
  const { can } = useAuth();

  const [creating, setCreating] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [segment, setSegment] = useState<SegmentKey>("total");
  const [view, setView] = useState<View>("board");
  const [presetToken, setPresetToken] = useState(0);

  function refresh() {
    setRefreshToken((n) => n + 1);
  }

  /** Clicking the active tile returns to the whole book — a toggle, not a one-way trip. */
  function selectSegment(key: SegmentKey) {
    setSegment((prev) => (prev === key ? "total" : key));
    setPresetToken((n) => n + 1);
  }

  useEffect(() => {
    void Promise.all([
      listGuardians({ pageSize: 1 }),
      listGuardians({ pageSize: 1, filter: { family: "multi" } }),
      listGuardians({ pageSize: 1, filter: { family: "single" } }),
      listGuardians({ pageSize: 1, filter: { status: "inactive" } }),
    ])
      .then(([all, multi, single, inactive]) =>
        setStats({
          total: all.total,
          multi: multi.total,
          single: single.total,
          inactive: inactive.total,
        }),
      )
      .catch(() => {});
  }, [refreshToken]);

  const pct = (value: number | null) =>
    stats && stats.total > 0 && value !== null
      ? Math.round((value / stats.total) * 100)
      : null;

  const filter = SEGMENT_FILTERS[segment];

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
                onClick={() => setCreating(true)}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            testKey="multi"
            icon={UsersRound}
            label={t("stats.multi")}
            hint={t("stats.multiSub")}
            value={stats?.multi ?? null}
            share={pct(stats?.multi ?? null)}
            tone="violet"
            selected={segment === "multi"}
            onSelect={() => selectSegment("multi")}
          />
          <SegmentTile
            testKey="single"
            icon={UserCog}
            label={t("stats.single")}
            hint={t("stats.singleSub")}
            value={stats?.single ?? null}
            share={pct(stats?.single ?? null)}
            tone="teal"
            selected={segment === "single"}
            onSelect={() => selectSegment("single")}
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
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground/80 text-[11px]">
            {t("stats.filterHint")}
          </p>
          {/* The table is still here: it is the view that exports, and sorts by column. The
              board is the default because it answers "who is in this family" without a click. */}
          <div
            className="bg-muted/60 inline-flex items-center gap-0.5 rounded-xl p-0.5"
            role="group"
            aria-label={t("view.label")}
          >
            {[
              {
                key: "board" as const,
                icon: LayoutGrid,
                label: t("view.board"),
              },
              { key: "table" as const, icon: Table2, label: t("view.table") },
            ].map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                aria-pressed={view === key}
                data-testid={`guardians-view-${key}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                  view === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── The families ─────────────────────────────────────────────────── */}
      {view === "board" ? (
        <FamilyBook
          filter={filter}
          refreshToken={refreshToken}
          onNew={() => setCreating(true)}
        />
      ) : (
        <GuardiansList
          refreshToken={refreshToken}
          filterPreset={{ values: filter, token: presetToken }}
          onNew={() => setCreating(true)}
          onOpen={(id) => router.push(`/guardians/${id}`)}
        />
      )}

      {/* ── Create modal ─────────────────────────────────────────────────── */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t("new")}
        description={t("newModal.description")}
        size="md"
      >
        <GuardianForm
          onCancel={() => setCreating(false)}
          onCreated={(guardianId) => {
            setCreating(false);
            refresh();
            // Straight into the new family: a parent is created in order to put children under
            // them, and adding the first one is the next thing the user came to do.
            router.push(`/guardians/${guardianId}`);
          }}
        />
      </Modal>
    </div>
  );
}
