import assert from "node:assert/strict";
import test from "node:test";
import { mediaOrderBy, mediaSortGroups, orderByResolution, parseMediaSort, type MediaSort } from "../src/lib/media-sort";

test("every option is accepted and ends in a stable pagination tie-breaker", () => {
  const options = mediaSortGroups.flatMap(({ options }) => [...options]);
  assert.equal(new Set(options.map(({ value }) => value)).size, options.length);
  for (const { value } of options) {
    assert.equal(parseMediaSort(value), value);
    assert.deepEqual(mediaOrderBy(value).at(-1), { id: "asc" });
  }
  assert.equal(parseMediaSort("name"), "name-asc");
  assert.equal(parseMediaSort("invalid"), "smart");
});

test("sorts dates, size, duration and counts in both directions before pagination", () => {
  for (const [key, field, optional] of [
    ["created", "createdAt", false], ["updated", "updatedAt", false], ["captured", "capturedAt", true],
    ["size", "bytes", false], ["duration", "durationMs", true], ["fps", "frameRate", true],
    ["name", "title", false], ["filename", "sourceFileName", true], ["width", "width", true], ["height", "height", true]
  ] as const) {
    for (const direction of ["asc", "desc"] as const) {
      assert.deepEqual(mediaOrderBy(`${key}-${direction}` as MediaSort)[0], { [field]: optional ? { sort: direction, nulls: "last" } : direction });
    }
  }
  for (const field of ["people", "tags", "groups", "markers"] as const) {
    for (const direction of ["asc", "desc"] as const) assert.deepEqual(mediaOrderBy(`${field}-${direction}`)[0], { [field]: { _count: direction } });
  }
});

test("resolution uses total pixels, puts missing metadata last and keeps page boundaries stable", () => {
  const items = [
    { id: "wide", width: 2000, height: 500 },
    { id: "square", width: 1500, height: 1500 },
    { id: "portrait", width: 500, height: 2000 },
    { id: "unknown", width: null, height: null }
  ];
  const ascending = orderByResolution(items, "resolution-asc");
  assert.deepEqual(ascending.map(({ id }) => id), ["portrait", "wide", "square", "unknown"]);
  assert.deepEqual(orderByResolution(items, "resolution-desc").map(({ id }) => id), ["square", "portrait", "wide", "unknown"]);
  assert.deepEqual([...ascending.slice(0, 2), ...ascending.slice(2)], ascending);
  assert.deepEqual(items[0], { id: "wide", width: 2000, height: 500 });
});
