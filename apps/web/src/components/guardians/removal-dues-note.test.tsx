import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withAuth, makeSession } from "@/test/auth";
import { RemovalDuesNote } from "./removal-dues-note";

const session = () => makeSession("ACADEMY_OWNER", { permissions: ["guardian.update"] });

describe("RemovalDuesNote", () => {
  it("says what the deletion lets go", async () => {
    render(withAuth(session(), <RemovalDuesNote load={() => Promise.resolve({ dues: [{ currency: "EGP", amount_minor: 90000 }] })} />));

    expect((await screen.findByTestId("removal-dues")).textContent).toContain("٩٠٠");
  });

  it("says nothing when there is nothing to let go", async () => {
    const load = vi.fn(() => Promise.resolve({ dues: [] }));
    render(withAuth(session(), <RemovalDuesNote load={load} />));

    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByTestId("removal-dues")).toBeNull();
  });
});
