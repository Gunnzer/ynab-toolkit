import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { categoryTrends } from "../js/tools/trends.js";

describe("category trends", () => {
  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const series = (values) => new Map(values.map((v, i) => [months[i], v]));
  const spending = new Map([
    ["dining", series([100000, 100000, 100000, 160000, 160000, 160000])],
    ["food", series([400000, 410000, 390000, 400000, 405000, 395000])],
    ["gym", series([50000, 50000, 50000, 0, 0, 0])],
  ]);
  spending.get("dining").set("2026-10", 40000);
  const categories = [
    { id: "dining", name: "Dining" }, { id: "food", name: "Groceries" },
    { id: "gym", name: "Gym" }, { id: "never", name: "Never used" },
  ];

  test("recent three months against the months before them", () => {
    const rows = categoryTrends({ spending, months, categories, currentMonth: "2026-10" });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId.dining.recentAvg, 160000);
    assert.equal(byId.dining.usualAvg, 100000);
    assert.equal(byId.dining.change, 60000);
    assert.equal(Math.round(byId.dining.changePct * 100), 60);
    assert.equal(byId.dining.mover, true);
    assert.equal(byId.dining.thisMonth, 40000);
    assert.equal(byId.food.mover, false, "a few dollars of wobble is not a trend");
    assert.equal(byId.gym.change, -50000);
    assert.equal(byId.gym.mover, true);
    assert.equal(byId.never, undefined);
  });

  test("biggest change first", () => {
    const rows = categoryTrends({ spending, months, categories, currentMonth: "2026-10" });
    assert.deepEqual(rows.map((r) => r.id), ["dining", "gym", "food"]);
  });
});
