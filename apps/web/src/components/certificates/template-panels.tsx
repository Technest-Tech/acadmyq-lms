"use client";

import { Building2, Palette, PenLine, Plus, RotateCcw, Trash2, Type } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, FieldGroup, inputClass, LangSwitch, Switch, textareaClass } from "./editor-fields";
import type { CertLang } from "./kit";
import type { CertificateContent } from "@/lib/api";
import { cn } from "@/lib/utils";

type ContentKey = keyof CertificateContent;

function key(base: string, lang: CertLang): ContentKey {
  return `${base}${lang === "ar" ? "Ar" : "En"}` as ContentKey;
}

function text(content: CertificateContent, k: ContentKey): string {
  const v = content[k];
  return typeof v === "string" ? v : "";
}

/** Accents that hold up on paper, and the lighter set that reads on a dark ground. */
const LIGHT_GROUND = ["#0E7C5A", "#0D9488", "#0F4C81", "#1E3A5F", "#4F46E5", "#7C3AED", "#8C2F39", "#B45309", "#EF6C4A", "#374151"];
const DARK_GROUND = ["#C9A227", "#D4AF37", "#F4C542", "#E8C07D", "#B76E79", "#C0C7D1", "#7EE0C3", "#9FB4FF", "#F59E0B", "#FFFFFF"];

interface PanelProps {
  content: CertificateContent;
  onField: (key: ContentKey, value: string | boolean) => void;
  lang: CertLang;
  onLang: (lang: CertLang) => void;
  disabled: boolean;
}

export function WordingPanel({
  content,
  defaults,
  onField,
  onRestore,
  lang,
  onLang,
  disabled,
}: PanelProps & { defaults: CertificateContent | null; onRestore: () => void }) {
  const t = useTranslations("certificates");
  const dir = lang === "ar" ? "rtl" : "ltr";
  const wordingMatchesDefaults =
    defaults !== null &&
    (["title", "presentation", "body"] as const).every((b) =>
      (["en", "ar"] as const).every((l) => text(content, key(b, l)) === text(defaults, key(b, l))),
    );

  const bodyKey = key("body", lang);
  const body = text(content, bodyKey);

  return (
    <div className="space-y-5">
      <FieldGroup
        icon={Type}
        title={t("wordingHeading")}
        action={<LangSwitch lang={lang} onChange={onLang} labels={{ en: t("langEn"), ar: t("langAr") }} />}
      >
        <Field id="cert-title" label={t("field_title")}>
          <input id="cert-title" dir={dir} value={text(content, key("title", lang))} maxLength={1000} disabled={disabled} onChange={(e) => onField(key("title", lang), e.target.value)} className={inputClass} />
        </Field>
        <Field id="cert-presentation" label={t("field_presentation")}>
          <input id="cert-presentation" dir={dir} value={text(content, key("presentation", lang))} maxLength={1000} disabled={disabled} onChange={(e) => onField(key("presentation", lang), e.target.value)} className={inputClass} />
        </Field>
        <Field
          id="cert-body"
          label={t("field_body")}
          hint={t("bodyHint")}
          aside={<span className={cn("text-[10px] tabular-nums", body.length > 220 ? "text-amber-600" : "text-muted-foreground")}>{body.length}</span>}
        >
          <textarea id="cert-body" rows={4} dir={dir} value={body} maxLength={1000} disabled={disabled} onChange={(e) => onField(bodyKey, e.target.value)} className={textareaClass} />
        </Field>
      </FieldGroup>

      {!disabled && defaults && (
        <button
          type="button"
          onClick={onRestore}
          disabled={wordingMatchesDefaults}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
          data-testid="restore-wording"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          {t("restoreWording")}
        </button>
      )}
    </div>
  );
}

