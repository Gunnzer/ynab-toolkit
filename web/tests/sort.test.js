import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { sortRows } from "../js/tools/sort.js";

describe("sortRows", () => {
  const rows = [
    { name: "Item 10", amount: 5, date: new Date(2026, 1, 3) },
    { name: "item 2", amount: -3, date: new Date(2026, 0, 9) },
    { name: "", amount: null, date: null },
    { name: "Apple", amount: 5, date: new Date(2026, 2, 1) },
  ];

  test("text sorts naturally and ignores case; blanks last both ways", () => {
    assert.deepEqual(sortRows(rows, { key: "name", dir: "asc" }).map((r) => r.name),
      ["Apple", "item 2", "Item 10", ""]);
    assert.deepEqual(sortRows(rows, { key: "name", dir: "desc" }).map((r) => r.name),
      ["Item 10", "item 2", "Apple", ""]);
  });

  test("numbers as numbers, ties keep their order", () => {
    assert.deepEqual(sortRows(rows, { key: "amount", dir: "asc" }).map((r) => r.name),
      ["item 2", "Item 10", "Apple", ""]);
    assert.deepEqual(sortRows(rows, { key: "amount", dir: "desc" }).map((r) => r.name),
      ["Item 10", "Apple", "item 2", ""]);
  });

  test("dates by time", () => {
    assert.deepEqual(sortRows(rows, { key: "date", dir: "desc" }).map((r) => r.name),
      ["Apple", "Item 10", "item 2", ""]);
  });

  test("a custom reader, and no sort at all", () => {
    assert.deepEqual(
      sortRows(rows, { key: "len", dir: "asc" }, (row) => row.name.length).map((r) => r.name),
      ["", "Apple", "item 2", "Item 10"]);
    assert.equal(sortRows(rows, null), rows);
  });
});
