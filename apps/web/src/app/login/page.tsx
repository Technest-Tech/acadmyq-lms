import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthFrame, doorBrand } from "@/components/auth/auth-frame";
import { LoginScreen } from "./login-screen";

/**
 * The sign-in route — the platform's own door at `app.<root>/login`, and every management client's
 * door at their `<handle>.<root>` (docs/lms/02).
 *
 * A SERVER component so the client's identity is resolved before the first frame: the middleware
 * forwards the handle as `x-academy`, and the brand is fetched here rather than in the browser, so
 * a client's people never see the platform's login flash past on the way to their own. The frame
 * around the card (navy ground, header or language switch, help line) is `AuthFrame`, shared with
 * the password pages.
 */

export async function generateMetadata(): Promise<Metadata> {
  const client = await doorBrand();
  const t = await getTranslations();

  return client === null
    ? { title: `${t("auth.signIn")} — ${t("app.name")}` }
    : {
        title: `${t("auth.signIn")} — ${client.name}`,
        icons: client.logoUrl ? { icon: client.logoUrl } : undefined,
      };
}

export default async function LoginPage() {
  const client = await doorBrand();

  return (
    <AuthFrame brand={client}>
      <LoginScreen brand={client} />
    </AuthFrame>
  );
}
