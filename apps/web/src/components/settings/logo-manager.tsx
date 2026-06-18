"use client";

import { Check, ImageIcon, Trash2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { SectionCard } from "@/components/settings/section-card";
import { Button } from "@/components/ui/button";
import {
  type Branding,
  DEFAULT_BRANDING,
  loadBranding,
  saveBranding,
} from "@/lib/branding";

/** Max logo file size we'll embed as a data URL (keeps localStorage well under quota). */
const MAX_LOGO_BYTES = 512 * 1024;

/** Upload the academy logo from the local device. Persisted client-side for now. */
export function LogoManager() {
  const t = useTranslations("settings.branding");
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [logo, setLogo] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const b = loadBranding();
    setBranding(b);
    setLogo(b.logoUrl);
  }, []);

  const dirty = logo !== branding.logoUrl;

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    setSaved(false);
    if (!file.type.startsWith("image/")) {
      setError(t("logoTypeError"));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(t("logoSizeError"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.onerror = () => setError(t("logoReadError"));
    reader.readAsDataURL(file);
  }

  function save() {
    const next = { ...branding, logoUrl: logo };
    saveBranding(next);
    setBranding(next);
    setSaved(true);
  }

  return (
    <SectionCard
      icon={ImageIcon}
      title={t("logoCardTitle")}
      description={t("logoCardDesc")}
      iconClassName="bg-gradient-to-br from-sky-500 to-indigo-500 shadow-indigo-500/25"
      testId="logo-manager"
    >
      <div className="space-y-5">
        {error && (
          <p
            className="rounded-xl bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          {/* Preview tile */}
          <div className="flex aspect-square w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed bg-gradient-to-br from-muted/40 to-muted/10">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo}
                alt={t("logoPreviewAlt")}
                className="size-full object-contain p-2"
              />
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-muted-foreground/50">
                <ImageIcon className="size-8" aria-hidden />
                <span className="text-[10px] font-medium">{t("logoEmpty")}</span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-2.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFile}
              data-testid="brand-logo-file"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                data-testid="upload-logo"
              >
                <Upload className="size-3.5" />
                {logo ? t("logoReplace") : t("logoUpload")}
              </Button>
              {logo && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setLogo("");
                    setSaved(false);
                  }}
                  data-testid="remove-logo"
                >
                  <Trash2 className="size-3.5" />
                  {t("logoRemove")}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground max-w-xs text-xs">
              {t("logoFileHint")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t pt-4">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={!dirty}
            onClick={save}
            data-testid="save-logo"
          >
            <Check className="size-3.5" />
            {saved && !dirty ? t("saved") : t("save")}
          </Button>
          {dirty && (
            <span className="text-muted-foreground text-xs">
              {t("unsaved")}
            </span>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
