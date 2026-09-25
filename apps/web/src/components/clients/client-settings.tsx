"use client";

import { Building2, ImageIcon, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { AcademyOwnerSection } from "@/components/academies/academy-owner-section";
import { Field, fieldClass } from "@/components/admin/field";
import {
  SectionCard,
  SectionCardFooter,
} from "@/components/admin/section-card";
import { useAuth } from "@/components/auth-provider";
import { ClientDomainsCard } from "@/components/clients/client-domains-card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  deleteAcademyLogo,
  deleteClient,
  updateAcademy,
  uploadAcademyLogo,
  type ClientDetail,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_RE,
  subdomainUrl,
  type ClientRecord,
} from "./client-summary";

/**
 * The Settings tab: identity (name, brand, subdomain, logo) beside the owner login, the client's
 * own domains underneath — next to the subdomain on purpose, because a custom domain points AT
 * that handle — and the danger zone last, on its own, in red.
 */
export function ClientSettingsTab({
  data,
  onSaved,
}: {
  data: ClientDetail;
  onSaved: () => void;
}) {
  const { client } = data;

  return (
    <div className="space-y-4" data-testid="client-settings">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ClientSettingsForm client={client} onSaved={onSaved} />
        </div>
        <AcademyOwnerSection academyId={client.id} />
      </div>
      <ClientDomainsCard clientId={client.id} />
      <DeleteClientCard client={client} />
    </div>
  );
}

/** Name / branding / subdomain / logo — the client-page home of the old academy config card. */
function ClientSettingsForm({
  client,
  onSaved,
}: {
  client: ClientRecord;
  onSaved: () => void;
}) {
  const t = useTranslations("clients.detail");
  const { can } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(client.name);
  const [brandName, setBrandName] = useState(client.brand_display_name ?? "");
  const [subdomain, setSubdomain] = useState(client.subdomain ?? "");
  const [logoUrl, setLogoUrl] = useState(client.brand_logo_url ?? "");
  const [saving, setSaving] = useState(false);

  if (!can("academy.configure")) return null;

  // Live subdomain feedback: format/reserved checks + the public URL the handle resolves to.
  const sub = subdomain.trim();
  const subValid = sub === "" || SUBDOMAIN_RE.test(sub);
  const subReserved = RESERVED_SUBDOMAINS.has(sub);
  const subUrl = subdomainUrl(sub);

  const save = async () => {
    setSaving(true);
    try {
      await updateAcademy(client.id, {
        name: name.trim(),
        brand_display_name: brandName.trim() === "" ? null : brandName.trim(),
        subdomain: subdomain.trim() === "" ? null : subdomain.trim(),
        brand_logo_url: logoUrl.trim() === "" ? null : logoUrl.trim(),
      });
      toast.success(t("saved"));
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      icon={Building2}
      title={t("settingsTitle")}
      description={t("settings.generalHint")}
      testId="client-settings-form"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("fieldName")}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
            data-testid="client-name"
          />
        </Field>
        <Field label={t("fieldBrandName")} hint={t("settings.brandNameHint")}>
          <input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            className={fieldClass}
          />
        </Field>
        <Field
          className="sm:col-span-2"
          label={t("fieldSubdomain")}
          error={
            subReserved
              ? t("subdomainReserved")
              : !subValid
                ? t("subdomainInvalid")
                : undefined
          }
          hint={
            subUrl !== null ? (
              <span className="break-all" dir="ltr">
                {t("subdomainPreview", { url: subUrl })}
              </span>
            ) : (
              t("subdomainHint")
            )
          }
        >
          <input
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
            placeholder="my-academy"
            dir="ltr"
            className={cn(
              fieldClass,
              "font-mono",
              (!subValid || subReserved) &&
                "border-red-400 dark:border-red-500",
            )}
            data-testid="client-subdomain"
          />
        </Field>
      </div>

      <div className="my-5 border-t" />

      <LogoField
        clientId={client.id}
        logoUrl={logoUrl}
        onChange={setLogoUrl}
        onUploaded={onSaved}
      />

      <SectionCardFooter>
        <Button
          size="sm"
          disabled={saving || name.trim() === "" || !subValid || subReserved}
          onClick={save}
          data-testid="client-settings-save"
        >
          {t("save")}
        </Button>
      </SectionCardFooter>
    </SectionCard>
  );
}

/**
 * The client's logo. An UPLOAD, not a URL to find somewhere else: the Super Admin picks a file and
 * the API stores it and rewrites `brand_logo_url` — the single column the client's branded sign-in,
 * their subdomain's front door and their course site all read — so it appears on every one of those
 * without a second step. The URL box stays underneath for a client whose logo is already hosted.
 *
 * Upload and Remove write immediately (they are their own endpoints); only the pasted URL waits for
 * Save, which is why the preview follows `logoUrl` either way.
 */
