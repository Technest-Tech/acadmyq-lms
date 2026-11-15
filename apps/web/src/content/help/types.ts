import type { LucideIcon } from "lucide-react";
import type { AcademyKind } from "@/lib/api";

/**
 * The in-app help, as data.
 *
 * Two halves that a test keeps in step:
 *  - the REGISTRY (`topics.ts`) — which pages have help, which tasks each explains and who sees
 *    them. No words, so it can sit in the shell's bundle and answer "does this page have help?".
 *  - the TEXT (`ar.ts`, `en.ts`) — the words, one file per language, loaded only when someone opens
 *    the help.
 *
 * A topic is one page; a task is one thing a person comes to that page to do ("add a student").
 * Help is written by task, never by feature: people ask "how do I…", not "what is this screen".
 */

/** Who a topic or a task is for. Every condition given must hold; none given ⇒ everyone. */
export interface HelpGate {
  /** Holds at least one of these permission codes. */
  anyOf?: readonly string[];
  /** Holds every one of these. */
  allOf?: readonly string[];
  /** Holds none of these — the version for someone who only does their own work (a teacher). */
  noneOf?: readonly string[];
  /** The academy has this feature switched on. */
  capability?: string;
  /** The academy does NOT have this feature (the other way of doing the same job). */
  withoutCapability?: string;
  /** Only this kind of school. */
  profile?: AcademyKind;
}

export interface HelpTaskDef extends HelpGate {
  /** Unique inside its topic. Its video slot is `<topic>.<task>`. */
  id: string;
}

/** The shelves of the help centre. */
export type HelpGroup = "start" | "people" | "teaching" | "money" | "setup";

export interface HelpTopicDef extends HelpGate {
  /** Also the video slot of the page's own tour. Lowercase words and dashes. */
  id: string;
  icon: LucideIcon;
  group: HelpGroup;
  /** Where "open the page" goes. */
  href: string;
  /** The paths this topic explains: each one and everything under it. */
  routes: readonly string[];
  tasks: readonly HelpTaskDef[];
}

export interface HelpTaskText {
  /** The question in the person's words: "How do I add a student?" */
  title: string;
  /**
   * The clicks, in order. A name between double brackets is something on the screen — a button, a
   * tab, a field — and is drawn as a chip: "Press [[Add student]]".
   */
  steps: readonly string[];
  /** One thing worth knowing before or after. */
  note?: string;
}

export interface HelpTopicText {
  title: string;
  /** What the page is for, in a sentence or two. */
  summary: string;
  tasks: Readonly<Record<string, HelpTaskText>>;
  tips?: readonly string[];
}

/** One language's words, by topic id. */
export type HelpContent = Readonly<Record<string, HelpTopicText>>;

/** The signed-in person, as far as the help cares. */
export interface HelpViewer {
  permissions: readonly string[];
  /** `null` = a platform Super Admin outside any academy: no feature is "off" for them. */
  capabilities: readonly string[] | null;
  profile: AcademyKind;
}
