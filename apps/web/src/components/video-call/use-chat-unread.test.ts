import { describe, expect, it } from "vitest";
import { countUnread, type UnreadCountable } from "./use-chat-unread";

const remote = (): UnreadCountable => ({ from: { isLocal: false } });
const own = (): UnreadCountable => ({ from: { isLocal: true } });
const noSender = (): UnreadCountable => ({});

describe("countUnread", () => {
  it("is zero when everything is already seen", () => {
    const msgs = [remote(), remote()];
    expect(countUnread(msgs, 2)).toBe(0);
  });

  it("counts only messages past the seen watermark", () => {
    const msgs = [remote(), remote(), remote()];
    expect(countUnread(msgs, 1)).toBe(2);
  });

  it("never counts the local user's own messages", () => {
    const msgs = [remote(), own(), remote()];
    expect(countUnread(msgs, 0)).toBe(2);
  });

  it("treats a sender-less message as remote (system/unknown)", () => {
    expect(countUnread([noSender()], 0)).toBe(1);
  });

  it("clamps a negative or oversized watermark", () => {
    expect(countUnread([remote(), remote()], -5)).toBe(2);
    expect(countUnread([remote()], 10)).toBe(0);
  });

  it("is zero for an empty list", () => {
    expect(countUnread([], 0)).toBe(0);
  });
});
