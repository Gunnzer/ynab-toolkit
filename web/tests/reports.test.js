import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as reports from "../js/tools/reports.js";

const PEOPLE = {
  person1Name: "Alex", person2Name: "Sam",
  person1AccountTag: "", person2AccountTag: "",
};

const groupOf = (id) => ({
  c1: "Household", c2: "Alex Wants", c3: "Sam Wants",
}[id] || "");
const nameOf = (id) => ({
  c1: "Groceries", c2: "Hobbies", c3: "Books",
}[id] || "");

const tx = (date, payee, amount, category, extra = {}) => ({
  date, payee_name: payee, amount, category_id: category,
  account_name: "Joint", ...extra,
});

describe("flattening", () => {
  test("a split counts its parts, not itself", () => {
    const entries = reports.toEntries([
      tx("2026-01-05", "Furniture Co", -100000, null, {
        subtransactions: [
          { category_id: "c2", amount: -60000 },
          { category_id: "c3", amount: -40000 },
        ],
      }),
    ], groupOf, PEOPLE);

    assert.equal(entries.length, 2, "the parent must not be counted as well");
    assert.equal(entries.reduce((sum, e) => sum + e.amount, 0), -100000);
    assert.deepEqual(entries.map((e) => e.owner), ["p1", "p2"]);
  });

  test("transfers and deletions are dropped", () => {
    const entries = reports.toEntries([
      tx("2026-01-05", "Transfer : Savings", -5000, null, { transfer_account_id: "a" }),
      tx("2026-01-06", "Gone", -5000, "c1", { deleted: true }),
      tx("2026-01-07", "Shop", -5000, "c1"),
    ], groupOf, PEOPLE);
    assert.equal(entries.length, 1);
  });
});

describe("summarising", () => {
  const entries = reports.toEntries([
    tx("2026-01-05", "Corner Store", -20000, "c1"),
    tx("2026-01-20", "Corner Store", -10000, "c1"),
    tx("2026-02-03", "Hobby Shop", -50000, "c2"),
    tx("2026-02-14", "Corner Store", -5000, "c1"),
    tx("2026-02-20", "Refund Co", 8000, "c1"),
  ], groupOf, PEOPLE);

  test("months, totals and the average of spending months", () => {
    const result = reports.summarise(entries, {}, { categoryNameFor: nameOf });
    assert.equal(result.total, 85000);
    assert.equal(result.count, 4, "the inflow is not spending");
    assert.deepEqual(result.monthly.map((m) => m.month), ["2026-01", "2026-02"]);
    assert.equal(result.monthly[0].total, 30000);
    assert.equal(result.average, 42500);
    assert.equal(result.busiest.month, "2026-02");
  });

  test("filtering by person uses the category group", () => {
    const result = reports.summarise(entries, { owner: "p1" });
    assert.equal(result.total, 50000);
    assert.equal(result.count, 1);
  });

  test("shared is everything naming neither person", () => {
    assert.equal(reports.summarise(entries, { owner: "shared" }).total, 35000);
  });

  test("dates, payee text and groups all narrow it", () => {
    assert.equal(reports.summarise(entries, { since: "2026-02-01" }).total, 55000);
    assert.equal(reports.summarise(entries, { until: "2026-01-31" }).total, 30000);
    assert.equal(reports.summarise(entries, { payeeContains: "corner" }).total, 35000);
    assert.equal(reports.summarise(entries, { groupNames: ["Alex Wants"] }).total, 50000);
  });

  test("individual categories can be excluded", () => {
    // Groceries is c1: two spends totalling 35000 of the 85000.
    const result = reports.summarise(entries, { excludeCategoryIds: ["c1"] });
    assert.equal(result.total, 50000);
    assert.equal(result.count, 1);
  });

  test("excluding a category inside an included group still applies", () => {
    const result = reports.summarise(entries, {
      groupNames: ["Household"], excludeCategoryIds: ["c1"],
    });
    assert.equal(result.total, 0);
  });

  test("an empty exclusion list excludes nothing", () => {
    assert.equal(reports.summarise(entries, { excludeCategoryIds: [] }).total, 85000);
  });

  test("income can be included when asked for", () => {
    const result = reports.summarise(entries, { includeInflow: true });
    assert.equal(result.total, 77000, "the refund nets off");
    assert.equal(result.count, 5);
  });

  test("rankings come back biggest first", () => {
    const result = reports.summarise(entries, {}, { categoryNameFor: nameOf });
    assert.equal(result.payees[0].name, "Hobby Shop");
    assert.equal(result.payees[0].total, 50000);
    assert.equal(result.groups[0].name, "Alex Wants");
    assert.equal(result.categories[0].name, "Hobbies");
  });

  test("no matches is empty, not a crash", () => {
    const result = reports.summarise(entries, { payeeContains: "nothing" });
    assert.equal(result.total, 0);
    assert.equal(result.average, 0);
    assert.equal(result.busiest, null);
    assert.deepEqual(result.monthly, []);
  });
});
