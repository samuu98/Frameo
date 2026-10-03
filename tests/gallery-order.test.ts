import assert from "node:assert/strict";
import test from "node:test";
import { alternateGalleries } from "../src/lib/gallery-order";

const mix = (items: Array<{ id: string; galleries: string[] }>) => alternateGalleries(items, (item) => item.galleries);
test("alternates galleries and unassigned videos despite grouped input", () => {
  const items = [
    { id: "a1", galleries: ["a"] }, { id: "a2", galleries: ["a"] }, { id: "a3", galleries: ["a"] },
    { id: "b1", galleries: ["b"] }, { id: "b2", galleries: ["b"] },
    { id: "u1", galleries: [] }
  ];
  assert.deepEqual(mix(items).map(({ id }) => id), ["a1", "b1", "u1", "a2", "b2", "a3"]);
});
test("pagination keeps variety with no repeats or missing videos", () => {
  const items = ["a", "b", "c"].flatMap((gallery) => Array.from({ length: 50 }, (_, index) => ({ id: `${gallery}${index}`, galleries: [gallery] })));
  const ordered = mix(items);
  const pages = Array.from({ length: 4 }, (_, index) => ordered.slice(index * 48, (index + 1) * 48));
  assert.equal(new Set(pages.flat().map(({ id }) => id)).size, items.length);
  for (const page of pages) assert.equal(new Set(page.map(({ galleries }) => galleries[0])).size, 3);
  assert.deepEqual(mix(items), ordered);
});
test("multiple gallery membership yields each video once", () => {
  const items = [{ id: "a1", galleries: ["a"] }, { id: "ab", galleries: ["b", "a", "a"] }, { id: "b1", galleries: ["b"] }];
  assert.deepEqual(mix(items).map(({ id }) => id), ["a1", "ab", "b1"]);
  assert.deepEqual(mix(items.map((item) => ({ ...item, galleries: [...item.galleries].reverse() }))).map(({ id }) => id), mix(items).map(({ id }) => id));
  assert.deepEqual(mix([]), []);
});
