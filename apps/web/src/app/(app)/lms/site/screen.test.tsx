import { render, screen, waitFor, within } from "@testing-library/react";
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
    legal: {
      show: true,
      terms: "",
      refund: "",
      privacy: "",
      business_name: "",
      updated_at: "",
    },
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

/** The rail row for a section, addressed the way a client does: by the section's own name. */
function railRow(title: string) {
  return screen.getByRole("button", { name: title });
}

describe("LmsSiteScreen (public-site builder)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getLmsSiteProfile).mockResolvedValue(profile());
    vi.mocked(api.saveLmsSiteProfile).mockImplementation(async (content) => ({
      ...profile(),
      content,
      configured: true,
    }));
  });

  it("lists every section and links to the live site", async () => {
    renderScreen();
    expect(await screen.findByText(L.title)).toBeInTheDocument();

    // The rail is the index: the sections in the order they appear on the site.
    expect(screen.getByText(L.blocks.brand.title)).toBeInTheDocument();
    expect(screen.getByText(L.blocks.hero.title)).toBeInTheDocument();
    expect(screen.getByText(L.blocks.legal.title)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: L.openSite });
    expect(link).toHaveAttribute("href", "http://noor.localhost:3000");
  });

  it("previews the client's own site, fed the draft rather than a mock of it", async () => {
    renderScreen();
    await screen.findByText(L.title);

    const frame = await screen.findByTitle(L.builder.preview);
    expect(frame).toHaveAttribute("src", "/learn/noor?preview=1");
  });

  it("opens a section and saves an edited field", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(L.title);

    // Nothing is open to start with — the client picks the strip they came to change.
    expect(screen.queryByDisplayValue("Noor")).not.toBeInTheDocument();
    await user.click(railRow(L.blocks.brand.title));

    const nameField = await screen.findByDisplayValue("Noor");
    await user.type(nameField, " Courses");

    const saveButton = await screen.findByRole("button", { name: L.save });
    await user.click(saveButton);

    await waitFor(() => expect(api.saveLmsSiteProfile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveLmsSiteProfile).mock.calls[0]?.[0]?.brand.name).toBe("Noor Courses");
    expect(await screen.findByText(L.saved)).toBeInTheDocument();
  });

  it("hides a section from the rail without opening it", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(L.title);

    // Every toggleable section carries the same switch label, so find the reviews row's own.
    const row = screen.getByText(L.blocks.testimonials.title).closest("div.group");
    expect(row).not.toBeNull();
    const toggle = within(row as HTMLElement).getByRole("switch", { name: L.showOnSite });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");

    // Turning a strip off is a change like any other, and saves the same way.
    await user.click(await screen.findByRole("button", { name: L.save }));
    await waitFor(() => expect(api.saveLmsSiteProfile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveLmsSiteProfile).mock.calls[0]?.[0]?.testimonials.show).toBe(false);
  });

  it("is read-only without course.manage", async () => {
    renderScreen(["course.read"]);
    expect(await screen.findByText(L.readOnly)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: L.save })).not.toBeInTheDocument();
  });

  it("blocks a user without course.read and never fetches", () => {
    renderScreen([]);
    expect(screen.getByText(L.noAccess)).toBeInTheDocument();
    expect(api.getLmsSiteProfile).not.toHaveBeenCalled();
  });
});
