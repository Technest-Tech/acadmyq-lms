import { describe, expect, it } from "vitest";
import {
  DOC_PAGE_SLOT,
  DOC_PAGE_WIDTH,
  bgElementId,
  changedSince,
  decodeMessage,
  encodeMessage,
  mergeElements,
  pageBounds,
  sceneSignature,
  splitChunks,
  winsOver,
  type SyncElement,
  type WhiteboardMessage,
} from "./whiteboard-protocol";

const el = (id: string, version: number, versionNonce: number, isDeleted = false): SyncElement => ({
  id,
  version,
  versionNonce,
  isDeleted,
});

describe("whiteboard-protocol", () => {
  describe("encode/decode round-trip", () => {
    it("round-trips every message variant", () => {
      const msgs: WhiteboardMessage[] = [
        { t: "state", open: true, allowDraw: false },
        { t: "scene", elements: [el("a", 1, 5)] },
        { t: "sync-request" },
        { t: "sync-full", elements: [el("a", 2, 9)], open: true, allowDraw: true },
        { t: "clear" },
        {
          t: "doc-page",
          meta: { docId: "d1", page: 2, totalPages: 9, fileId: "f2", naturalW: 800, naturalH: 1131, mimeType: "image/jpeg" },
        },
        { t: "doc-chunk", fileId: "f2", i: 0, n: 3, s: "AAAA" },
        { t: "doc-close" },
        { t: "sa-scene", elements: [el("s", 1, 4)] },
        { t: "sa-clear" },
        { t: "sa-baking", baking: true },
        { t: "sa-baking", baking: false },
      ];
      for (const m of msgs) expect(decodeMessage(encodeMessage(m))).toEqual(m);
    });

    it("returns null for junk or a foreign-topic payload", () => {
      expect(decodeMessage(new TextEncoder().encode("not json"))).toBeNull();
      expect(decodeMessage(new TextEncoder().encode(JSON.stringify({ t: "chat", body: "hi" })))).toBeNull();
    });
  });

  describe("winsOver", () => {
    it("prefers the higher version", () => {
      expect(winsOver(el("a", 2, 100), el("a", 1, 1))).toBe(true);
      expect(winsOver(el("a", 1, 1), el("a", 2, 100))).toBe(false);
    });
    it("breaks a version tie on the lower nonce (deterministic on every peer)", () => {
      expect(winsOver(el("a", 3, 10), el("a", 3, 20))).toBe(true);
      expect(winsOver(el("a", 3, 30), el("a", 3, 20))).toBe(false);
      expect(winsOver(el("a", 3, 20), el("a", 3, 20))).toBe(false); // identical → no replace
    });
  });

  describe("mergeElements", () => {
    it("unions disjoint elements from both scenes", () => {
      const merged = mergeElements([el("a", 1, 1)], [el("b", 1, 1)]);
      expect(merged.map((e) => e.id).sort()).toEqual(["a", "b"]);
    });

    it("takes the winning version of a conflicting element", () => {
      const merged = mergeElements([el("a", 1, 5)], [el("a", 4, 9)]);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({ id: "a", version: 4 });
    });

    it("keeps the local element when it already wins", () => {
      const merged = mergeElements([el("a", 5, 1)], [el("a", 2, 1)]);
      expect(merged[0]).toMatchObject({ version: 5 });
    });

    it("converges regardless of merge direction (commutative on the winner)", () => {
      const a = el("x", 3, 10);
      const b = el("x", 3, 7); // same version, lower nonce → b wins on both peers
      expect(mergeElements([a], [b])[0]).toBe(b);
      expect(mergeElements([b], [a])[0]).toBe(b);
    });

    it("propagates a deletion as an isDeleted element that wins by version", () => {
      const merged = mergeElements([el("a", 1, 1)], [el("a", 2, 1, true)]);
      expect(merged[0]).toMatchObject({ id: "a", isDeleted: true });
    });
  });

  describe("sceneSignature", () => {
    it("changes when an element's version bumps and ignores order", () => {
      expect(sceneSignature([el("a", 1, 1), el("b", 2, 1)])).toBe(sceneSignature([el("b", 2, 9), el("a", 1, 9)]));
      expect(sceneSignature([el("a", 1, 1)])).not.toBe(sceneSignature([el("a", 2, 1)]));
    });
  });

  describe("document layout", () => {
    it("stacks pages by a fixed slot so each page keeps its own annotation region", () => {
      expect(pageBounds(1, 1000, 1414)).toEqual({ x: 0, y: 0, width: DOC_PAGE_WIDTH, height: 1414 });
      expect(pageBounds(3, 1000, 1414).y).toBe(2 * DOC_PAGE_SLOT);
    });
    it("scales height to the page aspect ratio at the shared width", () => {
      expect(pageBounds(1, 800, 600).height).toBe(750); // 1000 * 600/800
    });
    it("derives a deterministic background id per page", () => {
      expect(bgElementId(2)).toBe("wb-doc-bg-2");
    });
  });

  describe("splitChunks", () => {
    it("returns a single chunk when the payload fits", () => {
      expect(splitChunks("abc", 10)).toEqual(["abc"]);
      expect(splitChunks("", 10)).toEqual([""]);
    });
    it("splits oversized payloads and rejoins to the original in order", () => {
      const data = "0123456789abcdef";
      const chunks = splitChunks(data, 5);
      expect(chunks).toEqual(["01234", "56789", "abcde", "f"]);
      expect(chunks.join("")).toBe(data);
    });
  });

  describe("changedSince", () => {
    const els: SyncElement[] = [
      { id: "a", version: 2, versionNonce: 1 },
      { id: "b", version: 5, versionNonce: 2 },
      { id: "c", version: 1, versionNonce: 3 },
    ];
    it("returns only elements whose version differs from the sent map", () => {
      const sent = new Map([
        ["a", 2],
        ["b", 4], // b changed since last send
        // c never sent
      ]);
      expect(changedSince(els, sent)).toEqual([
        { id: "b", version: 5, versionNonce: 2 },
        { id: "c", version: 1, versionNonce: 3 },
      ]);
    });
    it("returns nothing when every version matches", () => {
      const sent = new Map([
        ["a", 2],
        ["b", 5],
        ["c", 1],
      ]);
      expect(changedSince(els, sent)).toEqual([]);
    });
    it("treats an empty sent map as everything changed", () => {
      expect(changedSince(els, new Map())).toEqual(els);
    });
  });
});
