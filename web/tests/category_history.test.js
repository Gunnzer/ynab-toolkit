import { describe, test } from "node:test";
import assert from "node:assert/strict";

import * as history from "../js/tools/category_history.js";

const tx = (id, date, amount, extra = {}) => ({
  id, date, amount, category_id: "food", payee_name: "Grocer", memo: "",
  account_id: "a1", account_name: "Chequing", deleted: false, subtransactions: [], ...extra,
});

describe("category history", () => {
  const transactions = [
    tx("t1", "2026-08-03", -40000),
    tx("t2", "2026-08-20", -60000, { payee_name: "Market", memo: "party" }),
    tx("t3", "2026-09-02", 5000, { payee_name: "Grocer refund" }),
    tx("t4", "2026-09-10", -30000, { category_id: "rent" }),
    tx("t5", "2026-10-01", -90000, {
      category_id: null, payee_name: "Big Store",
      subtransactions: [
        { id: "s1", category_id: "food", amount: -70000, memo: "groceries", deleted: false },
        { id: "s2", category_id: "fun", amount: -20000, deleted: false },
        { id: "s3", category_id: "food", amount: -1000, deleted: true },
      ],
    }),
    tx("t6", "2026-10-05", -10000, { deleted: true }),
  ];

  test("only this category's transactions and split legs, newest first", () => {
    const entries = history.categoryEntries(transactions, "food");
    assert.deepEqual(entries.map((e) => [e.date, e.amount, e.splitLeg]), [
      ["2026-10-01", -70000, true],
      ["2026-09-02", 5000, false],
      ["2026-08-20", -60000, false],
      ["2026-08-03", -40000, false],
    ]);
    assert.equal(entries[0].memo, "groceries");
    assert.equal(entries[0].payee, "Big Store");
  });

  test("grouped by month with spending and inflow kept apart", () => {
    const groups = history.groupByMonth(history.categoryEntries(transactions, "food"));
    assert.deepEqual(groups.map((g) => [g.month, g.entries.length, g.net, g.spent, g.inflow]), [
      ["2026-10", 1, -70000, 70000, 0],
      ["2026-09", 1, 5000, 0, 5000],
      ["2026-08", 2, -100000, 100000, 0],
    ]);
  });

  test("search matches payee or memo", () => {
    const entries = history.categoryEntries(transactions, "food");
    assert.deepEqual(entries.filter((e) => history.matchesQuery(e, "PARTY")).map((e) => e.id), ["t2"]);
    // The split leg's memo ("groceries") matches too, not just payees.
    assert.deepEqual(entries.filter((e) => history.matchesQuery(e, "grocer")).map((e) => e.id),
      ["t5", "t3", "t1"]);
    assert.equal(entries.filter((e) => history.matchesQuery(e, "  ")).length, 4);
  });

  test("the average spreads the last 12 full months, quiet months included", () => {
    const groups = history.groupByMonth(history.categoryEntries(transactions, "food"));
    const summary = history.summarise(groups, "2026-10");
    // August and September are inside the 12 months before October;
    // October itself is not.
    assert.equal(summary.average, Math.round((-100000 + 5000) / 12));
    assert.equal(summary.thisMonth, -70000);
    assert.equal(summary.biggest.month, "2026-08");
    assert.equal(summary.count, 4);
    assert.equal(summary.largestSpend, 100000);
  });

  test("nothing in the category at all", () => {
    const groups = history.groupByMonth(history.categoryEntries(transactions, "none"));
    assert.deepEqual(groups, []);
    const summary = history.summarise(groups, "2026-10");
    assert.equal(summary.biggest, null);
    assert.equal(summary.average, 0);
  });
});
