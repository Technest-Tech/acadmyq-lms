import { describe, expect, it, vi } from "vitest";
import type { DataTableQuery, ListResult } from "@/lib/api";
import { fetchRoster } from "@/lib/roster";

type Row = { id: string; full_name: string };

/** A fake list endpoint over `all`, clamped to 100 a page like the API. */
function endpoint(all: Row[]) {
  return vi.fn(async (q: DataTableQuery): Promise<ListResult<Row>> => {
    const size = Math.min(q.pageSize ?? 25, 100);
    const page = q.page ?? 1;
    return { rows: all.slice((page - 1) * size, page * size), total: all.length, page, pageSize: size };
  });
}

const people = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, full_name: `Student ${i + 1}` }));

describe("fetchRoster", () => {
  it("brings back every student past the first hundred — the 101st is findable", async () => {
    const list = endpoint(people(250));
    const res = await fetchRoster(list, { filter: { status: "active" } });

    expect(res.rows).toHaveLength(250);
    expect(res.rows.at(-1)?.full_name).toBe("Student 250");
    expect(list).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenCalledWith({ filter: { status: "active" }, pageSize: 100 });
    expect(list).toHaveBeenCalledWith({ filter: { status: "active" }, page: 3, pageSize: 100 });
  });

  it("asks once when everything fits on the first page", async () => {
    const list = endpoint(people(7));
    expect((await fetchRoster(list)).rows).toHaveLength(7);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("keeps a student the list repeats (once per teacher) only once", async () => {
    const twice = [...people(100), { id: "s1", full_name: "Student 1" }, { id: "s101", full_name: "Student 101" }];
    const res = await fetchRoster(endpoint(twice));
    expect(res.rows.map((r) => r.id).filter((id) => id === "s1")).toHaveLength(1);
    expect(res.rows).toHaveLength(101);
  });
});
