import type { AcademyRoleArea } from "@/lib/api";

/**
 * The role builder thinks in SECTIONS ("Students: none / view / manage"), the API in capability
 * codes. These helpers translate between the two; the sections themselves come from the server
 * (PermissionCatalog::AREAS, narrowed to what the user may grant), so the page and the catalog
 * cannot drift apart.
 */

/** Where a role stands in one section. `partial` = some of it, not a whole level. */
export type AreaLevel = "none" | "view" | "manage" | "partial";

/** The levels a section offers: always None, plus View and/or Manage when it has codes for them. */
export function levelsOf(
  area: AcademyRoleArea,
): Array<Exclude<AreaLevel, "partial">> {
  const levels: Array<Exclude<AreaLevel, "partial">> = ["none"];
  if (area.view.length > 0) levels.push("view");
  if (area.manage.length > 0) levels.push("manage");
  return levels;
}

export function codesOf(area: AcademyRoleArea): string[] {
  return [...area.view, ...area.manage];
}

export function levelOf(
  area: AcademyRoleArea,
  held: ReadonlySet<string>,
): AreaLevel {
  const view = area.view.filter((c) => held.has(c)).length;
  const manage = area.manage.filter((c) => held.has(c)).length;
  if (view === 0 && manage === 0) return "none";
  const allView = view === area.view.length;
  // A read-only section (no manage codes) tops out at View.
  if (allView && manage === area.manage.length)
    return area.manage.length > 0 ? "manage" : "view";
  if (allView && manage === 0) return "view";
  return "partial";
}

/** The role's codes with this section set to `level` — every other section untouched. */
export function applyLevel(
  area: AcademyRoleArea,
  held: ReadonlySet<string>,
  level: Exclude<AreaLevel, "partial">,
): Set<string> {
  const next = new Set(held);
  for (const code of codesOf(area)) next.delete(code);
  if (level === "view" || level === "manage")
    area.view.forEach((c) => next.add(c));
  if (level === "manage") area.manage.forEach((c) => next.add(c));
  return next;
}

/**
 * Grantable codes no section claims. The server test keeps this empty; the builder still shows
 * them in an "Other" row rather than silently dropping a capability it was handed.
 */
export function withLeftovers(
  areas: readonly AcademyRoleArea[],
  grantable: readonly string[],
): AcademyRoleArea[] {
  const filed = new Set(areas.flatMap(codesOf));
  const leftover = grantable.filter((c) => !filed.has(c));
  return leftover.length === 0
    ? [...areas]
    : [
        ...areas,
        { key: "other", kind: "operations", view: [], manage: leftover },
      ];
}
