import type { SystemRole } from "@/lib/api";

/** The platform's built-in roles, in the order the product ranks them. */
export const SYSTEM_ROLES: readonly SystemRole[] = [
  "SUPER_ADMIN",
  "ACADEMY_OWNER",
  "SUPERVISOR",
  "TEACHER",
  "STAFF",
];

export function isSystemRole(code: string): code is SystemRole {
  return (SYSTEM_ROLES as readonly string[]).includes(code);
}

/** The slice of a next-intl `t` this helper needs: read a key, and ask whether it exists. */
export interface RoleTranslator {
  (key: string): string;
  has(key: string): boolean;
}

/**
 * The label for a role code, under a namespace that carries the system-role keys plus `other`
 * (`roles`, `audit.roles`, `platformUsers.role`, …).
 *
 * A custom role's code is an opaque `CR_…` token, so its NAME is shown when the caller has it and
 * "Custom role" otherwise — never the raw key path, which is what `t(\`roles.${code}\`)` printed for
 * every supervisor, staff member and custom-role holder before this existed.
 */
export function roleLabel(
  t: RoleTranslator,
  code: string | null | undefined,
  name?: string | null,
): string {
  if (!code) return "—";
  if (name) return name;
  return t.has(code) ? t(code) : t("other");
}
