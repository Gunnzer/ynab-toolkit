// Home's widget layout: defaults, cleaning up a stored layout, and edits.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as hl from "../js/tools/home_layout.js";

const CATALOG = [
  { id: "a", sizes: ["s", "m", "l"], defaultSize: "l", byDefault: true },
  { id: "b", sizes: ["s", "m"], defaultSize: "s", byDefault: true },
  { id: "c", sizes: ["m", "l"], defaultSize: "m", byDefault: false },
  { id: "d", sizes: ["s"], defaultSize: "s", byDefault: true },
];

describe("home layout", () => {
  test("nothing stored is the default: byDefault widgets, catalogue order", () => {
    assert.deepEqual(hl.resolveLayout(null, CATALOG), [
      { id: "a", size: "l", config: {} }, { id: "b", size: "s", config: {} }, { id: "d", size: "s", config: {} },
    ]);
  });

  test("a stored layout keeps its order; unknown and repeated widgets are dropped", () => {
    const saved = [{ id: "d", size: "s" }, { id: "gone", size: "m" }, { id: "a", size: "m" }, { id: "d", size: "s" }];
    assert.deepEqual(hl.resolveLayout(saved, CATALOG), [{ id: "d", size: "s", config: {} }, { id: "a", size: "m", config: {} }]);
  });

  test("any widget keeps its own settings; junk settings are dropped", () => {
    const saved = [{ id: "a", size: "l", config: { title: "Mine" } }, { id: "b", size: "s", config: [1] }];
    assert.deepEqual(hl.resolveLayout(saved, CATALOG).map((i) => i.config), [{ title: "Mine" }, {}]);
  });

  test("an empty stored layout stays empty - everything was hidden on purpose", () => {
    assert.deepEqual(hl.resolveLayout([], CATALOG), []);
  });

  test("a size the widget does not offer moves to the nearest it does", () => {
    const saved = [{ id: "b", size: "l" }, { id: "c", size: "s" }, { id: "a", size: "huge" }];
    assert.deepEqual(hl.resolveLayout(saved, CATALOG).map((i) => i.size), ["m", "m", "s"]);
  });

  test("moving steps over widgets that are not showing", () => {
    const layout = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const shown = (id) => id !== "b";
    assert.deepEqual(hl.moveWidget(layout, "c", -1, shown).map((i) => i.id), ["c", "b", "a"]);
    assert.equal(hl.moveWidget(layout, "a", -1), layout, "already first: unchanged");
    assert.equal(hl.moveWidget(layout, "c", 1), layout, "already last: unchanged");
  });

  test("drag and drop places before a widget, or last", () => {
    const layout = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.deepEqual(hl.placeBefore(layout, "c", "a").map((i) => i.id), ["c", "a", "b"]);
    assert.deepEqual(hl.placeBefore(layout, "a", null).map((i) => i.id), ["b", "c", "a"]);
    assert.deepEqual(hl.placeBefore(layout, "a", "c").map((i) => i.id), ["b", "a", "c"]);
  });

  test("a multi widget can show more than once, each copy with its own config", () => {
    const chart = { id: "chart", sizes: ["s", "m", "l"], defaultSize: "m", multi: true };
    const catalog = [...CATALOG, chart];
    let layout = hl.addWidget([], chart, { instance: "one", config: { groupIds: ["g1"] } });
    layout = hl.addWidget(layout, chart, { instance: "two" });
    assert.deepEqual(layout.map((i) => i.id), ["chart:one", "chart:two"]);
    assert.equal(hl.widgetType("chart:two"), "chart");
    layout = hl.setConfig(layout, "chart:two", { categoryIds: ["food"] });
    assert.deepEqual(layout[1].config, { categoryIds: ["food"] });
    const saved = [...layout, { id: "chart", size: "m" }, { id: "a:x", size: "s" }, { id: "chart:one", size: "m" }];
    assert.deepEqual(hl.resolveLayout(saved, catalog).map((i) => i.id), ["chart:one", "chart:two"],
      "a bare multi id, a stray instance of a single widget and a repeat are all dropped");
  });

  test("size, remove and add never change the original", () => {
    const layout = [{ id: "a", size: "l" }];
    const resized = hl.setSize(layout, "a", "s");
    assert.equal(layout[0].size, "l");
    assert.equal(resized[0].size, "s");
    assert.deepEqual(hl.removeWidget(layout, "a"), []);
    assert.deepEqual(hl.addWidget(layout, CATALOG[2]), [{ id: "a", size: "l" }, { id: "c", size: "m", config: {} }]);
    assert.equal(hl.addWidget(layout, CATALOG[0]), layout, "already showing: unchanged");
  });
});
