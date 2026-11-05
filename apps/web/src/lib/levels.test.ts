import { describe, expect, it } from "vitest";
import { makeSession } from "@/test/auth";
import { forWord } from "@/test/level-word";
import arMessages from "../../messages/ar.json";
import enMessages from "../../messages/en.json";
import { levelWord, wordOf } from "./levels";

/** The one helper every label naming the classification reads through (docs/centre-profile §3). */
describe("levelWord", () => {
  it("is LEVEL with no session, an older session or a Quran academy that never chose", () => {
    expect(levelWord(null)).toBe("LEVEL");
    expect(levelWord(undefined)).toBe("LEVEL");
    expect(levelWord(makeSession("ACADEMY_OWNER"))).toBe("LEVEL");
    expect(levelWord(makeSession("SUPER_ADMIN"))).toBe("LEVEL");
    expect(wordOf(null)).toBe("LEVEL");
    expect(wordOf("nonsense")).toBe("LEVEL");
  });

  it("follows the academy's choice", () => {
    const academy = { name: "Lingo", displayName: "Lingo", logoUrl: null };
    expect(levelWord(makeSession("ACADEMY_OWNER", { academy: { ...academy, levelLabel: "GRADE" } }))).toBe("GRADE");
    expect(levelWord(makeSession("ACADEMY_OWNER", { academy: { ...academy, levelLabel: "YEAR" } }))).toBe("YEAR");
    expect(wordOf("GRADE")).toBe("GRADE");
  });

  it("keeps the words every academy had, and gives the other two in both languages", () => {
    expect(forWord(arMessages.groups.form.level)).toBe("المستوى");
    expect(forWord(arMessages.groups.form.level, "GRADE")).toBe("الصف");
    expect(forWord(arMessages.groups.form.level, "YEAR")).toBe("السنة");
    expect(forWord(enMessages.groups.form.level)).toBe("Level");
    expect(forWord(enMessages.groups.form.level, "GRADE")).toBe("Grade");
    expect(forWord(enMessages.groups.form.level, "YEAR")).toBe("Year");
    expect(forWord(arMessages.levels.promote.subtitle, "YEAR")).toContain("{name}");
    expect(forWord(arMessages.levels.promote.subtitle, "YEAR")).toContain("سنة جديدة");
  });
});
