import { Almarai } from "next/font/google";
import "./marketing.css";

/**
 * What every page wearing the marketing site's look needs, in one import: its face and its
 * decoration stylesheet (`marketing.css` — the navy grounds, the lattice, the cards).
 *
 * Shared because the site's chrome is not only under `app/(marketing)`: the sign-in and password
 * pages render the same header and footer from their own routes, and a page that renders the
 * footer without this stylesheet gets a footer with no ground under its light text.
 *
 * Almarai is the modern workspace's font, so the site and the product read as one. Declared here
 * rather than reusing the root layout's instance because that one is `preload: false` (most app
 * pages never paint it); Next preloads a font only on the routes that import it.
 */
export const marketingFont = Almarai({
  subsets: ["arabic", "latin"],
  weight: ["400", "700", "800"],
  variable: "--font-marketing",
  display: "swap",
});
