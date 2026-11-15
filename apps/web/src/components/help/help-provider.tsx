"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useHelpViewer } from "@/components/help/help-data";
import { HelpDrawer } from "@/components/help/help-drawer";
import { topicFor } from "@/content/help/resolve";
import { HELP_TOPICS } from "@/content/help/topics";
import type { HelpTopicDef } from "@/content/help/types";

/**
 * The in-app help's one moving part: which help is open, and for whom.
 *
 * Mounted once around the shell, so the "?" in the header, the dashboard's first-steps card and the
 * help centre all open the SAME drawer — `useHelp().openHelp("students", "add")` from anywhere.
 * Everything heavy (the words, the video list) is fetched the first time the help is opened, never
 * on page load: a person who never presses "?" pays nothing for it.
 */

interface HelpValue {
  /** Open the help: for a topic (and one of its tasks), or for the page being looked at. */
  openHelp: (topicId?: string, taskId?: string) => void;
  /** The topic that explains the current page, if it has one this person can read. */
  pageTopic: HelpTopicDef | null;
  /** True until this person has opened the current page's help once — the header's nudge. */
  unseen: boolean;
}

const HelpContext = createContext<HelpValue | null>(null);

const NO_HELP: HelpValue = { openHelp: () => {}, pageTopic: null, unseen: false };

/** Safe outside the provider (a screen rendered on its own in a test): the help just does nothing. */
export function useHelp(): HelpValue {
  return useContext(HelpContext) ?? NO_HELP;
}

const SEEN_KEY = "academiq:help:seen";

function readSeen(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const viewer = useHelpViewer();
  const pageTopic = useMemo(() => topicFor(HELP_TOPICS, pathname, viewer), [pathname, viewer]);

  /** `null` = closed. An open help with no topic is the "nothing written for this page yet" card. */
  const [open, setOpen] = useState<{ topicId: string | null; taskId: string | null } | null>(null);
  // Read after mount, never during render: the server has no localStorage to agree with.
  const [seen, setSeen] = useState<Set<string> | null>(null);
  useEffect(() => setSeen(readSeen()), []);

  const openHelp = useCallback(
    (topicId?: string, taskId?: string) => {
      const id = topicId ?? pageTopic?.id ?? null;
      setOpen({ topicId: id, taskId: taskId ?? null });
      if (id === null) return;
      setSeen((prev) => {
        const next = new Set(prev ?? []).add(id);
        try {
          localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
        } catch {
          // Private mode: the nudge simply comes back next visit.
        }
        return next;
      });
    },
    [pageTopic],
  );

  // Following a link out of the help ("open the page", "all guides") lands on a new page: the
  // drawer that sent the person there has done its job.
  useEffect(() => setOpen(null), [pathname]);

  const value = useMemo<HelpValue>(
    () => ({
      openHelp,
      pageTopic,
      unseen: seen !== null && pageTopic !== null && !seen.has(pageTopic.id),
    }),
    [openHelp, pageTopic, seen],
  );

  return (
    <HelpContext.Provider value={value}>
      {children}
      <HelpDrawer
        open={open !== null}
        topicId={open?.topicId ?? null}
        taskId={open?.taskId ?? null}
        onPage={open !== null && open.topicId !== null && open.topicId === pageTopic?.id}
        onClose={() => setOpen(null)}
      />
    </HelpContext.Provider>
  );
}
