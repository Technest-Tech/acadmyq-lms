"use client";

import dynamic from "next/dynamic";

// Lazy from a CLIENT component, so each language is its own chunk and a page loads only the one it
// renders (lazy from the server layout, both still landed in the layout's chunk).
const ArCatalog = dynamic(() => import("./catalog-ar").then((m) => m.ArCatalog));
const EnCatalog = dynamic(() => import("./catalog-en").then((m) => m.EnCatalog));

/** The app's message catalogue for `locale`, as a cached static chunk (see `catalog-ar.tsx`). */
export function Catalog({ locale, children }: { locale: string; children: React.ReactNode }) {
  return locale === "en" ? <EnCatalog>{children}</EnCatalog> : <ArCatalog>{children}</ArCatalog>;
}
