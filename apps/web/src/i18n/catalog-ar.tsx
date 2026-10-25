"use client";

import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/ar.json";

/**
 * The app's Arabic catalogue, shipped as a client chunk. Passed from the root layout as a prop it
 * was serialised into EVERY page's HTML (~560 KB raw, ~135 KB compressed, fetched from the origin
 * on each full load); as a hashed static chunk the browser downloads it once and Cloudflare serves
 * it from the edge after that. Its English twin is `catalog-en.tsx`; the layout renders one.
 */
export function ArCatalog({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="ar" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
