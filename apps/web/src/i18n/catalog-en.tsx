"use client";

import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";

/**
 * The app's English catalogue, shipped as a client chunk. Passed from the root layout as a prop it
 * was serialised into EVERY page's HTML (~560 KB raw, ~135 KB compressed, fetched from the origin
 * on each full load); as a hashed static chunk the browser downloads it once and Cloudflare serves
 * it from the edge after that. Its Arabic twin is `catalog-ar.tsx`; the layout renders one.
 */
export function EnCatalog({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
