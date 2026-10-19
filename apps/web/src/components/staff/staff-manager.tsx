"use client";

import { KeyRound, Plus, ShieldCheck, UserCheck, Users, UserX } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { useAuth } from "@/components/auth-provider";
import { StaffForm } from "@/components/staff/staff-form";
import { StaffList } from "@/components/staff/staff-list";
import { RolesPanel } from "@/components/team/roles-panel";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { SegmentTile } from "@/components/ui/segment-tile";
import { ApiError, deactivateStaff, listStaff } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type ModalState =
  | { kind: "closed" }
  | { kind: "new" }
  | { kind: "delete"; id: string; name: string };

interface Stats {
  total: number;
  active: number;
  inactive: number;
}

/**
 * The roster, cut three ways. Each tile is a saved view: its count and the rows below it come
 * from the same server filter, so the two can never disagree.
 */
type SegmentKey = "total" | "active" | "inactive";

const SEGMENT_FILTERS: Record<SegmentKey, Record<string, string>> = {
  total: {},
  active: { status: "active" },
  inactive: { status: "inactive" },
};

type TeamTab = "members" | "roles";

// ── StaffManager ──────────────────────────────────────────────────────────────

/**
 * Team & permissions — one page for the people who sign in and the roles they sign in as. It used
 * to be two screens (Staff, then Roles) and a three-stop trip to give someone access; now a member
 * is added with their role in one form, and the roles live in the second tab (/staff?tab=roles —
 * /roles redirects here).
 */
