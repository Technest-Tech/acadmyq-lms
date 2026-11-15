import type { HelpGate, HelpTaskDef, HelpTopicDef, HelpViewer } from "./types";

/** Does this person get to see something behind `gate`? */
export function passes(gate: HelpGate, viewer: HelpViewer): boolean {
  if (gate.anyOf !== undefined && !gate.anyOf.some((code) => viewer.permissions.includes(code))) return false;
  if (gate.allOf !== undefined && !gate.allOf.every((code) => viewer.permissions.includes(code))) return false;
  if (gate.noneOf !== undefined && gate.noneOf.some((code) => viewer.permissions.includes(code))) return false;
  if (gate.profile !== undefined && gate.profile !== viewer.profile) return false;
  if (viewer.capabilities !== null) {
    if (gate.capability !== undefined && !viewer.capabilities.includes(gate.capability)) return false;
    if (gate.withoutCapability !== undefined && viewer.capabilities.includes(gate.withoutCapability)) return false;
  }
  return true;
}

/** The tasks of a topic this person can actually do — a teacher never reads the office's steps. */
export function tasksFor(topic: HelpTopicDef, viewer: HelpViewer): HelpTaskDef[] {
  return topic.tasks.filter((task) => passes(task, viewer));
}

/** The topics this person has any use for: allowed in, and with at least one task to read. */
export function topicsFor(topics: readonly HelpTopicDef[], viewer: HelpViewer): HelpTopicDef[] {
  return topics.filter((topic) => passes(topic, viewer) && tasksFor(topic, viewer).length > 0);
}

const covers = (route: string, pathname: string) => pathname === route || pathname.startsWith(`${route}/`);

/**
 * The topic that explains the page at `pathname`, if any. Two topics can claim one path (a centre
 * and a Quran academy read `/attendance` differently): the person's own gate decides, and among
 * those left the most specific route wins, so `/packages/due` beats `/packages`.
 */
export function topicFor(
  topics: readonly HelpTopicDef[],
  pathname: string,
  viewer: HelpViewer,
): HelpTopicDef | null {
  let best: HelpTopicDef | null = null;
  let bestLength = -1;
  for (const topic of topicsFor(topics, viewer)) {
    for (const route of topic.routes) {
      if (covers(route, pathname) && route.length > bestLength) {
        best = topic;
        bestLength = route.length;
      }
    }
  }
  return best;
}

/** Every place a video can play, in reading order: each topic's tour, then its tasks. */
export function videoSlots(topics: readonly HelpTopicDef[]): string[] {
  return topics.flatMap((topic) => [topic.id, ...topic.tasks.map((task) => taskSlot(topic.id, task.id))]);
}

export const taskSlot = (topicId: string, taskId: string) => `${topicId}.${taskId}`;

/**
 * A step's text, split into plain words and the on-screen names inside it ("Press [[Save]]" →
 * "Press ", {label: "Save"}). The names are drawn as chips so the eye finds the same word on the page.
 */
export function stepParts(step: string): Array<string | { label: string }> {
  const parts: Array<string | { label: string }> = [];
  const pattern = /\[\[(.+?)\]\]/g;
  let last = 0;
  for (let match = pattern.exec(step); match !== null; match = pattern.exec(step)) {
    if (match.index > last) parts.push(step.slice(last, match.index));
    parts.push({ label: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < step.length) parts.push(step.slice(last));
  return parts;
}

/** A step as plain text (search, screen readers' labels): the brackets dropped, the names kept. */
export const stepText = (step: string) => step.replace(/\[\[(.+?)\]\]/g, "$1");
