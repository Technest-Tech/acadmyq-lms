"use client";

import {
  ArrowLeftRight,
  Building2,
  Check,
  ImageIcon,
  School,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { AcademyOwnerSection } from "@/components/academies/academy-owner-section";
import { Field, fieldClass } from "@/components/admin/field";
import {
  SectionCard,
  SectionCardFooter,
} from "@/components/admin/section-card";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  deleteAcademyLogo,
  deleteClient,
  updateAcademy,
  updateClientProfile,
  uploadAcademyLogo,
  type ClientDetail,
  type ClientProfileChange,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useFeatureLabels } from "./feature-labels";
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
      {client.client_type === "MANAGEMENT" && (
        <ClientProfileCard
          client={client}
          profile={data.profile ?? "QURAN"}
          onSaved={onSaved}
        />
      )}
      {/* The domains moved to the Connections tab, with WhatsApp and the payment gateway. */}
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

type Profile = "QURAN" | "CENTRE";
const PROFILES: Profile[] = ["QURAN", "CENTRE"];

/**
 * The client's type — a Quran academy or a centre — and the way to switch it after creation. The
 * switch previews first (what turns on, what turns off, and whether live money blocks it: active
 * hour packages onto a centre, open centre subscriptions back to Quran), then moves on confirm.
 */
export function ClientProfileCard({
  client,
  profile,
  onSaved,
}: {
  client: ClientRecord;
  profile: Profile;
  onSaved: () => void;
}) {
  const t = useTranslations("clients.detail.settings.profile");
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (!can("academy_billing.manage")) return null;

  const target: Profile = profile === "CENTRE" ? "QURAN" : "CENTRE";

  return (
    <>
      <SectionCard
        icon={School}
        title={t("title")}
        description={t("hint")}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            data-testid="client-profile-open"
          >
            <ArrowLeftRight className="size-4" aria-hidden />
            {t("change", { type: t(target) })}
          </Button>
        }
        testId="client-profile-card"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PROFILES.map((p) => (
            <div
              key={p}
              className={cn(
                "rounded-xl border p-4",
                p === profile
                  ? "border-primary bg-primary/5"
                  : "text-muted-foreground border-dashed",
              )}
              data-testid={`client-profile-${p}`}
              data-current={p === profile ? "true" : undefined}
            >
              <div className="flex items-center gap-2">
                <span className="text-foreground text-sm font-semibold">
                  {t(p)}
                </span>
                {p === profile && (
                  <span className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                    <Check className="size-3" aria-hidden />
                    {t("current")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed">{t(`${p}Desc`)}</p>
            </div>
          ))}
        </div>
      </SectionCard>
      <Modal
        open={open}
        onClose={close}
        title={t("modalTitle", { name: client.name, type: t(target) })}
        size="md"
      >
        {/* Mounted only while open, so every opening asks the server afresh. */}
        {open && (
          <ProfileSwitchForm
            client={client}
            target={target}
            onCancel={close}
            onDone={() => {
              close();
              onSaved();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function ProfileSwitchForm({
  client,
  target,
  onCancel,
  onDone,
}: {
  client: ClientRecord;
  target: Profile;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("clients.detail.settings.profile");
  const ts = useTranslations("clients");
  const labels = useFeatureLabels();
  const toast = useToast();
  const [plan, setPlan] = useState<ClientProfileChange | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    updateClientProfile(client.id, target, true)
      .then((p) => live && setPlan(p))
      .catch((e) => {
        if (!live) return;
        toast.error(e instanceof ApiError ? e.message : String(e));
        onCancel();
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one preview per opening
  }, [client.id, target]);

  const confirm = async () => {
    if (busy || plan === null || plan.blocker !== null) return;
    setBusy(true);
    try {
      await updateClientProfile(client.id, target);
      toast.success(t("done", { name: client.name, type: t(target) }));
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  if (plan === null) {
    return (
      <p
        className="text-muted-foreground py-6 text-center text-sm"
        data-testid="client-profile-loading"
      >
        {t("loading")}
      </p>
    );
  }

  const chips = (keys: string[], tone: "on" | "off") => (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => (
        <span
          key={k}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium",
            tone === "on"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-muted text-muted-foreground line-through decoration-1",
          )}
        >
          {labels.capability(k, k)}
        </span>
      ))}
    </div>
  );

  return (
    <div className="space-y-4" data-testid="client-profile-plan">
      {plan.blocker !== null ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
          data-testid="client-profile-blocked"
        >
          {t(`blocked_${plan.blocker.code}`, { count: plan.blocker.count })}
        </p>
      ) : (
        <>
          {plan.turned_on.length === 0 && plan.turned_off.length === 0 ? (
            <p className="text-sm">{t("nothing")}</p>
          ) : (
            <div className="space-y-3">
              {plan.turned_on.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">{t("turnedOn")}</p>
                  {chips(plan.turned_on, "on")}
                </div>
              )}
              {plan.turned_off.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">{t("turnedOff")}</p>
                  {chips(plan.turned_off, "off")}
                </div>
              )}
            </div>
          )}
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t("keepsData")}
          </p>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          {ts("subs.cancel")}
        </Button>
        <Button
          size="sm"
          disabled={busy || plan.blocker !== null}
          onClick={() => void confirm()}
          data-testid="client-profile-confirm"
        >
          {busy && (
            <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
          )}
          {t("confirm")}
        </Button>
      </div>
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
