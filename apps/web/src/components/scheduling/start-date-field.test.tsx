import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enMessages from "../../../messages/en.json";
import { countPastLessons, StartDateField } from "./start-date-field";

/** 2026-06-17 is a Wednesday; 2026-06-01 is a Monday. */
const TODAY = "2026-06-17";
const MONDAY = { weekday: 1 };
const WEDNESDAY = { weekday: 3 };

describe("countPastLessons", () => {
  it("counts the lessons a back-dated timetable would put in the past", () => {
    // Mondays on/after 1 June and before the 17th: 1st, 8th, 15th.
    expect(countPastLessons([MONDAY], "2026-06-01", TODAY)).toBe(3);
  });

  it("counts every slot on a day, not every day", () => {
    expect(
      countPastLessons(
        [{ weekday: 1 }, { weekday: 1 }],
        "2026-06-01",
        TODAY,
      ),
    ).toBe(6);
  });

  // Today's own lessons are not "past" — they are today's worklist, generated either way.
  it("stops at today", () => {
    expect(countPastLessons([WEDNESDAY], "2026-06-17", TODAY)).toBe(0);
    expect(countPastLessons([WEDNESDAY], "2026-06-10", TODAY)).toBe(1);
  });

  it("is zero for a start date today or later, and for an empty timetable", () => {
    expect(countPastLessons([MONDAY], "2026-07-01", TODAY)).toBe(0);
    expect(countPastLessons([], "2026-06-01", TODAY)).toBe(0);
    expect(countPastLessons([MONDAY], "", TODAY)).toBe(0);
  });

  it("survives a nonsense date instead of looping forever", () => {
    expect(countPastLessons([MONDAY], "not-a-date", TODAY)).toBe(0);
  });

  // Re-saving a timetable that has run since June must not claim it is about to create the
  // lessons June already produced — only the stretch before the old start is new history.
  it("counts only what is newly reached back to", () => {
    expect(countPastLessons([MONDAY], "2026-06-01", TODAY, "2026-06-01")).toBe(0);
    // Pulled back a week: the 1st becomes new, the 8th and 15th already exist.
    expect(countPastLessons([MONDAY], "2026-06-01", TODAY, "2026-06-08")).toBe(1);
    // Pushed forward: nothing new either way.
    expect(countPastLessons([MONDAY], "2026-06-15", TODAY, "2026-06-01")).toBe(0);
  });
});

describe("StartDateField", () => {
  function renderField(value: string) {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StartDateField value={value} onChange={() => {}} slots={[MONDAY]} />
      </NextIntlClientProvider>,
    );
  }

  // The warning is the guard against a mistyped year quietly writing months of history.
  it("warns, with a count, when the start date is in the past", () => {
    renderField("2020-01-06");
    expect(screen.getByTestId("backfill-warning")).toBeInTheDocument();
  });

  it("says nothing when the timetable starts today or later", () => {
    renderField("2099-01-04");
    expect(screen.queryByTestId("backfill-warning")).not.toBeInTheDocument();
  });
});
