// Home's chart data: which categories a chart covers, the series it draws,
// daily forecast balances, and axis numbers.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as cd from "../js/tools/chart_data.js";

const GROUPS = [
  { id: "img", name: "Internal Master Category", categories: [{ id: "rta", name: "Inflow: Ready to Assign" }] },
  { id: "g1", name: "Household", categories: [{ id: "food", name: "Groceries" }, { id: "rent", name: "Rent" }] },
  { id: "g2", name: "Fun", categories: [{ id: "dining", name: "Dining" }, { id: "books", name: "Books" }, { id: "old", name: "Old", deleted: true }] },
];
const MONTHS = ["2026-08", "2026-09", "2026-10"];
const spending = new Map([
  ["food", new Map([["2026-08", 100], ["2026-09", 200], ["2026-10", 50]])],
  ["rent", new Map([["2026-08", 1000], ["2026-09", 1000], ["2026-10", 1000]])],
  ["dining", new Map([["2026-09", 30]])],
  ["books", new Map([["2026-10", 7]])],
]);

describe("chart data", () => {
  test("a chosen group covers its live categories, never deleted ones", () => {
    const ids = cd.selectedCategoryIds({ groupIds: ["g2"], categoryIds: ["food"] }, GROUPS);
    assert.deepEqual([...ids].sort(), ["books", "dining", "food"]);
  });

  test("the name reads the selection in budget order", () => {
    assert.equal(cd.selectionName({ groupIds: ["g2"], categoryIds: ["food"] }, GROUPS), "Groceries and Fun");
    assert.equal(cd.selectionName({ categoryIds: ["food", "rent", "dining", "books"] }, GROUPS), "Groceries, Rent and 2 more");
    assert.equal(cd.selectionName({}, GROUPS), "");
  });

  test("combined is one series summing everything chosen", () => {
    const series = cd.spendingSeries({ spending, selection: { categoryIds: ["food", "dining"] }, categoryGroups: GROUPS, months: MONTHS });
    assert.equal(series.length, 1);
    assert.deepEqual(series[0].values, [100, 230, 50]);
  });

  test("separate is one series per group or category, a group's own category not counted twice", () => {
    const series = cd.spendingSeries({
      spending, selection: { groupIds: ["g2"], categoryIds: ["dining", "food"] },
      categoryGroups: GROUPS, months: MONTHS, separate: true,
    });
    assert.deepEqual(series.map((s) => [s.name, s.values]), [["Groceries", [100, 200, 50]], ["Fun", [0, 30, 7]]]);
  });

  test("past the colour limit the smallest fold into Other, the rest keep budget order", () => {
    const series = cd.spendingSeries({
      spending, selection: { categoryIds: ["food", "rent", "dining", "books"] },
      categoryGroups: GROUPS, months: MONTHS, separate: true, maxSeries: 3,
    });
    assert.deepEqual(series.map((s) => s.name), ["Groceries", "Rent", "Other (2)"]);
    assert.deepEqual(series[2].values, [0, 30, 7]);
  });

  test("all means every budget group, never YNAB's internal one", () => {
    const series = cd.spendingSeries({ spending, selection: { all: true }, categoryGroups: GROUPS, months: MONTHS, separate: true });
    assert.deepEqual(series.map((s) => s.name), ["Household", "Fun"]);
    assert.equal(cd.selectionName({ all: true }, GROUPS), "All spending");
  });

  test("a separate series with nothing spent is left out", () => {
    const series = cd.spendingSeries({
      spending, selection: { categoryIds: ["food", "rent"], groupIds: [] }, categoryGroups: [
        ...GROUPS, { id: "g9", name: "Quiet", categories: [{ id: "none", name: "Never used" }] }],
      months: MONTHS, separate: true,
    });
    assert.deepEqual(series.map((s) => s.name), ["Groceries", "Rent"]);
    const quiet = cd.spendingSeries({ spending, selection: { categoryIds: ["none"] }, categoryGroups: [
      { id: "g9", name: "Quiet", categories: [{ id: "none", name: "Never used" }] }], months: MONTHS, separate: true });
    assert.equal(quiet.length, 1, "all quiet: still one (empty) series, not none");
  });

  test("daily balances step on each event's date", () => {
    const account = { start: 500, events: [{ date: "2026-10-17", balanceAfter: 300 }, { date: "2026-10-19", balanceAfter: 900 }] };
    assert.deepEqual(cd.dailyBalances(account, "2026-10-16", 4).map((d) => d.balance), [500, 300, 300, 900, 900]);
  });

  test("axis numbers", () => {
    assert.equal(cd.niceCeiling(1730), 2000);
    assert.equal(cd.niceCeiling(210), 250);
    assert.equal(cd.niceCeiling(0), 1);
    assert.deepEqual(cd.niceTicks(2400000), [0, 1000000, 2000000, 3000000]);
    assert.deepEqual(cd.niceTicks(170000), [0, 100000, 200000]);
    assert.deepEqual(cd.niceTicks(0), [0, 1000]);
    assert.equal(cd.compactMoney(1234000), "$1.2K");
    assert.equal(cd.compactMoney(850000), "$850");
    assert.equal(cd.compactMoney(-2500000000), "-$2.5M");
  });
});