export function BrandingPanel({
  content,
  defaults,
  onField,
  lang,
  onLang,
  disabled,
  ground,
  hasLogo,
}: PanelProps & { defaults: CertificateContent | null; ground: "light" | "dark"; hasLogo: boolean }) {
  const t = useTranslations("certificates");
  const dir = lang === "ar" ? "rtl" : "ltr";
  const accent = content.accentColor || defaults?.accentColor || "#C9A227";
  const swatches = Array.from(new Set([defaults?.accentColor, ...(ground === "dark" ? DARK_GROUND : LIGHT_GROUND)].filter((c): c is string => Boolean(c))));
  const hasSecond = Boolean(
    text(content, "signatory2NameEn") || text(content, "signatory2NameAr") || text(content, "signatory2TitleEn") || text(content, "signatory2TitleAr"),
  );
  // Filled second-signature fields always show; an empty block opens on request.
  const [secondOpen, setShowSecond] = useState(false);
  const showSecond = hasSecond || secondOpen;

  const clearSecond = () => {
    for (const k of ["signatory2NameEn", "signatory2NameAr", "signatory2TitleEn", "signatory2TitleAr"] as const) onField(k, "");
    setShowSecond(false);
  };

  return (
    <div className="space-y-6">
      <FieldGroup icon={Palette} title={t("accentColor")}>
        <div className="flex flex-wrap items-center gap-2">
          {swatches.map((hex) => {
            const active = accent.toLowerCase() === hex.toLowerCase();
            return (
              <button
                key={hex}
                type="button"
                aria-label={hex === defaults?.accentColor ? t("accentDefault") : hex}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onField("accentColor", hex)}
                style={{ background: hex }}
                className={cn(
                  "relative size-7 rounded-full ring-1 ring-black/10 transition-transform disabled:cursor-not-allowed",
                  active ? "ring-foreground ring-offset-background ring-2 ring-offset-2" : "hover:scale-110",
                )}
              >
                {hex === defaults?.accentColor && (
                  <span className="bg-background absolute -end-0.5 -top-0.5 size-2.5 rounded-full border" aria-hidden />
                )}
              </button>
            );
          })}
          <label className={cn("border-input relative flex h-7 items-center gap-1.5 rounded-full border ps-1 pe-2.5 text-xs", disabled ? "opacity-60" : "hover:bg-muted cursor-pointer")}>
            <span className="size-5 rounded-full ring-1 ring-black/10" style={{ background: accent }} />
            <span className="font-mono text-[11px] uppercase" dir="ltr">{accent}</span>
            <input
              type="color"
              aria-label={t("accentCustom")}
              value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#C9A227"}
              disabled={disabled}
              onChange={(e) => onField("accentColor", e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
          </label>
        </div>
        {ground === "dark" && <p className="text-muted-foreground text-[11px]">{t("accentDarkHint")}</p>}
      </FieldGroup>

      <FieldGroup
        icon={Building2}
        title={t("brandHeading")}
        action={<LangSwitch lang={lang} onChange={onLang} labels={{ en: t("langEn"), ar: t("langAr") }} />}
      >
        <Field id="cert-academyName" label={t("field_academyName")}>
          <input id="cert-academyName" dir={dir} value={text(content, key("academyName", lang))} maxLength={1000} disabled={disabled} onChange={(e) => onField(key("academyName", lang), e.target.value)} className={inputClass} />
        </Field>
        <Switch
          testId="cert-show-logo"
          label={t("showLogo")}
          hint={hasLogo ? t("showLogoHint") : t("noLogoHint")}
          checked={hasLogo && content.showLogo !== false}
          disabled={disabled || !hasLogo}
          onChange={(v) => onField("showLogo", v)}
        />
      </FieldGroup>

      <FieldGroup icon={PenLine} title={t("signaturesHeading")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="cert-signatoryName" label={t("field_signatoryName")}>
            <input id="cert-signatoryName" dir={dir} value={text(content, key("signatoryName", lang))} maxLength={1000} disabled={disabled} onChange={(e) => onField(key("signatoryName", lang), e.target.value)} className={inputClass} />
          </Field>
          <Field id="cert-signatoryTitle" label={t("field_signatoryTitle")}>
            <input id="cert-signatoryTitle" dir={dir} value={text(content, key("signatoryTitle", lang))} maxLength={1000} disabled={disabled} onChange={(e) => onField(key("signatoryTitle", lang), e.target.value)} className={inputClass} />
          </Field>
        </div>

        {showSecond ? (
          <div className="bg-muted/30 space-y-3 rounded-xl border border-dashed p-3">
            <div className="flex items-center justify-between">
              <span className="text-foreground/85 text-xs font-semibold">{t("secondSignature")}</span>
              {!disabled && (
                <button type="button" onClick={clearSecond} className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-[11px] font-medium transition-colors">
                  <Trash2 className="size-3" aria-hidden />
                  {t("removeSecondSignature")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id="cert-signatory2Name" label={t("field_signatoryName")}>
                <input id="cert-signatory2Name" dir={dir} value={text(content, key("signatory2Name", lang))} maxLength={1000} disabled={disabled} onChange={(e) => onField(key("signatory2Name", lang), e.target.value)} className={inputClass} />
              </Field>
              <Field id="cert-signatory2Title" label={t("field_signatoryTitle")}>
                <input id="cert-signatory2Title" dir={dir} value={text(content, key("signatory2Title", lang))} maxLength={1000} disabled={disabled} onChange={(e) => onField(key("signatory2Title", lang), e.target.value)} className={inputClass} />
              </Field>
            </div>
            <p className="text-muted-foreground text-[11px]">{t("secondSignatureHint")}</p>
          </div>
        ) : (
          !disabled && (
            <button
              type="button"
              onClick={() => setShowSecond(true)}
              className="text-primary hover:bg-primary/5 border-primary/30 inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-semibold transition-colors"
              data-testid="add-second-signature"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("addSecondSignature")}
            </button>
          )
        )}
      </FieldGroup>
    </div>
  );
}
