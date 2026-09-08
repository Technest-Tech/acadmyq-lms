"use client";

import { Inbox } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatTile } from "@/components/admin/stat-tile";
import { StatusChip, type ChipTone } from "@/components/admin/status-chip";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import {
  DEMO_REQUEST_STATUSES,
  listDemoRequests,
  updateDemoRequest,
  type DataTableQuery,
  type DemoRequestCounts,
  type DemoRequestRow,
  type DemoRequestStatus,
} from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";

/**
 * The Super Admin inbox for marketing demo requests.
 *
 * Reuses the platform's own furniture rather than growing a fourth list implementation: the shared
 * server-driven `DataTable` (search, filters, sort, paging and the Excel export all happen there),
 * the admin header, tiles and status chip. The only bespoke part is the detail dialog, because
 * "read the message, record what happened" is the whole job of this screen.
 *
 * Export is the table's built-in one, which re-fetches EVERY row matching the current filters —
 * so exporting a filtered queue exports that queue, not the twenty-five rows on screen.
 */

const TONE: Record<DemoRequestStatus, ChipTone> = {
  NEW: "info",
  CONTACTED: "warn",
  QUALIFIED: "accent",
  WON: "good",
  LOST: "neutral",
};

const COUNTRY_NAME = new Map(COUNTRIES.map((c) => [c.code, c.name]));

export function DemoRequestsScreen() {
  const t = useTranslations("demoRequests");
  const locale = useLocale();
  const [counts, setCounts] = useState<DemoRequestCounts | null>(null);
  const [selected, setSelected] = useState<DemoRequestRow | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  // The table owns the query; this wrapper also captures the whole-queue counts that ride along
  // with every page, so the tiles above stay true without a second request.
  const fetcher = useCallback(async (q: DataTableQuery) => {
    const result = await listDemoRequests(q);
    setCounts(result.counts);

    return result;
  }, []);

  const columns: ColumnDef<DemoRequestRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: t("columns.name"),
        sortKey: "name",
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            {row.role ? (
              <p className="text-muted-foreground truncate text-xs">{row.role}</p>
            ) : null}
          </div>
        ),
      },
      {
        key: "contact",
        header: t("columns.contact"),
        render: (row) => (
          <div className="min-w-0" dir="ltr">
            <p className="truncate text-sm">{row.phone}</p>
            {row.email ? (
              <p className="text-muted-foreground truncate text-xs">{row.email}</p>
            ) : null}
          </div>
        ),
      },
      {
        key: "product",
        header: t("columns.product"),
        sortKey: "product",
        render: (row) => (
          <span className="text-sm">{t(`product.${row.product}`)}</span>
        ),
      },
      {
        key: "country",
        header: t("columns.country"),
        hideOnCard: true,
        render: (row) => (
          <span className="text-muted-foreground text-sm">
            {row.country ? (COUNTRY_NAME.get(row.country) ?? row.country) : "—"}
          </span>
        ),
      },
      {
        key: "source",
        header: t("columns.source"),
        hideOnCard: true,
        render: (row) => (
          <span className="text-muted-foreground text-xs" dir="ltr">
            {row.source ?? "—"}
          </span>
        ),
      },
      {
        key: "created_at",
        header: t("columns.created"),
        sortKey: "created_at",
        render: (row) => (
          <span className="text-muted-foreground text-sm">
            {dateFmt.format(new Date(row.created_at))}
          </span>
        ),
      },
      {
        key: "status",
        header: t("columns.status"),
        sortKey: "status",
        render: (row) => (
          <StatusChip tone={TONE[row.status]} dot>
            {t(`status.${row.status}`)}
          </StatusChip>
        ),
      },
    ],
    [t, dateFmt],
  );

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatTile
          label={t("tiles.total")}
          value={counts?.total ?? 0}
          icon={Inbox}
          loading={counts === null}
        />
        {DEMO_REQUEST_STATUSES.map((status) => (
          <StatTile
            key={status}
            label={t(`status.${status}`)}
            value={counts?.[status] ?? 0}
            loading={counts === null}
          />
        ))}
      </div>

      <section className="bg-card overflow-hidden rounded-2xl border p-4 shadow-sm">
        <DataTable<DemoRequestRow>
          fetcher={fetcher}
          columns={columns}
          getRowId={(row) => row.id}
          onRowClick={(row) => setSelected(row)}
          searchPlaceholder={t("searchPlaceholder")}
          emptyMessage={t("empty")}
          defaultSort="-created_at"
          refreshToken={refreshToken}
          testId="demo-requests-table"
          filters={[
            {
              key: "status",
              label: t("filters.status"),
              options: DEMO_REQUEST_STATUSES.map((status) => ({
                value: status,
                label: t(`status.${status}`),
              })),
            },
            {
              key: "product",
              label: t("filters.product"),
              options: (
                ["COURSE_PLATFORM", "ACADEMY_MANAGEMENT", "UNDECIDED"] as const
              ).map((product) => ({
                value: product,
                label: t(`product.${product}`),
              })),
            },
          ]}
          exportConfig={{
            fileName: t("export.fileName"),
            sheetName: t("export.sheet"),
            columns: [
              { header: t("columns.created"), value: (r) => r.created_at },
              { header: t("columns.name"), value: (r) => r.name },
              { header: t("columns.contact"), value: (r) => r.phone },
              { header: "Email", value: (r) => r.email ?? "" },
              { header: t("columns.country"), value: (r) => r.country ?? "" },
              {
                header: t("columns.product"),
                value: (r) => t(`product.${r.product}`),
              },
              { header: t("detail.role"), value: (r) => r.role ?? "" },
              { header: t("detail.message"), value: (r) => r.message ?? "" },
              { header: t("columns.source"), value: (r) => r.source ?? "" },
              {
                header: t("columns.status"),
                value: (r) => t(`status.${r.status}`),
              },
              { header: t("detail.note"), value: (r) => r.note ?? "" },
            ],
          }}
        />
      </section>

      <DetailModal
        request={selected}
        onClose={() => setSelected(null)}
        onSaved={(row, nextCounts) => {
          setSelected(row);
          setCounts(nextCounts);
          setRefreshToken((n) => n + 1);
        }}
      />
    </div>
  );
}

