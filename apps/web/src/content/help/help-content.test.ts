import { describe, expect, it } from "vitest";
import arMessages from "../../../messages/ar.json";
import enMessages from "../../../messages/en.json";
import { ACADEMY_STEPS, CENTRE_STEPS } from "@/components/help/getting-started";
import { videoPlayer } from "@/lib/help-api";
import ar from "./ar";
import en from "./en";
import { passes, stepParts, stepText, taskSlot, tasksFor, topicFor, topicsFor, videoSlots } from "./resolve";
import { HELP_TOPICS } from "./topics";
import type { HelpContent, HelpViewer } from "./types";

/**
 * The in-app help is three files that have to agree — the registry and one text file per language
 * — and a fourth thing they all quote: the interface itself. None of that is checked by the
 * compiler, and every way it can drift shows up in front of a client: a task with no words, a
 * question in one language only, or (the one that costs trust) steps that name a button the page
 * no longer has.
 */

const LANGUAGES: Array<[string, HelpContent, unknown]> = [
  ["ar", ar, arMessages],
  ["en", en, enMessages],
];

/** Every string the interface can show in one language. */
function catalogueValues(node: unknown, out = new Set<string>()): Set<string> {
  if (typeof node === "string") out.add(node.trim());
  else if (node !== null && typeof node === "object") Object.values(node).forEach((value) => catalogueValues(value, out));
  return out;
}

const labelsIn = (text: string) => stepParts(text).flatMap((part) => (typeof part === "string" ? [] : [part.label]));

