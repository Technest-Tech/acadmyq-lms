import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Workspace package consumed as TypeScript source (no build step).
  transpilePackages: ["@academiq/contracts"],
};

export default withNextIntl(nextConfig);