function DetailModal({
  request,
  onClose,
  onSaved,
}: {
  request: DemoRequestRow | null;
  onClose: () => void;
  onSaved: (row: DemoRequestRow, counts: DemoRequestCounts) => void;
}) {
  const t = useTranslations("demoRequests");
  const locale = useLocale();
  const [status, setStatus] = useState<DemoRequestStatus>("NEW");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  // Re-seed the form whenever a different row is opened — the modal is one instance reused.
  useEffect(() => {
    if (request === null) return;
    setStatus(request.status);
    setNote(request.note ?? "");
    setError(false);
  }, [request]);

  if (request === null) return null;

  const dirty = status !== request.status || note !== (request.note ?? "");

  async function save() {
    if (request === null) return;
    setSaving(true);
    setError(false);
    try {
      const res = await updateDemoRequest(request.id, { status, note });
      onSaved(res.request, res.counts);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const received = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(request.created_at));

  return (
    <Modal
      open
      onClose={onClose}
      title={request.name}
      description={t("detail.title")}
      closeLabel={t("detail.close")}
      footer={
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? t("detail.saving") : t("detail.save")}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t("detail.close")}
          </Button>
          {error ? (
            <span role="alert" className="text-destructive text-xs">
              {t("detail.error")}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Row label={t("columns.contact")}>
            <span dir="ltr" className="block">
              {request.phone}
            </span>
            {request.email ? (
              <a
                href={`mailto:${request.email}`}
                dir="ltr"
                className="text-primary block underline-offset-4 hover:underline"
              >
                {request.email}
              </a>
            ) : null}
          </Row>
          <Row label={t("columns.product")}>{t(`product.${request.product}`)}</Row>
          <Row label={t("columns.country")}>
            {request.country
              ? (COUNTRY_NAME.get(request.country) ?? request.country)
              : "—"}
          </Row>
          <Row label={t("detail.role")}>{request.role ?? "—"}</Row>
          <Row label={t("detail.source")}>
            <span dir="ltr">{request.source ?? "—"}</span>
          </Row>
          <Row label={t("detail.locale")}>{request.locale ?? "—"}</Row>
          <Row label={t("detail.received")}>{received}</Row>
        </dl>

        <div>
          <h3 className="text-xs font-semibold">{t("detail.message")}</h3>
          <p className="bg-muted/50 mt-1.5 rounded-lg p-3 leading-relaxed whitespace-pre-wrap">
            {request.message ?? t("detail.noMessage")}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="demo-request-status"
              className="text-xs font-semibold"
            >
              {t("detail.statusLabel")}
            </label>
            <select
              id="demo-request-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as DemoRequestStatus)}
              className="border-input bg-background focus:border-primary focus:ring-primary/20 mt-1.5 h-9 w-full rounded-lg border px-2.5 text-sm focus:ring-2 focus:outline-none"
            >
              {DEMO_REQUEST_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="demo-request-note" className="text-xs font-semibold">
              {t("detail.note")}
            </label>
            <textarea
              id="demo-request-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={t("detail.notePlaceholder")}
              className="border-input bg-background focus:border-primary focus:ring-primary/20 mt-1.5 w-full rounded-lg border px-2.5 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
