import { describe, test } from "node:test";
import assert from "node:assert/strict";

import * as rta from "../js/tools/rta_tracker.js";

describe("rta tracker", () => {
  test("currentMonthString pads a single-digit month", () => {
    assert.equal(rta.currentMonthString(new Date(2026, 2, 15)), "2026-03");
    assert.equal(rta.currentMonthString(new Date(2026, 10, 1)), "2026-11");
  });

  test("monthStartIso", () => {
    assert.equal(rta.monthStartIso("2026-08"), "2026-08-01");
  });

  test("findFlaggedTransactions: backdated, no category, not a split, not a transfer", () => {
    const currentMonthStart = "2026-08-01";
    const transactions = [
      // Flagged: backdated, uncategorized, ordinary transaction.
      { id: "t1", date: "2026-07-28", category_id: null, amount: 250000 },
      // Not flagged: dated in the current month.
      { id: "t2", date: "2026-08-10", category_id: null, amount: 5000 },
      // Not flagged: has a real category.
      { id: "t3", date: "2026-07-01", category_id: "cat-1", amount: -4500 },
      // Not flagged: a split's parent record - category_id is null but the
      // category actually lives on each subtransaction (same trap
      // shared_expenses.js documents).
      {
        id: "t4", date: "2026-07-15", category_id: null, amount: 10000,
        subtransactions: [{ category_id: "cat-1", amount: 5000 }],
      },
      // Not flagged: a transfer, never touches Ready to Assign on its own.
      {
        id: "t5", date: "2026-07-20", category_id: null, amount: 20000,
        transfer_account_id: "acct-2",
      },
      // Not flagged: deleted.
      { id: "t6", date: "2026-07-01", category_id: null, amount: 1000, deleted: true },
    ];

    const flagged = rta.findFlaggedTransactions(transactions, currentMonthStart);
    assert.deepEqual(flagged.map((t) => t.id), ["t1"]);
  });

  test("sumAmount", () => {
    assert.equal(rta.sumAmount([{ amount: 100 }, { amount: -30 }, { amount: 5 }]), 75);
    assert.equal(rta.sumAmount([]), 0);
    assert.equal(rta.sumAmount(undefined), 0);
  });

  test("buildAttribution: fully explained", () => {
    const flagged = [
      { id: "t1", date: "2026-07-28", payee_name: "Employer Inc", amount: 250000 },
    ];
    const result = rta.buildAttribution(250000, flagged);
    assert.equal(result.explained, true);
    assert.match(result.summary, /Fully explained by 1 backdated/);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].payee, "Employer Inc");
  });

  test("buildAttribution: partially explained, says so rather than pretending", () => {
    const flagged = [{ id: "t1", date: "2026-07-28", payee_name: "Employer Inc", amount: 100000 }];
    const result = rta.buildAttribution(250000, flagged);
    assert.equal(result.explained, false);
    assert.match(result.summary, /does not fully account/);
  });

  test("buildAttribution: no flagged transactions but RTA moved", () => {
    const result = rta.buildAttribution(50000, []);
    assert.equal(result.explained, false);
    assert.match(result.summary, /no backdated or uncategorized/);
  });

  test("buildAttribution: no change at all", () => {
    const result = rta.buildAttribution(0, []);
    assert.match(result.summary, /did not change/);
  });

  test("buildAttribution: sorts by size of amount, largest first", () => {
    const flagged = [
      { id: "small", date: "2026-08-01", payee_name: "Small", amount: 1000 },
      { id: "big", date: "2026-08-02", payee_name: "Big", amount: -50000 },
    ];
    const result = rta.buildAttribution(-49000, flagged);
    assert.deepEqual(result.lines.map((l) => l.id), ["big", "small"]);
  });

  test("buildSnapshot: first snapshot has no delta or attribution", () => {
    const snapshot = rta.buildSnapshot({
      month: "2026-08", toBeBudgeted: 100000, previousSnapshot: null,
      deltaTransactions: [], serverKnowledge: 42,
    });
    assert.equal(snapshot.delta, null);
    assert.equal(snapshot.flagged.length, 0);
    assert.match(snapshot.summary, /First snapshot/);
    assert.equal(snapshot.serverKnowledge, 42);
  });

  test("buildSnapshot: computes delta against the previous snapshot and flags", () => {
    const previous = { toBeBudgeted: 100000 };
    const deltaTransactions = [
      { id: "t1", date: "2026-07-28", category_id: null, amount: 50000, payee_name: "Payroll" },
    ];
    const snapshot = rta.buildSnapshot({
      month: "2026-08", toBeBudgeted: 150000, previousSnapshot: previous,
      deltaTransactions, serverKnowledge: 99,
    });
    assert.equal(snapshot.delta, 50000);
    assert.equal(snapshot.flagged.length, 1);
    assert.equal(snapshot.flaggedSum, 50000);
    assert.match(snapshot.summary, /Fully explained/);
  });
});
