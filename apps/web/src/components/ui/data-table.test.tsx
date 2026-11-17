import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataTableQuery, ListResult } from "@/lib/api";
import enMessages from "../../../messages/en.json";
import arMessages from "../../../messages/ar.json";
import { type ColumnDef, DataTable } from "./data-table";

interface Row {
  id: string;
  name: string;
  price: number;
}

const columns: ColumnDef<Row>[] = [
  { key: "name", header: "Name", sortKey: "name", render: (r) => r.name },
  { key: "price", header: "Price", sortKey: "price", render: (r) => r.price },
];

function page(rows: Row[], total = rows.length): ListResult<Row> {
  return { rows, total, page: 1, pageSize: 25 };
}

function renderTable(
  fetcher: (q: DataTableQuery) => Promise<ListResult<Row>>,
  locale: "en" | "ar" = "en",
  extra: Partial<React.ComponentProps<typeof DataTable<Row>>> = {},
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? enMessages : arMessages}
    >
      <DataTable<Row>
        fetcher={fetcher}
        columns={columns}
        getRowId={(r) => r.id}
        searchable
        {...extra}
      />
    </NextIntlClientProvider>,
  );
}

describe("DataTable (Sprint 4 §6)", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.clearAllMocks());

  it("applies rowClassName to the matching row only", async () => {
    const fetcher = vi.fn(async () =>
      page([
        { id: "gone", name: "Left", price: 1 },
        { id: "here", name: "Stays", price: 2 },
      ]),
    );
    const { container } = renderTable(fetcher, "en", {
      rowClassName: (r) => (r.id === "gone" ? "bg-red-50" : undefined),
    });
    await waitFor(() => expect(container.querySelector('tr[data-row="gone"]')).not.toBeNull());
    expect(container.querySelector('tr[data-row="gone"]')!.className).toContain("bg-red-50");
    expect(container.querySelector('tr[data-row="here"]')!.className).not.toContain("bg-red-50");
  });

  it("renders server rows", async () => {
    const fetcher = vi.fn(async () =>
      page([{ id: "a", name: "محمد", price: 100 }]),
    );
    renderTable(fetcher);
    const table = await screen.findByTestId("dt-table");
    expect(within(table).getByText("محمد")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shows the actionable empty state", async () => {
    const fetcher = vi.fn(async () => page([], 0));
    renderTable(fetcher);
    expect(await screen.findByTestId("dt-empty")).toBeInTheDocument();
  });

  it("shows a retryable error and refetches on retry", async () => {
    const fetcher = vi
      .fn<(q: DataTableQuery) => Promise<ListResult<Row>>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(page([{ id: "a", name: "Sara", price: 1 }]));
    renderTable(fetcher);

    const error = await screen.findByTestId("dt-error");
    const user = userEvent.setup();
    await user.click(within(error).getByRole("button"));
    const table = await screen.findByTestId("dt-table");
    expect(within(table).getByText("Sara")).toBeInTheDocument();
  });

  it("debounces search and refetches with the search term", async () => {
    const fetcher = vi.fn(async () =>
      page([{ id: "a", name: "محمد", price: 1 }]),
    );
    renderTable(fetcher);
    await screen.findByTestId("dt-table");
    expect(fetcher).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByTestId("dt-search"), {
      target: { value: "مح" },
    });

    // The query fires once on the debounce pause (300ms), carrying the search term.
    await waitFor(() =>
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "مح" }),
      ),
    );
  });

  it("toggles server-side sort asc → desc on header click", async () => {
    const fetcher = vi.fn(async () => page([{ id: "a", name: "A", price: 1 }]));
    renderTable(fetcher);
    await screen.findByTestId("dt-table");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("dt-sort-price"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "price" }),
      ),
    );

    await user.click(screen.getByTestId("dt-sort-price"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "-price" }),
      ),
    );
  });

  it("draws a grid of cards instead of a table, and sorts from the rail", async () => {
    const fetcher = vi.fn(async () => page([{ id: "a", name: "Alpha", price: 5 }]));
    const onRowClick = vi.fn();
    renderTable(fetcher, "en", {
      defaultSort: "-price",
      onRowClick,
      rowClassName: () => "is-late",
      renderCard: (r) => <span data-testid="my-card">{r.name} costs {r.price}</span>,
    });

    const card = await screen.findByTestId("my-card");
    expect(card).toHaveTextContent("Alpha costs 5");
    // No table and no density toggle: the card is the whole record.
    expect(screen.queryByTestId("dt-table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dt-cards")).not.toBeInTheDocument();
    expect(card.closest("li")).toHaveClass("is-late");

    // The columns name what can be sorted; the direction is its own button.
    const sort = screen.getByTestId("dt-sort") as HTMLSelectElement;
    expect(sort.value).toBe("price");
    await userEvent.selectOptions(sort, "name");
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "-name", page: 1 })));
    await userEvent.click(screen.getByTestId("dt-sort-direction"));
    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "name" })));

    await userEvent.click(screen.getByTestId("my-card"));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("paginates server-side via the next control", async () => {
    const fetcher = vi.fn(async () =>
      page([{ id: "a", name: "A", price: 1 }], 100),
    );
    renderTable(fetcher);
    await screen.findByTestId("dt-table");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("dt-next"));
    await waitFor(() =>
      expect(fetcher).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
  });

  // TC-4.25: the same data renders as a table (>= sm) and stacked cards (mobile),
  // and works under the RTL (ar) locale.
  it("renders both table and card layouts under RTL", async () => {
    const fetcher = vi.fn(async () =>
      page([{ id: "a", name: "محمد", price: 1 }]),
    );
    renderTable(fetcher, "ar");
    expect(await screen.findByTestId("dt-table")).toBeInTheDocument();
    expect(screen.getByTestId("dt-cards")).toBeInTheDocument();
  });
});
