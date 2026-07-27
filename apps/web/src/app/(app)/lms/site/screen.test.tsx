import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui/toast";
import { authValue, makeSession } from "@/test/auth";
import type { LmsSiteProfile } from "@/lib/api";
import enMessages from "../../../../../messages/en.json";
import { LmsSiteScreen } from "./screen";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getLmsSiteProfile: vi.fn(),
  saveLmsSiteProfile: vi.fn(),
}));

import * as api from "@/lib/api";

const L = enMessages.lms.site;

/** A structurally complete profile the API would return for a fresh academy. */
function profile(): LmsSiteProfile {
  const content = {
    brand: { name: "Noor", tagline: "", logo_url: "", color: "#12836a", hero_style: "gradient" as const },
    hero: { eyebrow: "", title: "", subtitle: "", image_url: "", primary_cta: "browse" as const, badges: [] },
    stats: { show: true, items: [] },
    about: { show: true, heading: "", body: "", image_url: "", points: [] },
    features: { show: true, heading: "", subheading: "", items: [] },
    steps: { show: true, heading: "", items: [] },
    instructors: { show: true, heading: "", items: [] },
    testimonials: { show: true, heading: "", items: [] },
    faq: { show: true, heading: "", items: [] },
    cta: { show: true, title: "", subtitle: "", button_label: "", button_href: "" },
    contact: { show: true, email: "", phone: "", whatsapp: "", address: "", map_url: "", socials: {} },
    footer: { note: "", links: [] },
    seo: { title: "", description: "", og_image_url: "" },
    pages: { about: true, faq: true, contact: true },
  };
  return {
    content,
    defaults: content,
    configured: false,
    site: { subdomain: "noor", url: "http://noor.localhost:3000", root_domain: "localhost:3000", configured: true },
  };
}

function renderScreen(permissions: string[] = ["course.read", "course.manage"]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>
        <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER", { permissions }))}>
          <LmsSiteScreen />
        </AuthContext.Provider>
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("LmsSiteScreen (public-site editor)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getLmsSiteProfile).mockResolvedValue(profile());
    vi.mocked(api.saveLmsSiteProfile).mockImplementation(async (content) => ({
      ...profile(),
      content,
      configured: true,
    }));
  });

  it("loads the profile and links to the live site", async () => {
    renderScreen();
    expect(await screen.findByText(L.title)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: L.openSite });
    expect(link).toHaveAttribute("href", "http://noor.localhost:3000");
  });

  it("saves an edited field and shows a confirmation", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(L.title);

    // The Brand block is open by default; its name field starts from the loaded content.
    const nameField = screen.getByDisplayValue("Noor");
    await user.type(nameField, " Courses");

    // The save bar only appears once the draft diverges from what was loaded.
    const saveButton = await screen.findByRole("button", { name: L.save });
    await user.click(saveButton);

    await waitFor(() => expect(api.saveLmsSiteProfile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveLmsSiteProfile).mock.calls[0]?.[0]?.brand.name).toBe("Noor Courses");
    expect(await screen.findByText(L.saved)).toBeInTheDocument();
  });

  it("is read-only without course.manage", async () => {
    renderScreen(["course.read"]);
    expect(await screen.findByText(L.readOnly)).toBeInTheDocument();
  });

  it("blocks a user without course.read and never fetches", () => {
    renderScreen([]);
    expect(screen.getByText(L.noAccess)).toBeInTheDocument();
    expect(api.getLmsSiteProfile).not.toHaveBeenCalled();
  });
});