export function StaffManager() {
  const t = useTranslations("staff");
  const { can } = useAuth();
  const router = useRouter();
  // Optional-chained: useSearchParams() is null outside the app router (tests, previews).
  const params = useSearchParams();
  const canMembers = can("staff.read");
  const canRoles = can("role.manage");
  const requested: TeamTab = params?.get("tab") === "roles" ? "roles" : "members";
  const [tab, setTab] = useState<TeamTab>(requested);
  const active: TeamTab = !canMembers ? "roles" : !canRoles ? "members" : tab;

  function chooseTab(next: TeamTab) {
    setTab(next);
    router.replace(next === "roles" ? "/staff?tab=roles" : "/staff", { scroll: false });
  }

  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [refreshToken, setRefreshToken] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [alert, setAlert] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [segment, setSegment] = useState<SegmentKey>("total");
  const [presetToken, setPresetToken] = useState(0);

  /** Clicking the active tile returns to the whole roster — a toggle, not a one-way trip. */
  function selectSegment(key: SegmentKey) {
    setSegment((prev) => (prev === key ? "total" : key));
    setPresetToken((n) => n + 1);
  }

  /**
   * Opening a profile is a real navigation. Left bare it read as a dead click, so the row is
   * marked pending while React transitions, and the route is warmed on hover so most clicks
   * land on a page that has already loaded.
   */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startNavigation] = useTransition();
  const prefetched = useRef<Set<string>>(new Set());

  function prefetchStaff(id: string) {
    if (prefetched.current.has(id)) return;
    prefetched.current.add(id);
    router.prefetch(`/staff/${id}`);
  }

  function openStaff(id: string) {
    setPendingId(id);
    startNavigation(() => router.push(`/staff/${id}`));
  }

  function refresh() {
    setRefreshToken((n) => n + 1);
  }

  function showAlert(variant: "success" | "error", message: string) {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 4500);
  }

  async function confirmDeactivate(id: string) {
    setDeleteBusy(true);
    try {
      await deactivateStaff(id);
      setModal({ kind: "closed" });
      refresh();
      showAlert("success", t("detail.deactivated"));
    } catch (err) {
      setModal({ kind: "closed" });
      showAlert("error", err instanceof ApiError ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  useEffect(() => {
    if (!canMembers) return;
    void Promise.all([
      listStaff({ pageSize: 1 }),
      listStaff({ pageSize: 1, filter: { status: "inactive" } }),
      listStaff({ pageSize: 1, filter: { status: "active" } }),
    ])
      .then(([all, inactive, active]) => {
        setStats({
          total:    all.total,
          active:   active.total,
          inactive: inactive.total,
        });
      })
      .catch(() => {});
  }, [refreshToken, canMembers]);

  const pct = (value: number | null) =>
    stats && stats.total > 0 && value !== null
      ? Math.round((value / stats.total) * 100)
      : null;

  return (
    <div className="space-y-5">
      <PageHero
        latticeId="staff-hero-lattice"
        icon={ShieldCheck}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {stats && (
              <HeroPill>
                <Users className="size-3.5" aria-hidden />
                {t("hero.onRoster", { count: stats.total })}
              </HeroPill>
            )}
            {can("staff.create") && (
              <Button
                type="button"
                size="lg"
                onClick={() => setModal({ kind: "new" })}
                data-testid="new-staff"
                className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
              >
                <Plus className="size-4" aria-hidden />
                {t("new")}
              </Button>
            )}
          </>
        }
      />

      {/* ── Tabs: the people, and the roles they hold ─────────────────────── */}
      {canMembers && canRoles && (
        <div
          role="tablist"
          aria-label={t("title")}
          className="no-scrollbar flex gap-1 overflow-x-auto rounded-2xl border bg-muted/40 p-1.5 shadow-sm"
        >
          {([
            { key: "members", icon: Users },
            { key: "roles", icon: KeyRound },
          ] as const).map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active === key}
              onClick={() => chooseTab(key)}
              data-testid={`team-tab-${key}`}
              className={cn(
                "flex flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-all sm:px-4",
                active === key
                  ? "bg-card text-foreground shadow-sm ring-1 ring-black/5"
                  : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>
      )}

      {active === "roles" && <RolesPanel />}

      {active === "members" && (
        <>
          {/* ── Segment tiles ───────────────────────────────────────────────── */}
          <div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SegmentTile
                testKey="total"
                icon={Users}
                label={t("stat.total")}
                hint={t("stat.totalSub")}
                value={stats?.total ?? null}
                share={null}
                tone="emerald"
                selected={segment === "total"}
                onSelect={() => selectSegment("total")}
              />
              <SegmentTile
                testKey="active"
                icon={UserCheck}
                label={t("stat.active")}
                hint={t("stat.activeSub")}
                value={stats?.active ?? null}
                share={pct(stats?.active ?? null)}
                tone="teal"
                selected={segment === "active"}
                onSelect={() => selectSegment("active")}
              />
              <SegmentTile
                testKey="inactive"
                icon={UserX}
                label={t("stat.inactive")}
                hint={t("stat.inactiveSub")}
                value={stats?.inactive ?? null}
                share={pct(stats?.inactive ?? null)}
                tone="slate"
                selected={segment === "inactive"}
                onSelect={() => selectSegment("inactive")}
              />
            </div>
            <p className="text-muted-foreground/80 mt-2 text-[11px]">
              {t("stat.filterHint")}
            </p>
          </div>

          {/* ── Alert ─────────────────────────────────────────────────────────── */}
          {alert && (
            <AlertBanner
              variant={alert.variant}
              message={alert.message}
              onDismiss={() => setAlert(null)}
            />
          )}

          {/* ── Roster ───────────────────────────────────────────────────────── */}
          <StaffList
            refreshToken={refreshToken}
            filterPreset={{ values: SEGMENT_FILTERS[segment], token: presetToken }}
            pendingRowId={pendingId}
            onPrefetch={prefetchStaff}
            onNew={() => setModal({ kind: "new" })}
            onOpen={(id) => openStaff(id)}
            onDeactivate={(id, name) => setModal({ kind: "delete", id, name })}
          />
        </>
      )}

      {/* ── Create staff modal ────────────────────────────────────────────── */}
      <Modal
        open={modal.kind === "new"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("new")}
        size="xl"
      >
        <StaffForm
          onCancel={() => setModal({ kind: "closed" })}
          onDone={(id) => {
            setModal({ kind: "closed" });
            router.push(`/staff/${id}`);
          }}
        />
      </Modal>

      {/* ── Deactivate confirmation modal ─────────────────────────────────── */}
      <Modal
        open={modal.kind === "delete"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("detail.deactivateConfirm")}
        size="sm"
      >
        {modal.kind === "delete" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("detail.deactivateConfirmBody")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deleteBusy}
                onClick={() => setModal({ kind: "closed" })}
              >
                {t("detail.deactivateCancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleteBusy}
                className="gap-1.5"
                data-testid="confirm-deactivate-staff"
                onClick={() => void confirmDeactivate((modal as { id: string }).id)}
              >
                {deleteBusy && (
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {t("detail.deactivateYes")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
