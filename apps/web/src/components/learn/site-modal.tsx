"use client";

import { useTranslations } from "next-intl";
import { useLearn } from "@/components/learn/context";
import { brandVars } from "@/components/learn/theme";
import { Modal, type ModalProps } from "@/components/ui/modal";

/**
 * A dialog that belongs to the public course site (docs/lms/09).
 *
 * Every modal on the storefront — sign in, redeem a code, watch a preview — goes through here for
 * two reasons, both of which were bugs when each call site did it itself:
 *
 *  1. **The palette.** `Modal` portals into `document.body`, escaping the `.learn-site` wrapper that
 *     pins this site to the light theme. Without the class and the brand variables travelling with
 *     it, a visitor whose OS is in dark mode got a sign-in form with black fields on a white card.
 *  2. **The close button's name.** It is icon-only, so it needs a translated accessible label, and
 *     "Close" in English on an Arabic storefront is exactly the kind of leak this template exists
 *     to prevent.
 */
export function SiteModal(
  props: Omit<ModalProps, "themeClassName" | "themeStyle" | "closeLabel">,
) {
  const t = useTranslations("learn");
  const { site } = useLearn();

  return (
    <Modal
      {...props}
      closeLabel={t("player.close")}
      // `text-foreground` alongside the palette class: custom properties inherit across the portal
      // but `color` does not — without it the fields keep the dark body's near-white ink and the
      // form is white-on-white.
      themeClassName="learn-site text-foreground"
      themeStyle={brandVars(site.brand.color)}
    />
  );
}
