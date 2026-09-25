"use client";

import { useTranslations } from "next-intl";

/**
 * Feature and limit names in the reader's language.
 *
 * The API's FeatureCatalog carries an English label per key (the source of truth for WHICH keys
 * exist); the words a Super Admin reads on the Features card and the plan forms come from the
 * message catalogues, so Arabic gets Arabic. A key the catalogues do not know yet — one just added
 * on the server — falls back to the server's label rather than printing a raw key.
 */
export function useFeatureLabels() {
  const tf = useTranslations("entitlements.feature");
  const tl = useTranslations("clients.features.limit");

  return {
    capability: (key: string, fallback: string): string =>
      tf.has(key) ? tf(key) : fallback,
    limit: (key: string, fallback: string): string =>
      tl.has(key) ? tl(key) : fallback,
  };
}