describe("help registry", () => {
  it("gives every topic and task an id that can address a video", () => {
    const slots = videoSlots(HELP_TOPICS);
    for (const slot of slots) expect(slot).toMatch(/^[a-z0-9][a-z0-9._-]{0,79}$/);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("never gives a topic two tasks with one id, or no tasks at all", () => {
    for (const topic of HELP_TOPICS) {
      const ids = topic.tasks.map((task) => task.id);
      expect(ids.length, topic.id).toBeGreaterThan(0);
      expect(new Set(ids).size, topic.id).toBe(ids.length);
    }
  });

  it("points the dashboard's first steps at help that exists", () => {
    for (const step of [...ACADEMY_STEPS, ...CENTRE_STEPS]) {
      const topic = HELP_TOPICS.find((item) => item.id === step.help[0]);
      expect(topic, step.help.join(".")).toBeDefined();
      expect(topic!.tasks.some((task) => task.id === step.help[1]), step.help.join(".")).toBe(true);
    }
  });
});

describe.each(LANGUAGES)("help text (%s)", (_, content, messages) => {
  it("has words for every topic and every task, and for nothing else", () => {
    expect(Object.keys(content).sort()).toEqual(HELP_TOPICS.map((topic) => topic.id).sort());
    for (const topic of HELP_TOPICS) {
      expect(Object.keys(content[topic.id]!.tasks).sort(), topic.id).toEqual(
        topic.tasks.map((task) => task.id).sort(),
      );
    }
  });

  it("never leaves a title, a summary or a step blank", () => {
    for (const topic of HELP_TOPICS) {
      const text = content[topic.id]!;
      expect(text.title.trim(), topic.id).not.toBe("");
      expect(text.summary.trim(), topic.id).not.toBe("");
      for (const [taskId, task] of Object.entries(text.tasks)) {
        expect(task.title.trim(), taskSlot(topic.id, taskId)).not.toBe("");
        expect(task.steps.length, taskSlot(topic.id, taskId)).toBeGreaterThan(0);
        for (const step of task.steps) expect(step.trim()).not.toBe("");
        // Steps are list keys in the drawer: two identical steps in one task would collide.
        expect(new Set(task.steps).size, taskSlot(topic.id, taskId)).toBe(task.steps.length);
      }
    }
  });

  it("quotes only names the interface really shows", () => {
    // A chip is a promise: "press [[Save pay]]" sends someone hunting for exactly those words. So
    // each one must be a message the app renders in this language. Rename a button and this fails
    // until the help that quotes it is updated.
    const shown = catalogueValues(messages);
    const unknown: string[] = [];
    for (const topic of HELP_TOPICS) {
      const text = content[topic.id]!;
      const lines = [
        ...(text.tips ?? []),
        ...Object.values(text.tasks).flatMap((task) => [...task.steps, ...(task.note ? [task.note] : [])]),
      ];
      for (const label of lines.flatMap(labelsIn)) {
        if (!shown.has(label)) unknown.push(`${topic.id}: ${label}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});

describe("who sees which help", () => {
  const viewer = (permissions: string[], extra: Partial<HelpViewer> = {}): HelpViewer => ({
    permissions,
    capabilities: ["invoicing", "payroll", "groups", "trials", "packages", "staff"],
    profile: "QURAN",
    ...extra,
  });
  const owner = viewer([
    "student.read", "student.create", "student.update", "guardian.read", "guardian.create", "guardian.update",
    "teacher.read", "teacher.create", "teacher.set_pay", "schedule.read", "schedule.manage", "session.read",
    "session.mark_attendance", "session.cancel", "session.reschedule", "session.create", "session.revert_attendance",
    "invoice.read", "invoice.mark_paid", "invoice.create", "invoice.close", "payout.read", "payout.adjust",
    "payout.finalize", "settings.manage", "notification.read", "group.read", "group.manage",
  ]);
  const teacher = viewer([
    "schedule.read", "session.read", "session.mark_attendance", "session.create", "session.reschedule",
    "session.cancel_request", "session.free_request", "student.read", "group.read", "teacher.read_own",
    "payout.read_own",
  ]);
  const ids = (topicId: string, who: HelpViewer) =>
    tasksFor(HELP_TOPICS.find((topic) => topic.id === topicId)!, who).map((task) => task.id);

  it("shows a teacher a teacher's attendance tasks: a request, never the office's cancel or undo", () => {
    expect(ids("attendance", teacher)).toEqual(["mark", "sheet", "overdue", "request", "add"]);
    expect(ids("attendance", owner)).toEqual(["mark", "sheet", "overdue", "cancel", "add", "undo"]);
  });

  it("gives the teacher their own version of a shared page", () => {
    expect(ids("students", teacher)).toEqual(["mine"]);
    expect(ids("students", owner)).not.toContain("mine");
    expect(ids("dashboard", teacher)).toEqual(["overdue", "enter", "reports"]);
    expect(ids("payroll", teacher)).toEqual(["mine"]);
    // No "finalize": the page dropped the button (Ahmed 2026-11-22); months seal on the 3rd.
    expect(ids("payroll", owner)).toEqual(["read", "adjust", "transfer"]);
  });

  it("keeps a teacher out of pages they cannot open", () => {
    const topics = topicsFor(HELP_TOPICS, teacher).map((topic) => topic.id);
    expect(topics).toEqual(["dashboard", "students", "calendar", "attendance", "lesson-reports", "groups", "payroll"]);
    // The calendar is read-only for a teacher, whatever lesson permissions they hold.
    expect(ids("calendar", teacher)).toEqual(["views"]);
  });

  it("hides help for a feature the academy does not have", () => {
    const noGroups = { ...owner, capabilities: ["invoicing"] };
    expect(topicsFor(HELP_TOPICS, noGroups).map((topic) => topic.id)).not.toContain("groups");
    expect(ids("attendance", noGroups)).not.toContain("sheet");
    // A platform Super Admin outside any academy has no features switched off.
    expect(passes({ capability: "groups" }, { ...owner, capabilities: null })).toBe(true);
  });

  it("tells a centre's money pages from a Quran academy's", () => {
    const centre = viewer([...owner.permissions, "package.read"], {
      profile: "CENTRE",
      capabilities: ["centre", "groups", "accounting", "packages"],
    });
    const quran = viewer([...owner.permissions, "package.read"]);
    expect(topicFor(HELP_TOPICS, "/subscriptions", centre)?.id).toBe("subscriptions");
    expect(topicFor(HELP_TOPICS, "/subscriptions", quran)).toBeNull();
    expect(topicFor(HELP_TOPICS, "/packages/due", quran)?.id).toBe("packages");
    expect(topicFor(HELP_TOPICS, "/packages", centre)).toBeNull();
    // Closing the period is not a thing where bills never close.
    expect(ids("invoices", { ...quran, capabilities: ["invoicing", "centre"] })).not.toContain("close");
  });

  it("finds a page's topic from any path under it, and none for a page with no help", () => {
    expect(topicFor(HELP_TOPICS, "/students/8f1c/anything", owner)?.id).toBe("students");
    expect(topicFor(HELP_TOPICS, "/studentsX", owner)).toBeNull();
    expect(topicFor(HELP_TOPICS, "/audit", owner)).toBeNull();
  });
});

describe("step text", () => {
  it("splits a step into words and on-screen names", () => {
    expect(stepParts("Press [[Save]] then [[Close]].")).toEqual([
      "Press ",
      { label: "Save" },
      " then ",
      { label: "Close" },
      ".",
    ]);
    expect(stepParts("No names here")).toEqual(["No names here"]);
    expect(stepText("Press [[Save]] now")).toBe("Press Save now");
  });
});

describe("videoPlayer", () => {
  it("embeds YouTube in every spelling people paste", () => {
    const embed = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1";
    for (const url of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(videoPlayer(url), url).toEqual({ kind: "embed", src: embed });
    }
  });

  it("embeds Vimeo, and plays anything else as a file", () => {
    expect(videoPlayer("https://vimeo.com/123456789")).toEqual({
      kind: "embed",
      src: "https://player.vimeo.com/video/123456789?autoplay=1",
    });
    expect(videoPlayer("https://cdn.example.com/help/tour.mp4?sig=abc")).toEqual({
      kind: "file",
      src: "https://cdn.example.com/help/tour.mp4?sig=abc",
    });
    expect(videoPlayer("not a url")).toEqual({ kind: "file", src: "not a url" });
  });
});
