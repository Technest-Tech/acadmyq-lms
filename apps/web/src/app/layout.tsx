import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Tajawal } from "next/font/google";
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
      className={tajawal.variable}
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
