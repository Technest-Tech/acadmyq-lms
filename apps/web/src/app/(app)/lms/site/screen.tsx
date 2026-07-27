"use client";

import {
  Award,
  ExternalLink,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Layers,
  ListOrdered,
  Loader2,
  MessageSquareQuote,
  Palette,
  Phone,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import {
  Field,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/courses/form-bits";
import { EmptyState, LmsHero } from "@/components/courses/lms-ui";
import {
  ColorField,
  EditorBlock,
  RepeatableList,
  StringList,
} from "@/components/courses/site-editor-bits";
import { AlertBanner } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { getLmsSiteProfile, saveLmsSiteProfile, type LmsSiteProfile } from "@/lib/api";
import type { LearnSiteContent } from "@/lib/learn-api";
import { cn } from "@/lib/utils";

/**
 * The client's editor for their public course site (docs/lms/09).
 *
 * Every LMS client's site is the same template; this screen supplies the half that differs. It is
 * deliberately one long form over collapsible blocks in the order they appear on the page, so a
 * client editing "Why learn here" knows exactly which strip of their site they are changing.
 *
 * Empty is a valid answer everywhere: the site falls back to its own translated copy, so a client
 * can publish a complete site without filling in a single field, then improve it a block at a time.
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

export function LmsSiteScreen() {
  const t = useTranslations("lms.site");
  const { can } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<LmsSiteProfile | null>(null);
  const [draft, setDraft] = useState<LearnSiteContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
  const dirty = draft !== null && data !== null && JSON.stringify(draft) !== JSON.stringify(data.content);

  /** Patch one block; every field editor below goes through this so nothing mutates the draft. */
  function set<K extends keyof LearnSiteContent>(
    block: K,
    patch: Partial<LearnSiteContent[K]>,
  ): void {
    setDraft((d) => (d === null ? d : { ...d, [block]: { ...d[block], ...patch } }));
  }

  async function save() {
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
  }

  if (!can("course.read")) {
    return <EmptyState Icon={Globe} color="slate" title={t("noAccess")} />;
  }
  if (error !== null) {
    return <AlertBanner variant="error" message={error} />;
  }
  if (draft === null || data === null) {
    return (
      <div className="space-y-4">
        <div className="bg-muted h-32 animate-pulse rounded-2xl" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="bg-muted h-16 animate-pulse rounded-2xl" />
        ))}
      </div>
    );
  }

  const fallbackHint = t("hint.fallback");

  return (
    <div className="space-y-4 pb-28">
      <LmsHero
        Icon={Globe}
        eyebrow={
          <>
            <Sparkles className="size-3.5" />
            <span>{t("eyebrow")}</span>
          </>
        }
        title={t("title")}
        subtitle={t("subtitle")}
      >
        {data.site.url ? (
          <a
            href={data.site.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/15 px-3.5 text-sm font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/25"
          >
            <ExternalLink className="size-4" aria-hidden />
            {t("openSite")}
          </a>
        ) : (
          <span className="rounded-xl bg-white/10 px-3.5 py-2 text-xs text-white/80">
            {t("notPublished")}
          </span>
        )}
      </LmsHero>

      {!editable && <AlertBanner variant="info" message={t("readOnly")} />}

      <fieldset disabled={!editable} className="space-y-4">
        {/* ── Brand ── */}
        <EditorBlock
          Icon={Palette}
          color="violet"
          title={t("blocks.brand.title")}
          description={t("blocks.brand.desc")}
          defaultOpen
        >
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
            <Field label={t("f.logo")} hint={t("hint.url")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.brand.logo_url}
                placeholder="https://…"
                onChange={(e) => set("brand", { logo_url: e.target.value })}
              />
            </Field>
            <Field label={t("f.color")} hint={t("hint.color")}>
              <ColorField
                value={draft.brand.color}
                presets={BRAND_PRESETS}
                onChange={(color) => set("brand", { color })}
              />
            </Field>
          </div>
        </EditorBlock>

        {/* ── Hero ── */}
        <EditorBlock
          Icon={ImageIcon}
          color="indigo"
          title={t("blocks.hero.title")}
          description={t("blocks.hero.desc")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          <Field label={t("f.subtitle")} hint={fallbackHint}>
            <textarea
              className={textareaClass}
              rows={3}
              value={draft.hero.subtitle}
              onChange={(e) => set("hero", { subtitle: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
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
            <Field label={t("f.image")} hint={t("hint.url")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.hero.image_url}
                placeholder="https://…"
                onChange={(e) => set("hero", { image_url: e.target.value })}
              />
            </Field>
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
        </EditorBlock>

        {/* ── Numbers ── */}
        <EditorBlock
          Icon={Award}
          color="blue"
          title={t("blocks.stats.title")}
          description={t("blocks.stats.desc")}
          show={draft.stats.show}
          onShowChange={(show) => set("stats", { show })}
          showLabel={t("showOnSite")}
          count={draft.stats.items.length}
        >
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
        </EditorBlock>

        {/* ── Why learn here ── */}
        <EditorBlock
          Icon={Sparkles}
          color="violet"
          title={t("blocks.features.title")}
          description={t("blocks.features.desc")}
          show={draft.features.show}
          onShowChange={(show) => set("features", { show })}
          showLabel={t("showOnSite")}
          count={draft.features.items.length}
        >
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
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
                <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
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
        </EditorBlock>

        {/* ── How it works ── */}
        <EditorBlock
          Icon={ListOrdered}
          color="blue"
          title={t("blocks.steps.title")}
          description={t("blocks.steps.desc")}
          show={draft.steps.show}
          onShowChange={(show) => set("steps", { show })}
          showLabel={t("showOnSite")}
          count={draft.steps.items.length}
        >
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
        </EditorBlock>

        {/* ── About ── */}
        <EditorBlock
          Icon={Layers}
          color="indigo"
          title={t("blocks.about.title")}
          description={t("blocks.about.desc")}
          show={draft.about.show}
          onShowChange={(show) => set("about", { show })}
          showLabel={t("showOnSite")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("f.heading")} hint={fallbackHint}>
              <input
                className={inputClass}
                value={draft.about.heading}
                onChange={(e) => set("about", { heading: e.target.value })}
              />
            </Field>
            <Field label={t("f.image")} hint={t("hint.url")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.about.image_url}
                placeholder="https://…"
                onChange={(e) => set("about", { image_url: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t("f.body")} hint={fallbackHint}>
            <textarea
              className={textareaClass}
              rows={5}
              value={draft.about.body}
              onChange={(e) => set("about", { body: e.target.value })}
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
        </EditorBlock>

        {/* ── Teachers ── */}
        <EditorBlock
          Icon={Users}
          color="emerald"
          title={t("blocks.instructors.title")}
          description={t("blocks.instructors.desc")}
          show={draft.instructors.show}
          onShowChange={(show) => set("instructors", { show })}
          showLabel={t("showOnSite")}
          count={draft.instructors.items.length}
        >
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
            create={() => ({ name: "", role: "", bio: "", photo_url: "" })}
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
                  <input
                    className={inputClass}
                    value={item.photo_url}
                    placeholder="https://…"
                    onChange={(e) => update({ photo_url: e.target.value })}
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
              </>
            )}
          </RepeatableList>
        </EditorBlock>

        {/* ── Reviews ── */}
        <EditorBlock
          Icon={MessageSquareQuote}
          color="amber"
          title={t("blocks.testimonials.title")}
          description={t("blocks.testimonials.desc")}
          show={draft.testimonials.show}
          onShowChange={(show) => set("testimonials", { show })}
          showLabel={t("showOnSite")}
          count={draft.testimonials.items.length}
        >
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
                <div className="grid gap-3 sm:grid-cols-3">
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
                  <input
                    className={inputClass}
                    value={item.photo_url}
                    placeholder="https://…"
                    onChange={(e) => update({ photo_url: e.target.value })}
                  />
                </Field>
              </>
            )}
          </RepeatableList>
        </EditorBlock>

        {/* ── FAQ ── */}
        <EditorBlock
          Icon={HelpCircle}
          color="blue"
          title={t("blocks.faq.title")}
          description={t("blocks.faq.desc")}
          show={draft.faq.show}
          onShowChange={(show) => set("faq", { show })}
          showLabel={t("showOnSite")}
          count={draft.faq.items.length}
        >
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
        </EditorBlock>

        {/* ── Closing CTA ── */}
        <EditorBlock
          Icon={Sparkles}
          color="rose"
          title={t("blocks.cta.title")}
          description={t("blocks.cta.desc")}
          show={draft.cta.show}
          onShowChange={(show) => set("cta", { show })}
          showLabel={t("showOnSite")}
        >
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
        </EditorBlock>

        {/* ── Contact ── */}
        <EditorBlock
          Icon={Phone}
          color="emerald"
          title={t("blocks.contact.title")}
          description={t("blocks.contact.desc")}
          show={draft.contact.show}
          onShowChange={(show) => set("contact", { show })}
          showLabel={t("showOnSite")}
        >
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
        </EditorBlock>

        {/* ── Footer ── */}
        <EditorBlock
          Icon={Layers}
          color="slate"
          title={t("blocks.footer.title")}
          description={t("blocks.footer.desc")}
          count={draft.footer.links.length}
        >
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
        </EditorBlock>

        {/* ── Pages & SEO ── */}
        <EditorBlock
          Icon={Search}
          color="slate"
          title={t("blocks.seo.title")}
          description={t("blocks.seo.desc")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("f.seoTitle")} hint={fallbackHint}>
              <input
                className={inputClass}
                value={draft.seo.title}
                onChange={(e) => set("seo", { title: e.target.value })}
              />
            </Field>
            <Field label={t("f.ogImage")} hint={t("hint.url")} optional={t("optional")}>
              <input
                className={inputClass}
                value={draft.seo.og_image_url}
                placeholder="https://…"
                onChange={(e) => set("seo", { og_image_url: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t("f.seoDescription")} hint={fallbackHint}>
            <textarea
              className={textareaClass}
              rows={2}
              value={draft.seo.description}
              onChange={(e) => set("seo", { description: e.target.value })}
            />
          </Field>

          <div className="space-y-2 border-t pt-4">
            <span className="text-sm font-medium">{t("blocks.pages.title")}</span>
            <p className="text-muted-foreground text-xs">{t("blocks.pages.desc")}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["about", t("f.pageAbout")],
                  ["faq", t("f.pageFaq")],
                  ["contact", t("f.pageContact")],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm transition-colors",
                    draft.pages[key] ? "border-primary/40 bg-primary/5" : "border-input",
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-primary size-4 cursor-pointer"
                    checked={draft.pages[key]}
                    onChange={(e) => set("pages", { [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </EditorBlock>
      </fieldset>

      {/* Save bar — fixed, because the form is far taller than a viewport and a save button at the
          bottom would be a scroll away from wherever the client is actually editing. */}
      {editable && dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <span className="text-muted-foreground flex-1 text-sm">{t("unsaved")}</span>
            <button
              type="button"
              onClick={() => setDraft(data.content)}
              className="border-input hover:bg-muted inline-flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium transition-colors"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t("discard")}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="bg-primary text-primary-foreground inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
