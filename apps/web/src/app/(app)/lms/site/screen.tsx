"use client";

import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  Link2,
  ListOrdered,
  Loader2,
  Megaphone,
  MessageSquareQuote,
  Palette,
  PanelsTopLeft,
  Phone,
  RotateCcw,
  Save,
  Scale,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import {
  Field,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/courses/form-bits";
import { EmptyState, lmsColor } from "@/components/courses/lms-ui";
import {
  ColorField,
  ImageField,
  RepeatableList,
  StringList,
} from "@/components/courses/site-editor-bits";
import {
  CompletionBar,
  PreviewPane,
  PreviewToolbar,
  SectionRow,
  Segmented,
  Switch,
  VisibilityBanner,
  type PreviewDevice,
  type PreviewFocus,
} from "@/components/courses/site-builder";
import { AlertBanner } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { getLmsSiteProfile, saveLmsSiteProfile, type LmsSiteProfile } from "@/lib/api";
import type { LearnSiteContent } from "@/lib/learn-api";
import { cn } from "@/lib/utils";

/**
 * The client's builder for their public course site (docs/lms/09).
 *
 * Two panes, the way every site builder worth using is laid out: what you are editing on the left,
 * the actual site on the right. The preview is not a mock — it is the client's own site in an
 * iframe, fed the unsaved draft over postMessage (components/learn/preview-bridge.tsx), so "what
 * this looks like" is never a question they have to publish to answer.
 *
 * The left pane is a RAIL, not one long form. A dozen content blocks stacked as accordions meant
 * that finding "the reviews strip" was a scroll and a guess; here the sections are listed in the
 * order they appear on the page, each one switchable from the list itself, and opening one shows
 * only its fields — and scrolls the preview to the strip it controls.
 *
 * Empty is still a valid answer everywhere: the site falls back to its own translated copy, so a
 * client can publish a complete site without filling in a single field.
 */

const BRAND_PRESETS = [
  "#12836a",
  "#0f766e",
  "#1d4ed8",
  "#4f46e5",
  "#7c3aed",
  "#be123c",
  "#ea580c",
  "#ca8a04",
  "#15803d",
  "#0f172a",
];

const ICONS = [
  "sparkles",
  "video",
  "award",
  "clock",
  "infinity",
  "smartphone",
  "users",
  "shield",
  "book",
  "headphones",
  "download",
  "check",
] as const;

const SOCIALS = [
  "facebook",
  "instagram",
  "youtube",
  "tiktok",
  "telegram",
  "x",
  "linkedin",
  "website",
] as const;

const CAPS = {
  badges: 6,
  stats: 4,
  points: 6,
  features: 8,
  steps: 6,
  instructors: 12,
  testimonials: 12,
  faq: 16,
  links: 8,
};

// ── the section registry ──────────────────────────────────────────────────────

type BlockKey =
  | "brand"
  | "hero"
  | "stats"
  | "features"
  | "steps"
  | "about"
  | "instructors"
  | "testimonials"
  | "faq"
  | "cta"
  | "contact"
  | "footer"
  | "seo"
  | "legal";

type Group = "design" | "home" | "site" | "settings";

interface SectionDef {
  key: BlockKey;
  group: Group;
  Icon: LucideIcon;
  color: string;
  /** The element id this section renders as on the site, for the preview's scroll-and-flash. */
  anchor: string | null;
  /** Which page of the site to preview while editing it. */
  page?: string;
  /** Sections the client can switch off entirely. The rest are structural. */
  toggle?: boolean;
  count?: (c: LearnSiteContent) => number;
  /** "The client put something of their own here" — drives the setup meter and the tick. */
  done: (c: LearnSiteContent) => boolean;
}

const filled = (...values: (string | undefined)[]) =>
  values.some((value) => (value ?? "").trim() !== "");

/** Page order IS site order: the rail reads top-to-bottom the way the site does. */
const SECTIONS: SectionDef[] = [
  {
    key: "brand",
    group: "design",
    Icon: Palette,
    color: "violet",
    anchor: "site-header",
    done: (c) => filled(c.brand.name, c.brand.logo_url, c.brand.tagline),
  },
  {
    key: "hero",
    group: "home",
    Icon: ImageIcon,
    color: "indigo",
    anchor: "site-hero",
    done: (c) => filled(c.hero.title, c.hero.subtitle, c.hero.image_url),
  },
  {
    key: "stats",
    group: "home",
    Icon: BarChart3,
    color: "blue",
    anchor: "site-stats",
    toggle: true,
    count: (c) => c.stats.items.length,
    done: (c) => c.stats.items.length > 0,
  },
  {
    key: "features",
    group: "home",
    Icon: Sparkles,
    color: "violet",
    anchor: "site-features",
    toggle: true,
    count: (c) => c.features.items.length,
    done: (c) => c.features.items.length > 0,
  },
  {
    key: "steps",
    group: "home",
    Icon: ListOrdered,
    color: "blue",
    anchor: "site-steps",
    toggle: true,
    count: (c) => c.steps.items.length,
    done: (c) => c.steps.items.length > 0,
  },
  {
    key: "about",
    group: "home",
    Icon: Layers,
    color: "indigo",
    anchor: "site-about",
    page: "/about",
    toggle: true,
    done: (c) => filled(c.about.body, c.about.mission, c.about.approach),
  },
  {
    key: "instructors",
    group: "home",
    Icon: Users,
    color: "emerald",
    anchor: "site-instructors",
    toggle: true,
    count: (c) => c.instructors.items.length,
    done: (c) => c.instructors.items.length > 0,
  },
  {
    key: "testimonials",
    group: "home",
    Icon: MessageSquareQuote,
    color: "amber",
    anchor: "site-testimonials",
    toggle: true,
    count: (c) => c.testimonials.items.length,
    done: (c) => c.testimonials.items.length > 0,
  },
  {
    key: "faq",
    group: "home",
    Icon: HelpCircle,
    color: "blue",
    anchor: "site-faq",
    toggle: true,
    count: (c) => c.faq.items.length,
    done: (c) => c.faq.items.length > 0,
  },
  {
    key: "cta",
    group: "home",
    Icon: Megaphone,
    color: "rose",
    anchor: "site-cta",
    toggle: true,
    done: (c) => filled(c.cta.title, c.cta.subtitle, c.cta.button_label),
  },
  {
    key: "contact",
    group: "site",
    Icon: Phone,
    color: "emerald",
    anchor: "site-footer",
    toggle: true,
    done: (c) => filled(c.contact.whatsapp, c.contact.phone, c.contact.email),
  },
  {
    key: "footer",
    group: "site",
    Icon: Link2,
    color: "slate",
    anchor: "site-footer",
    count: (c) => c.footer.links.length,
    done: (c) => filled(c.footer.note) || c.footer.links.length > 0,
  },
  {
    key: "seo",
    group: "settings",
    Icon: Search,
    color: "slate",
    anchor: null,
    done: (c) => filled(c.seo.title, c.seo.description, c.seo.og_image_url),
  },
  {
    key: "legal",
    group: "settings",
    Icon: Scale,
    color: "slate",
    anchor: null,
    page: "/legal/terms",
    done: (c) => filled(c.legal.business_name, c.legal.terms, c.legal.refund, c.legal.privacy),
  },
];

const GROUPS: Group[] = ["design", "home", "site", "settings"];

/** The `show` flag of a toggleable section, read and written without a cast at every call site. */
function visibility(content: LearnSiteContent, key: BlockKey): boolean {
  const block = content[key] as { show?: boolean };
  return block.show !== false;
}

// ── screen ────────────────────────────────────────────────────────────────────

export function LmsSiteScreen() {
  const t = useTranslations("lms.site");
  const { can } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<LmsSiteProfile | null>(null);
  const [draft, setDraft] = useState<LearnSiteContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState<BlockKey | null>(null);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [page, setPage] = useState("");
  const [focus, setFocus] = useState<PreviewFocus | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    () =>
      getLmsSiteProfile()
        .then((res) => {
          setData(res);
          setDraft(res.content);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e))),
    [],
  );

  const canRead = can("course.read");
  useEffect(() => {
    // Don't fetch a site the user isn't allowed to see — the screen renders the no-access state
    // below without ever hitting the API.
    if (canRead) void load();
  }, [canRead, load]);

  const editable = can("course.manage");
  const dirty =
    draft !== null && data !== null && JSON.stringify(draft) !== JSON.stringify(data.content);

  /** Patch one block; every field editor below goes through this so nothing mutates the draft. */
  const set = useCallback(function set<K extends keyof LearnSiteContent>(
    block: K,
    patch: Partial<LearnSiteContent[K]>,
  ): void {
    setDraft((d) => (d === null ? d : { ...d, [block]: { ...d[block], ...patch } }));
  }, []);

  const save = useCallback(async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      const res = await saveLmsSiteProfile(draft);
      setData(res);
      setDraft(res.content);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [draft, t, toast]);

  // ⌘S / Ctrl+S. The save button is always on screen, but nobody who has ever used a builder
  // reaches for the mouse to save.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (editable && dirty && !saving) void save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, dirty, saving, save]);

  /** Open a section: show its fields, put the preview on its page and flash the strip it owns. */
  const openSection = useCallback((section: SectionDef) => {
    setOpen(section.key);
    setView("edit");
    if (section.page !== undefined) setPage(section.page);
    if (section.anchor !== null) {
      setFocus({ anchor: section.anchor, token: Date.now() });
    }
    // Jumping between sections from the "next section" link at the bottom of a long form would
    // otherwise leave the client looking at the middle of the one they just opened.
    panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  if (!can("course.read")) {
    return <EmptyState Icon={Globe} color="slate" title={t("noAccess")} />;
  }
  if (error !== null) {
    return <AlertBanner variant="error" message={error} />;
  }
  if (draft === null || data === null) {
    return (
      <div className="space-y-4">
        <div className="bg-muted h-16 animate-pulse rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-[minmax(360px,26rem)_1fr]">
          <div className="bg-muted h-[32rem] animate-pulse rounded-2xl" />
          <div className="bg-muted hidden h-[32rem] animate-pulse rounded-2xl lg:block" />
        </div>
      </div>
    );
  }

  const handle = data.site.subdomain;
  const previewSrc =
    handle === null ? null : `/learn/${handle}${page}?preview=1`;
  const liveUrl = data.site.url ?? (handle === null ? null : `/learn/${handle}`);
  const section = SECTIONS.find((s) => s.key === open) ?? null;
  const doneCount = SECTIONS.filter((s) => s.done(draft)).length;

  const pageOptions = [
    { value: "", label: t("builder.page.home") },
    { value: "/courses", label: t("builder.page.courses") },
    ...(draft.pages.about ? [{ value: "/about", label: t("builder.page.about") }] : []),
    ...(draft.pages.faq ? [{ value: "/faq", label: t("builder.page.faq") }] : []),
    ...(draft.pages.contact ? [{ value: "/contact", label: t("builder.page.contact") }] : []),
    { value: "/legal/terms", label: t("builder.page.legal") },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* ── the bar that never scrolls away: where the site is, and the one button that matters ── */}
      <header className="bg-card sticky top-0 z-30 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 shadow-sm ring-1 ring-foreground/[0.06]">
        <span className="from-primary flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br to-emerald-400 text-white shadow-sm">
          <PanelsTopLeft className="size-5" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-base font-bold tracking-tight">
            {t("title")}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold",
                data.site.configured
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {data.site.configured ? t("builder.published") : t("builder.notPublished")}
            </span>
          </h1>
          {data.site.url !== null ? (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(data.site.url ?? "");
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
              className="text-muted-foreground hover:text-foreground group mt-0.5 flex max-w-full items-center gap-1.5 text-xs transition-colors"
            >
              <span className="truncate font-mono">
                {data.site.url.replace(/^https?:\/\//, "")}
              </span>
              {copied ? (
                <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
              ) : (
                <Copy className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              )}
              <span className="sr-only">{t("builder.copy")}</span>
            </button>
          ) : (
            <p className="text-muted-foreground mt-0.5 text-xs">{t("notPublished")}</p>
          )}
        </div>

        {/* On a narrow screen the two panes are tabs; from lg up they sit side by side. */}
        <Segmented
          className="lg:hidden"
          items={[
            { value: "edit", label: t("builder.edit") },
            { value: "preview", label: t("builder.preview") },
          ]}
          value={view}
          onChange={(v) => setView(v as "edit" | "preview")}
        />

        {liveUrl !== null && (
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="border-input hover:bg-muted hidden h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors sm:inline-flex"
          >
            <ExternalLink className="size-4" aria-hidden />
            {t("openSite")}
          </a>
        )}

        {editable && (
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                type="button"
                onClick={() => setDraft(data.content)}
                className="border-input hover:bg-muted inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors"
              >
                <RotateCcw className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t("discard")}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-45"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              {saving ? t("saving") : dirty ? t("save") : t("builder.saved")}
            </button>
          </div>
        )}
      </header>

      {!editable && <AlertBanner variant="info" message={t("readOnly")} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(360px,26rem)_1fr]">
        {/* ── left: the rail, or the open section's fields ── */}
        <div
          ref={panelRef}
          className={cn(
            "bg-card scroll-mt-24 overflow-clip rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]",
            view === "preview" && "hidden lg:block",
          )}
        >
          {section === null ? (
            <>
              <CompletionBar
                done={doneCount}
                total={SECTIONS.length}
                label={t("builder.progress", { done: doneCount, total: SECTIONS.length })}
                hint={t("builder.progressHint")}
              />
              <div className="space-y-4 p-3">
                {GROUPS.map((group) => (
                  <div key={group}>
                    <p className="text-muted-foreground/70 px-2.5 pb-1 text-[10px] font-bold tracking-[0.1em] uppercase">
                      {t(`builder.group.${group}`)}
                    </p>
                    <div className="space-y-0.5">
                      {SECTIONS.filter((s) => s.group === group).map((s) => (
                        <SectionRow
                          key={s.key}
                          Icon={s.Icon}
                          color={s.color}
                          title={t(`blocks.${s.key}.title`)}
                          description={t(`blocks.${s.key}.desc`)}
                          count={s.count?.(draft)}
                          done={s.done(draft)}
                          show={s.toggle === true ? visibility(draft, s.key) : undefined}
                          onShowChange={
                            s.toggle === true
                              ? (show) =>
                                  set(s.key, { show } as Partial<LearnSiteContent[BlockKey]>)
                              : undefined
                          }
                          showLabel={t("showOnSite")}
                          onOpen={() => openSection(s)}
                          disabled={!editable}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <SectionEditor
              section={section}
              draft={draft}
              data={data}
              set={set}
              editable={editable}
              onBack={() => setOpen(null)}
              onOpen={openSection}
            />
          )}
        </div>

        {/* ── right: the site itself ── */}
        <div
          className={cn(
            "bg-card sticky top-[5.5rem] flex h-[calc(100vh-9rem)] min-h-[30rem] flex-col overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]",
            view === "edit" && "hidden lg:flex",
          )}
        >
          <PreviewToolbar
            pages={pageOptions}
            page={page}
            onPageChange={setPage}
            device={device}
            onDeviceChange={setDevice}
            deviceLabels={{
              desktop: t("builder.device.desktop"),
              tablet: t("builder.device.tablet"),
              mobile: t("builder.device.mobile"),
            }}
            url={liveUrl === null ? null : `${liveUrl}${page}`}
            openLabel={t("builder.openPage")}
            liveLabel={t("builder.live")}
          />
          {previewSrc === null ? (
            <EmptyState
              Icon={Globe}
              color="slate"
              title={t("notPublished")}
              description={t("builder.noPreview")}
              className="flex-1"
            />
          ) : (
            <PreviewPane
              src={previewSrc}
              content={draft}
              device={device}
              focus={focus}
              label={t("builder.preview")}
              loadingLabel={t("builder.loadingPreview")}
              reloadLabel={t("builder.reload")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── the open section ──────────────────────────────────────────────────────────

function SectionEditor({
  section,
  draft,
  data,
  set,
  editable,
  onBack,
  onOpen,
}: {
  section: SectionDef;
  draft: LearnSiteContent;
  data: LmsSiteProfile;
  set: <K extends keyof LearnSiteContent>(block: K, patch: Partial<LearnSiteContent[K]>) => void;
  editable: boolean;
  onBack: () => void;
  onOpen: (section: SectionDef) => void;
}) {
  const t = useTranslations("lms.site");
  const c = lmsColor(section.color);
  const index = SECTIONS.findIndex((s) => s.key === section.key);
  const next = SECTIONS[index + 1] ?? null;
  const previous = SECTIONS[index - 1] ?? null;

  return (
    <div>
      <div className="bg-card sticky top-[5.5rem] z-10 flex items-center gap-3 border-b px-3 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("builder.back")}
          title={t("builder.back")}
          className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg p-1.5 transition-colors"
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
        </button>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
            c.chip,
          )}
        >
          <section.Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tracking-tight">
            {t(`blocks.${section.key}.title`)}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {t(`blocks.${section.key}.desc`)}
          </p>
        </div>
      </div>

      <fieldset disabled={!editable} className="space-y-4 p-4">
        {section.toggle === true && (
          <VisibilityBanner
            show={visibility(draft, section.key)}
            onChange={(show) => set(section.key, { show } as Partial<LearnSiteContent[BlockKey]>)}
            shownLabel={t("builder.sectionShown")}
            hiddenLabel={t("builder.sectionHidden")}
            switchLabel={t("showOnSite")}
          />
        )}

        <BlockFields block={section.key} draft={draft} data={data} set={set} />
      </fieldset>

      {/* Straight-through setup: a client who wants to fill the whole site never returns to the
          index between two sections. */}
      <div className="flex items-center gap-2 border-t px-4 py-3">
        {previous !== null && (
          <button
            type="button"
            onClick={() => onOpen(previous)}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
          >
            <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
            {t(`blocks.${previous.key}.title`)}
          </button>
        )}
        {next !== null && (
          <button
            type="button"
            onClick={() => onOpen(next)}
            className="text-primary ms-auto inline-flex items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
          >
            {t(`blocks.${next.key}.title`)}
            <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Every section's fields. One switch rather than a dozen components: these are flat forms over a
 * flat document, and keeping them together is what makes the whole site's vocabulary — headings,
 * body, items — visibly consistent.
 */
function BlockFields({
  block,
  draft,
  data,
  set,
}: {
  block: BlockKey;
  draft: LearnSiteContent;
  data: LmsSiteProfile;
  set: <K extends keyof LearnSiteContent>(b: K, patch: Partial<LearnSiteContent[K]>) => void;
}) {
  const t = useTranslations("lms.site");
  const fallbackHint = t("hint.fallback");
  const imageLabels = { emptyLabel: t("builder.noImage"), clearLabel: t("builder.clearImage") };

  switch (block) {
    // ── Brand ──
    case "brand":
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("f.name")} hint={fallbackHint}>
              <input
                className={inputClass}
                value={draft.brand.name}
                placeholder={data.defaults.brand.name}
                onChange={(e) => set("brand", { name: e.target.value })}
              />
            </Field>
            <Field label={t("f.tagline")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.brand.tagline}
                onChange={(e) => set("brand", { tagline: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t("f.color")} hint={t("hint.color")}>
            <ColorField
              value={draft.brand.color}
              presets={BRAND_PRESETS}
              onChange={(color) => set("brand", { color })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("f.logo")} hint={t("hint.url")} optional={t("optional")}>
              <ImageField
                value={draft.brand.logo_url}
                alt={t("f.logo")}
                onChange={(logo_url) => set("brand", { logo_url })}
                {...imageLabels}
              />
            </Field>
            <Field label={t("f.logoMark")} hint={t("hint.logoMark")} optional={t("optional")}>
              <ImageField
                value={draft.brand.logo_mark_url ?? ""}
                shape="square"
                alt={t("f.logoMark")}
                onChange={(logo_mark_url) => set("brand", { logo_mark_url })}
                {...imageLabels}
              />
            </Field>
          </div>
          <Field label={t("f.favicon")} hint={t("hint.favicon")} optional={t("optional")}>
            <ImageField
              value={draft.brand.favicon_url ?? ""}
              shape="square"
              alt={t("f.favicon")}
              onChange={(favicon_url) => set("brand", { favicon_url })}
              {...imageLabels}
            />
          </Field>
        </>
      );

    // ── Hero ──
    case "hero":
      return (
        <>
          <Field label={t("f.heroStyle")}>
            <select
              className={selectClass}
              value={draft.brand.hero_style}
              onChange={(e) =>
                set("brand", {
                  hero_style: e.target.value as LearnSiteContent["brand"]["hero_style"],
                })
              }
            >
              <option value="gradient">{t("f.heroStyleGradient")}</option>
              <option value="image">{t("f.heroStyleImage")}</option>
              <option value="plain">{t("f.heroStylePlain")}</option>
            </select>
          </Field>
          <Field label={t("f.eyebrow")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.hero.eyebrow}
              onChange={(e) => set("hero", { eyebrow: e.target.value })}
            />
          </Field>
          <Field label={t("f.headline")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.hero.title}
              onChange={(e) => set("hero", { title: e.target.value })}
            />
          </Field>
          <Field label={t("f.subtitle")} hint={fallbackHint}>
            <textarea
              className={textareaClass}
              rows={3}
              value={draft.hero.subtitle}
              onChange={(e) => set("hero", { subtitle: e.target.value })}
            />
          </Field>
          <Field label={t("f.image")} hint={t("hint.url")} optional={t("optional")}>
            <ImageField
              value={draft.hero.image_url}
              alt={t("f.image")}
              onChange={(image_url) => set("hero", { image_url })}
              {...imageLabels}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("f.primaryCta")}>
              <select
                className={selectClass}
                value={draft.hero.primary_cta}
                onChange={(e) =>
                  set("hero", {
                    primary_cta: e.target.value as LearnSiteContent["hero"]["primary_cta"],
                  })
                }
              >
                <option value="browse">{t("f.ctaBrowse")}</option>
                <option value="redeem">{t("f.ctaRedeem")}</option>
                <option value="contact">{t("f.ctaContact")}</option>
              </select>
            </Field>
            <Field label={t("f.ctaLabel")} hint={fallbackHint} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.hero.cta_label ?? ""}
                onChange={(e) => set("hero", { cta_label: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t("f.badges")} hint={fallbackHint}>
            <StringList
              items={draft.hero.badges}
              onChange={(badges) => set("hero", { badges })}
              addLabel={t("add.badge")}
              placeholder={t("f.badgePlaceholder")}
              max={CAPS.badges}
              maxLabel={t("max")}
            />
          </Field>
        </>
      );

    // ── Numbers ──
    case "stats":
      return (
        <RepeatableList
          items={draft.stats.items}
          onChange={(items) => set("stats", { items })}
          create={() => ({ value: "", label: "" })}
          addLabel={t("add.stat")}
          emptyLabel={t("empty.stats")}
          max={CAPS.stats}
          maxLabel={t("max")}
          title={(item) => item.label}
        >
          {(item, update) => (
            <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
              <Field label={t("f.value")}>
                <input
                  className={inputClass}
                  value={item.value}
                  onChange={(e) => update({ value: e.target.value })}
                />
              </Field>
              <Field label={t("f.label")}>
                <input
                  className={inputClass}
                  value={item.label}
                  onChange={(e) => update({ label: e.target.value })}
                />
              </Field>
            </div>
          )}
        </RepeatableList>
      );

    // ── Why learn here ──
    case "features":
      return (
        <>
          <Field label={t("f.heading")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.features.heading}
              onChange={(e) => set("features", { heading: e.target.value })}
            />
          </Field>
          <Field label={t("f.subheading")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.features.subheading}
              onChange={(e) => set("features", { subheading: e.target.value })}
            />
          </Field>
          <RepeatableList
            items={draft.features.items}
            onChange={(items) => set("features", { items })}
            create={() => ({ icon: "sparkles", title: "", body: "" })}
            addLabel={t("add.feature")}
            emptyLabel={t("empty.features")}
            max={CAPS.features}
            maxLabel={t("max")}
            title={(item) => item.title}
          >
            {(item, update) => (
              <>
                <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                  <Field label={t("f.icon")}>
                    <select
                      className={selectClass}
                      value={item.icon}
                      onChange={(e) => update({ icon: e.target.value })}
                    >
                      {ICONS.map((icon) => (
                        <option key={icon} value={icon}>
                          {icon}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("f.itemTitle")}>
                    <input
                      className={inputClass}
                      value={item.title}
                      onChange={(e) => update({ title: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t("f.body")}>
                  <textarea
                    className={textareaClass}
                    rows={2}
                    value={item.body}
                    onChange={(e) => update({ body: e.target.value })}
                  />
                </Field>
              </>
            )}
          </RepeatableList>
        </>
      );

    // ── How it works ──
    case "steps":
      return (
        <>
          <Field label={t("f.heading")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.steps.heading}
              onChange={(e) => set("steps", { heading: e.target.value })}
            />
          </Field>
          <RepeatableList
            items={draft.steps.items}
            onChange={(items) => set("steps", { items })}
            create={() => ({ title: "", body: "" })}
            addLabel={t("add.step")}
            emptyLabel={t("empty.steps")}
            max={CAPS.steps}
            maxLabel={t("max")}
            title={(item) => item.title}
          >
            {(item, update) => (
              <>
                <Field label={t("f.itemTitle")}>
                  <input
                    className={inputClass}
                    value={item.title}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                </Field>
                <Field label={t("f.body")}>
                  <textarea
                    className={textareaClass}
                    rows={2}
                    value={item.body}
                    onChange={(e) => update({ body: e.target.value })}
                  />
                </Field>
              </>
            )}
          </RepeatableList>
        </>
      );

    // ── About ──
    case "about":
      return (
        <>
          <Field label={t("f.heading")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.about.heading}
              onChange={(e) => set("about", { heading: e.target.value })}
            />
          </Field>
          <Field label={t("f.body")} hint={fallbackHint}>
            <textarea
              className={textareaClass}
              rows={5}
              value={draft.about.body}
              onChange={(e) => set("about", { body: e.target.value })}
            />
          </Field>
          <Field label={t("f.image")} hint={t("hint.url")} optional={t("optional")}>
            <ImageField
              value={draft.about.image_url}
              alt={t("f.image")}
              onChange={(image_url) => set("about", { image_url })}
              {...imageLabels}
            />
          </Field>
          {/* These two appear ONLY on the About page, which is what stops it being a second copy
              of the home page (docs/lms/09 §6). Left blank, neither block is drawn at all. */}
          <Field label={t("f.mission")} hint={t("hint.aboutOnly")} optional={t("optional")}>
            <textarea
              className={textareaClass}
              rows={4}
              value={draft.about.mission ?? ""}
              onChange={(e) => set("about", { mission: e.target.value })}
            />
          </Field>
          <Field label={t("f.approach")} hint={t("hint.aboutOnly")} optional={t("optional")}>
            <textarea
              className={textareaClass}
              rows={4}
              value={draft.about.approach ?? ""}
              onChange={(e) => set("about", { approach: e.target.value })}
            />
          </Field>
          <Field label={t("f.points")} optional={t("optional")}>
            <StringList
              items={draft.about.points}
              onChange={(points) => set("about", { points })}
              addLabel={t("add.point")}
              placeholder={t("f.pointPlaceholder")}
              max={CAPS.points}
              maxLabel={t("max")}
            />
          </Field>
        </>
      );

    // ── Teachers ──
    case "instructors":
      return (
        <>
          <Field label={t("f.heading")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.instructors.heading}
              onChange={(e) => set("instructors", { heading: e.target.value })}
            />
          </Field>
          <RepeatableList
            items={draft.instructors.items}
            onChange={(items) => set("instructors", { items })}
            create={() => ({
              name: "",
              role: "",
              bio: "",
              photo_url: "",
              expertise: "",
              link_url: "",
            })}
            addLabel={t("add.instructor")}
            emptyLabel={t("empty.instructors")}
            max={CAPS.instructors}
            maxLabel={t("max")}
            title={(item) => item.name}
          >
            {(item, update) => (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("f.personName")}>
                    <input
                      className={inputClass}
                      value={item.name}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </Field>
                  <Field label={t("f.role")} optional={t("optional")}>
                    <input
                      className={inputClass}
                      value={item.role}
                      onChange={(e) => update({ role: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t("f.photo")} hint={t("hint.url")} optional={t("optional")}>
                  <ImageField
                    value={item.photo_url}
                    shape="square"
                    alt={item.name || t("f.photo")}
                    onChange={(photo_url) => update({ photo_url })}
                    {...imageLabels}
                  />
                </Field>
                <Field label={t("f.bio")} optional={t("optional")}>
                  <textarea
                    className={textareaClass}
                    rows={2}
                    value={item.bio}
                    onChange={(e) => update({ bio: e.target.value })}
                  />
                </Field>
                <Field
                  label={t("f.expertise")}
                  hint={t("hint.expertise")}
                  optional={t("optional")}
                >
                  <input
                    className={inputClass}
                    value={item.expertise ?? ""}
                    onChange={(e) => update({ expertise: e.target.value })}
                  />
                </Field>
                <Field label={t("f.personLink")} hint={t("hint.url")} optional={t("optional")}>
                  <input
                    className={inputClass}
                    value={item.link_url ?? ""}
                    placeholder="https://…"
                    onChange={(e) => update({ link_url: e.target.value })}
                  />
                </Field>
              </>
            )}
          </RepeatableList>
        </>
      );

    // ── Reviews ──
    case "testimonials":
      return (
        <>
          <Field label={t("f.heading")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.testimonials.heading}
              onChange={(e) => set("testimonials", { heading: e.target.value })}
            />
          </Field>
          <RepeatableList
            items={draft.testimonials.items}
            onChange={(items) => set("testimonials", { items })}
            create={() => ({ name: "", role: "", quote: "", photo_url: "", rating: 5 })}
            addLabel={t("add.testimonial")}
            emptyLabel={t("empty.testimonials")}
            max={CAPS.testimonials}
            maxLabel={t("max")}
            title={(item) => item.name}
          >
            {(item, update) => (
              <>
                <Field label={t("f.quote")}>
                  <textarea
                    className={textareaClass}
                    rows={3}
                    value={item.quote}
                    onChange={(e) => update({ quote: e.target.value })}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_80px]">
                  <Field label={t("f.personName")}>
                    <input
                      className={inputClass}
                      value={item.name}
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </Field>
                  <Field label={t("f.role")} optional={t("optional")}>
                    <input
                      className={inputClass}
                      value={item.role}
                      onChange={(e) => update({ role: e.target.value })}
                    />
                  </Field>
                  <Field label={t("f.rating")}>
                    <select
                      className={selectClass}
                      value={String(item.rating)}
                      onChange={(e) => update({ rating: Number(e.target.value) })}
                    >
                      {[5, 4, 3, 2, 1, 0].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label={t("f.photo")} hint={t("hint.url")} optional={t("optional")}>
                  <ImageField
                    value={item.photo_url}
                    shape="square"
                    alt={item.name || t("f.photo")}
                    onChange={(photo_url) => update({ photo_url })}
                    {...imageLabels}
                  />
                </Field>
              </>
            )}
          </RepeatableList>
        </>
      );

    // ── FAQ ──
    case "faq":
      return (
        <>
          <Field label={t("f.heading")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.faq.heading}
              onChange={(e) => set("faq", { heading: e.target.value })}
            />
          </Field>
          <RepeatableList
            items={draft.faq.items}
            onChange={(items) => set("faq", { items })}
            create={() => ({ q: "", a: "" })}
            addLabel={t("add.faq")}
            emptyLabel={t("empty.faq")}
            max={CAPS.faq}
            maxLabel={t("max")}
            title={(item) => item.q}
          >
            {(item, update) => (
              <>
                <Field label={t("f.question")}>
                  <input
                    className={inputClass}
                    value={item.q}
                    onChange={(e) => update({ q: e.target.value })}
                  />
                </Field>
                <Field label={t("f.answer")}>
                  <textarea
                    className={textareaClass}
                    rows={3}
                    value={item.a}
                    onChange={(e) => update({ a: e.target.value })}
                  />
                </Field>
              </>
            )}
          </RepeatableList>
        </>
      );

    // ── Closing CTA ──
    case "cta":
      return (
        <>
          <Field label={t("f.headline")} hint={fallbackHint}>
            <input
              className={inputClass}
              value={draft.cta.title}
              onChange={(e) => set("cta", { title: e.target.value })}
            />
          </Field>
          <Field label={t("f.subtitle")} hint={fallbackHint}>
            <textarea
              className={textareaClass}
              rows={2}
              value={draft.cta.subtitle}
              onChange={(e) => set("cta", { subtitle: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("f.buttonLabel")} hint={fallbackHint}>
              <input
                className={inputClass}
                value={draft.cta.button_label}
                onChange={(e) => set("cta", { button_label: e.target.value })}
              />
            </Field>
            <Field label={t("f.buttonHref")} hint={t("hint.ctaHref")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.cta.button_href}
                placeholder="https://…"
                onChange={(e) => set("cta", { button_href: e.target.value })}
              />
            </Field>
          </div>
        </>
      );

    // ── Contact ──
    case "contact":
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("f.whatsapp")} hint={t("hint.whatsapp")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.contact.whatsapp}
                placeholder="201234567890"
                onChange={(e) => set("contact", { whatsapp: e.target.value })}
              />
            </Field>
            <Field label={t("f.phone")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.contact.phone}
                onChange={(e) => set("contact", { phone: e.target.value })}
              />
            </Field>
            <Field label={t("f.email")} optional={t("optional")}>
              <input
                className={inputClass}
                type="email"
                value={draft.contact.email}
                onChange={(e) => set("contact", { email: e.target.value })}
              />
            </Field>
            <Field label={t("f.address")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.contact.address}
                onChange={(e) => set("contact", { address: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t("f.hours")} hint={t("hint.hours")} optional={t("optional")}>
            <input
              className={inputClass}
              value={draft.contact.hours ?? ""}
              onChange={(e) => set("contact", { hours: e.target.value })}
            />
          </Field>
          <Field label={t("f.mapUrl")} hint={t("hint.map")} optional={t("optional")}>
            <input
              className={inputClass}
              value={draft.contact.map_url}
              placeholder="https://www.google.com/maps/embed?…"
              onChange={(e) => set("contact", { map_url: e.target.value })}
            />
          </Field>
          <div className="space-y-2">
            <span className="text-sm font-medium">{t("f.socials")}</span>
            <div className="grid gap-3 sm:grid-cols-2">
              {SOCIALS.map((network) => (
                <label key={network} className="block space-y-1">
                  <span className="text-muted-foreground text-xs capitalize">{network}</span>
                  <input
                    className={inputClass}
                    value={draft.contact.socials?.[network] ?? ""}
                    placeholder="https://…"
                    onChange={(e) =>
                      set("contact", {
                        socials: { ...draft.contact.socials, [network]: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </>
      );

    // ── Footer ──
    case "footer":
      return (
        <>
          <Field label={t("f.note")} optional={t("optional")}>
            <textarea
              className={textareaClass}
              rows={3}
              value={draft.footer.note}
              onChange={(e) => set("footer", { note: e.target.value })}
            />
          </Field>
          <Field label={t("f.links")} optional={t("optional")}>
            <RepeatableList
              items={draft.footer.links}
              onChange={(links) => set("footer", { links })}
              create={() => ({ label: "", href: "" })}
              addLabel={t("add.link")}
              emptyLabel={t("empty.links")}
              max={CAPS.links}
              maxLabel={t("max")}
              title={(item) => item.label}
            >
              {(item, update) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("f.linkLabel")}>
                    <input
                      className={inputClass}
                      value={item.label}
                      onChange={(e) => update({ label: e.target.value })}
                    />
                  </Field>
                  <Field label={t("f.linkHref")}>
                    <input
                      className={inputClass}
                      value={item.href}
                      placeholder="https://…"
                      onChange={(e) => update({ href: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </RepeatableList>
          </Field>
        </>
      );

    // ── Pages & SEO ──
    case "seo":
      return (
        <>
          <div className="space-y-2">
            <span className="text-sm font-medium">{t("blocks.pages.title")}</span>
            <p className="text-muted-foreground text-xs">{t("blocks.pages.desc")}</p>
            <div className="space-y-2">
              {(
                [
                  ["about", t("f.pageAbout")],
                  ["faq", t("f.pageFaq")],
                  ["contact", t("f.pageContact")],
                ] as const
              ).map(([key, label]) => (
                <div
                  key={key}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition-colors",
                    draft.pages[key] ? "border-primary/40 bg-primary/5" : "border-input",
                  )}
                >
                  <span className="flex-1 font-medium">{label}</span>
                  <Switch
                    size="sm"
                    checked={draft.pages[key]}
                    onChange={(value) => set("pages", { [key]: value })}
                    label={label}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <Field label={t("f.seoTitle")} hint={fallbackHint}>
              <input
                className={inputClass}
                value={draft.seo.title}
                onChange={(e) => set("seo", { title: e.target.value })}
              />
            </Field>
            <Field label={t("f.seoDescription")} hint={fallbackHint}>
              <textarea
                className={textareaClass}
                rows={2}
                value={draft.seo.description}
                onChange={(e) => set("seo", { description: e.target.value })}
              />
            </Field>
            <Field label={t("f.ogImage")} hint={t("hint.url")} optional={t("optional")}>
              <ImageField
                value={draft.seo.og_image_url}
                alt={t("f.ogImage")}
                onChange={(og_image_url) => set("seo", { og_image_url })}
                {...imageLabels}
              />
            </Field>
          </div>
        </>
      );

    // ── Legal & trust (docs/lms/10 §6) ──
    case "legal":
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("f.businessName")} hint={t("hint.businessName")}>
              <input
                className={inputClass}
                value={draft.legal.business_name}
                onChange={(e) => set("legal", { business_name: e.target.value })}
              />
            </Field>
            <Field label={t("f.legalUpdated")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.legal.updated_at}
                placeholder={t("hint.legalUpdated")}
                onChange={(e) => set("legal", { updated_at: e.target.value })}
              />
            </Field>
          </div>

          {/* Blank is a legitimate answer: the site renders a complete default policy in the
              visitor's language, so an empty box is "use the standard one", not "no policy". */}
          {(
            [
              ["terms", t("f.legalTerms")],
              ["refund", t("f.legalRefund")],
              ["privacy", t("f.legalPrivacy")],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label} hint={t("hint.legalFallback")}>
              <textarea
                className={textareaClass}
                rows={8}
                value={draft.legal[key]}
                onChange={(e) => set("legal", { [key]: e.target.value })}
              />
            </Field>
          ))}

          <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-xs leading-relaxed">
            {t("hint.legalResponsibility")}
          </p>
        </>
      );
  }
}
