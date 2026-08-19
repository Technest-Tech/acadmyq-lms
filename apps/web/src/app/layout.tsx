import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Amiri, Tajawal } from "next/font/google";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { direction, type Locale } from "@/i18n/config";
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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = direction(locale as Locale);

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