function LogoField({
  clientId,
  logoUrl,
  onChange,
  onUploaded,
}: {
  clientId: string;
  logoUrl: string;
  onChange: (url: string) => void;
  onUploaded: () => void;
}) {
  const t = useTranslations("clients.detail");
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // let the same file be re-picked after a failure
    if (!file) return;

    // Mirrors the API's own rules so an obvious reject never costs a round-trip.
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error(t("logoTypeError"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("logoSizeError"));
      return;
    }

    setBusy(true);
    try {
      const res = await uploadAcademyLogo(clientId, file);
      onChange(res.brand_logo_url);
      toast.success(t("logoSaved"));
      onUploaded();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteAcademyLogo(clientId);
      onChange("");
      toast.success(t("logoRemoved"));
      onUploaded();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium">{t("logoTitle")}</p>
      <div className="flex items-start gap-4">
        <div className="bg-muted/30 flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary client-owned host
            <img
              src={logoUrl}
              alt={t("logoPreviewAlt")}
              className="size-full object-contain p-1.5"
              data-testid="client-logo-preview"
            />
          ) : (
            <div className="text-muted-foreground/50 flex flex-col items-center gap-1">
              <ImageIcon className="size-6" aria-hidden />
              <span className="text-[10px]">{t("logoEmpty")}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={pick}
            data-testid="client-logo-file"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              data-testid="client-logo-upload"
            >
              <Upload className="size-3.5" aria-hidden />
              {busy
                ? t("logoUploading")
                : logoUrl
                  ? t("logoReplace")
                  : t("logoUpload")}
            </Button>
            {logoUrl !== "" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                disabled={busy}
                onClick={remove}
                data-testid="client-logo-remove"
              >
                <Trash2 className="size-3.5" aria-hidden />
                {t("logoRemove")}
              </Button>
            )}
          </div>
          <p className="text-muted-foreground max-w-sm text-xs">
            {t("logoHint")}
          </p>
        </div>
      </div>
      <Field label={t("fieldLogoUrl")} hint={t("logoUrlHint")}>
        <input
          value={logoUrl}
          onChange={(e) => onChange(e.target.value)}
          dir="ltr"
          className={cn(fieldClass, "font-mono text-xs")}
        />
      </Field>
    </div>
  );
}

/**
 * The one irreversible action on this page: wipe the client and everything in it. It lives at the
 * bottom of Settings, away from Suspend (the everyday, reversible off-switch), and the button stays
 * dead until the admin has typed the client's name — which the API checks again on its side.
 */
export function DeleteClientCard({ client }: { client: ClientRecord }) {
  const t = useTranslations("clients.detail");
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  // Stable on purpose: Modal re-runs its focus trap whenever onClose changes, which would pull
  // focus out of the name field on every keystroke.
  const close = useCallback(() => setOpen(false), []);

  if (!can("academy.delete")) return null;

  return (
    <>
      <SectionCard
        tone="danger"
        icon={Trash2}
        title={t("settings.dangerTitle")}
        description={t("deleteHint")}
        action={
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setOpen(true)}
            data-testid="client-delete-open"
          >
            <Trash2 className="size-4" aria-hidden />
            {t("deleteOpen")}
          </Button>
        }
        testId="client-delete-card"
      />
      <Modal open={open} onClose={close} title={t("deleteTitle")} size="sm">
        {/* Mounted only while open, so the typed name never survives a close. */}
        {open && <DeleteClientForm client={client} onCancel={close} />}
      </Modal>
    </>
  );
}

function DeleteClientForm({
  client,
  onCancel,
}: {
  client: ClientRecord;
  onCancel: () => void;
}) {
  const t = useTranslations("clients.detail");
  const ts = useTranslations("clients");
  const toast = useToast();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const matches = typed.trim() !== "" && typed.trim() === client.name.trim();

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await deleteClient(client.id, typed.trim());
      toast.success(t("deleted", { name: client.name }));
      router.replace("/admin/clients");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t.rich("deleteBody", {
          name: client.name,
          b: (chunks) => (
            <span className="text-foreground font-semibold">{chunks}</span>
          ),
        })}
      </p>
      <Field
        label={t.rich("deleteTypeName", {
          name: client.name,
          b: (chunks) => (
            <span className="text-foreground select-all font-mono font-semibold">
              {chunks}
            </span>
          ),
        })}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void confirm();
          }}
          autoComplete="off"
          spellCheck={false}
          className={fieldClass}
          data-testid="client-delete-name"
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          {ts("subs.cancel")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={!matches || busy}
          onClick={() => void confirm()}
          data-testid="client-delete-confirm"
        >
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {t("deleteConfirm")}
        </Button>
      </div>
    </div>
  );
}
