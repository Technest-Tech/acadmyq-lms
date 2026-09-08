import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Amiri, Tajawal } from "next/font/google";
import { headers } from "next/headers";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { direction, type Locale } from "@/i18n/config";
import { PATHNAME_HEADER } from "@/lib/request-headers";
import "./globals.css";

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});

/**
 * The DISPLAY face — a classical naskh, used only where the app speaks ceremonially to a family:
 * the report card's headline and du'a, and anywhere else a line is meant to be read slowly rather
 * than scanned. Tajawal is a fine UI sans, but naskh is what an Arabic reader recognises as
 * beautiful; the difference is the whole point of a card an academy sends home.
 */
const amiri = Amiri({
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Acadmyq",
  description: "Academy Management Platform",
};

/**
 * The public marketing routes (`app/(marketing)`). They are listed rather than inferred because
 * the decision below has to be exact: an app route mistaken for a marketing one would render with
 * no translations at all.
 */
const MARKETING_PATHS = new Set([
  "/",
  "/course-platform",
  "/academy-management",
  "/contact",
  "/privacy",
  "/terms",
]);

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const dir = direction(locale as Locale);

  /*
   * What the browser is handed.
   *
   * The application needs the whole catalogue: hundreds of client components read from every
   * namespace in it. A MARKETING page reads exactly one — `locale`, for the language switch in the
   * header and footer — and shipping the other ~300KB of JSON to a landing page is both dead weight
   * on the metric that matters most there and a copy of the app's entire vocabulary (module names,
   * feature labels, everything) embedded in a public sales page.
   *
   * The pathname arrives as a header the middleware sets on every request. When it is absent for
   * any reason the FULL catalogue is sent — the fail-safe direction, since a missing message breaks
   * a screen while a surplus one merely costs bytes.
   */
  const pathname = (await headers()).get(PATHNAME_HEADER);
  const all = await getMessages();
  const messages =
    pathname !== null && MARKETING_PATHS.has(pathname) ? { locale: all.locale } : all;

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${tajawal.variable} ${amiri.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Resolves the theme before the first paint, so a dark-mode user never sees a white
            flash. It mutates <html>, which is why that element suppresses hydration warnings. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <ToastProvider>{children}</ToastProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
