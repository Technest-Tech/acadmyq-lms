import { describe, expect, it } from "vitest";
import arMessages from "../../messages/ar.json";
import enMessages from "../../messages/en.json";

/**
 * Arabic and English have to stay the same shape (R-LOC-1).
 *
 * next-intl falls back to the key path when a message is missing, so a forgotten Arabic string does
 * not throw — it prints `learn.hero.startFree` on the button of a public, Arabic-first storefront.
 * Nothing catches that except a person looking at the page, which is exactly what this replaces.
 */

type Tree = { [key: string]: unknown };

/** Every leaf's dotted path, so a missing key is reported by name rather than as "objects differ". */
function paths(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];
  if (Array.isArray(node)) {
    // Arrays are content (default badges, the steps rail), not structure: their LENGTH is what has
    // to match, because the template renders them positionally.
    return [`${prefix}[]:${node.length}`, ...node.flatMap((item, i) => paths(item, `${prefix}[${i}]`))];
  }
  return Object.entries(node as Tree).flatMap(([key, value]) =>
    paths(value, prefix === "" ? key : `${prefix}.${key}`),
  );
}

function missing(from: unknown, against: unknown): string[] {
  const have = new Set(paths(against));
  return paths(from).filter((path) => !have.has(path));
}

describe("message catalogues", () => {
  it("has an Arabic message for every English one", () => {
    expect(missing(enMessages, arMessages)).toEqual([]);
  });

  it("has an English message for every Arabic one", () => {
    expect(missing(arMessages, enMessages)).toEqual([]);
  });

  it("never leaves one language blank where the other has words", () => {
    // A key blank in BOTH languages is a deliberate empty value (a column with no header, a
    // placeholder that should stay empty). A key blank in ONE is a translation someone dropped,
    // and renders as nothing at all for half the users.
    const en = flatten(enMessages);
    const ar = flatten(arMessages);
    const blank = (value: unknown) =>
      typeof value === "string" && value.trim() === "";

    const halfTranslated = Object.keys(en).filter(
      (path) => blank(en[path]) !== blank(ar[path]),
    );

    expect(halfTranslated).toEqual([]);
  });

  /**
   * The storefront's own namespace, checked explicitly: it is the only surface a member of the
   * public reads, and a key printed raw there is visible to a client's customers.
   */
  it("keeps the learner site's namespace complete in both languages", () => {
    const en = (enMessages as Tree).learn;
    const ar = (arMessages as Tree).learn;

    expect(en).toBeDefined();
    expect(missing(en, ar)).toEqual([]);
    expect(missing(ar, en)).toEqual([]);
  });
});

function flatten(node: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (node === null || typeof node !== "object") {
    out[prefix] = node;
    return out;
  }
  for (const [key, value] of Object.entries(node as Tree)) {
    flatten(value, prefix === "" ? key : `${prefix}.${key}`, out);
  }
  return out;
}
