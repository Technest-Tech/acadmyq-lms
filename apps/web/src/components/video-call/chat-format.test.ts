import { describe, expect, it } from "vitest";
import {
  formatMessageTime,
  groupMessages,
  isPrivate,
  participantRole,
  PRIVATE_ATTR,
  PRIVATE_TO_ATTR,
  type ChatMessageLike,
} from "./chat-format";

function msg(
  id: string,
  identity: string,
  message: string,
  timestamp: number,
  extra: {
    isLocal?: boolean;
    name?: string;
    metadata?: string;
    attributes?: Record<string, string>;
  } = {},
): ChatMessageLike {
  return {
    id,
    timestamp,
    message,
    from: { identity, name: extra.name, isLocal: extra.isLocal, metadata: extra.metadata },
    attributes: extra.attributes,
  };
}

const privAttrs = (to?: string) => ({
  [PRIVATE_ATTR]: "1",
  ...(to ? { [PRIVATE_TO_ATTR]: to } : {}),
});

describe("participantRole", () => {
  it("reads a host role from metadata JSON", () => {
    expect(participantRole({ metadata: '{"role":"host"}' })).toBe("host");
  });

  it("reads guest and monitor roles", () => {
    expect(participantRole({ metadata: '{"role":"guest"}' })).toBe("guest");
    expect(participantRole({ metadata: '{"role":"monitor"}' })).toBe("monitor");
  });

  it("returns undefined for missing, empty, or garbled metadata", () => {
    expect(participantRole(undefined)).toBeUndefined();
    expect(participantRole({})).toBeUndefined();
    expect(participantRole({ metadata: "not json" })).toBeUndefined();
    expect(participantRole({ metadata: '{"role":"banana"}' })).toBeUndefined();
  });
});

describe("formatMessageTime", () => {
  it("returns a non-empty clock string for a timestamp", () => {
    const out = formatMessageTime(Date.UTC(2026, 5, 27, 14, 7), "en-US");
    expect(out).toMatch(/\d/);
  });

  it("does not throw on a bad locale tag", () => {
    expect(() => formatMessageTime(Date.now(), "not-a-locale!!")).not.toThrow();
  });
});

describe("groupMessages", () => {
  const t0 = 1_000_000;

  it("returns an empty array for no messages", () => {
    expect(groupMessages([])).toEqual([]);
  });

  it("merges consecutive messages from the same sender within the gap", () => {
    const groups = groupMessages([
      msg("1", "u1", "hey", t0, { name: "Sara" }),
      msg("2", "u1", "you there?", t0 + 1000, { name: "Sara" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.messages).toHaveLength(2);
    expect(groups[0]!.name).toBe("Sara");
  });

  it("splits when the sender changes", () => {
    const groups = groupMessages([
      msg("1", "u1", "hi", t0, { name: "Sara" }),
      msg("2", "u2", "hello", t0 + 1000, { name: "Omar" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.identity)).toEqual(["u1", "u2"]);
  });

  it("splits the same sender when the time gap is too large", () => {
    const groups = groupMessages(
      [
        msg("1", "u1", "first", t0, { name: "Sara" }),
        msg("2", "u1", "much later", t0 + 6 * 60 * 1000, { name: "Sara" }),
      ],
      5 * 60 * 1000,
    );
    expect(groups).toHaveLength(2);
  });

  it("flags the local user and surfaces the role", () => {
    const groups = groupMessages([
      msg("1", "me", "yo", t0, { isLocal: true, name: "Me" }),
      msg("2", "host1", "welcome", t0 + 1000, { metadata: '{"role":"host"}', name: "Teacher" }),
    ]);
    expect(groups[0]!.isLocal).toBe(true);
    expect(groups[1]!.role).toBe("host");
    expect(groups[1]!.isLocal).toBe(false);
  });

  it("falls back to identity when no display name is set", () => {
    const groups = groupMessages([msg("1", "guest-abc", "hi", t0)]);
    expect(groups[0]!.name).toBe("guest-abc");
  });

  it("does NOT merge a public and a private message from the same sender", () => {
    const groups = groupMessages([
      msg("1", "u1", "public", t0, { name: "Sara" }),
      msg("2", "u1", "secret", t0 + 1000, { name: "Sara", attributes: privAttrs() }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.private).toBe(false);
    expect(groups[1]!.private).toBe(true);
  });

  it("carries the private flag and recipient name onto the group", () => {
    const groups = groupMessages([
      msg("1", "me", "psst", t0, { isLocal: true, attributes: privAttrs("Teacher") }),
    ]);
    expect(groups[0]!.private).toBe(true);
    expect(groups[0]!.privateTo).toBe("Teacher");
  });
});

describe("isPrivate", () => {
  it("is true only when the private attribute is set to 1", () => {
    expect(isPrivate({ attributes: { [PRIVATE_ATTR]: "1" } })).toBe(true);
    expect(isPrivate({ attributes: { [PRIVATE_ATTR]: "0" } })).toBe(false);
    expect(isPrivate({ attributes: {} })).toBe(false);
    expect(isPrivate({})).toBe(false);
  });
});
