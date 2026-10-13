import { describe, test } from "node:test";
import assert from "node:assert/strict";

import * as ba from "../js/tools/budget_actual.js";

const tx = (date, amount, category_id, extra = {}) => ({
  id: `${date}-${category_id}-${amount}`, date, amount, category_id, deleted: false,
  subtransactions: [], ...extra,
});

describe("budget vs actual", () => {
  test("months before the current one, oldest first, across a year", () => {
    assert.deepEqual(ba.fullMonthsBefore("2026-02", 3), ["2025-11", "2025-12", "2026-01"]);
  });

  test("spending by month counts split legs and nets refunds", () => {
    const spending = ba.spendingByMonth([
      tx("2026-08-02", -50000, "food"),
      tx("2026-08-09", 5000, "food"),
      tx("2026-08-10", -30000, null, {
        subtransactions: [
          { category_id: "food", amount: -20000, deleted: false },
          { category_id: "fun", amount: -10000, deleted: false },
        ],
      }),
      tx("2026-08-11", -99000, null, { transfer_account_id: "acct" }),
      tx("2026-08-12", -1000, "food", { deleted: true }),
    ]);
    assert.equal(spending.get("food").get("2026-08"), 65000);
    assert.equal(spending.get("fun").get("2026-08"), 10000);
    assert.equal(spending.has(null), false, "an uncategorized transfer is not spending");
  });

  const months = ["2026-07", "2026-08", "2026-09"];
  const cat = (id, budgeted, extra = {}) => ({ id, name: id, groupName: "G", budgeted, ...extra });
  const history = months.map((month) => ({
    month,
    categories: [cat("food", 400000), cat("fun", 300000), cat("trip", 200000, { goal_type: "TBD" }),
      cat("phone", 50000), cat("idle", 0)],
  }));
  const spending = new Map([
    ["food", new Map([["2026-07", 520000], ["2026-08", 480000], ["2026-09", 390000]])],
    ["fun", new Map([["2026-07", 100000], ["2026-08", 120000], ["2026-09", 80000]])],
    ["trip", new Map()],
    ["phone", new Map([["2026-07", 50000], ["2026-08", 50000], ["2026-09", 50000]])],
  ]);

  test("verdicts: usually over, usually more than needed, saving up, on track", () => {
    const rows = ba.budgetVsActual(history, spending);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId.food.status, "under");
    assert.equal(byId.food.overMonths, 2);
    assert.equal(byId.food.suggested, 465000, "average spent, rounded up to $5");
    assert.equal(byId.fun.status, "over");
    assert.equal(byId.fun.suggested, 100000);
    assert.equal(byId.trip.status, "saving", "a target balance is saving on purpose");
    assert.equal(byId.phone.status, "ok");
    assert.equal(byId.idle, undefined, "nothing assigned or spent is left out");
    assert.deepEqual(rows.map((r) => r.status), ["under", "over", "saving", "ok"]);
  });

  test("a yearly need is saving up, not more than needed", () => {
    assert.equal(ba.isSavingUp({ goal_type: "NEED", goal_cadence: 13 }), true);
    assert.equal(ba.isSavingUp({ goal_type: "NEED", goal_cadence: 1, goal_cadence_frequency: 2 }), true);
    assert.equal(ba.isSavingUp({ goal_type: "NEED", goal_cadence: 1, goal_cadence_frequency: 1 }), false);
  });

  test("pace compares against what past months had spent by the same day", () => {
    const transactions = [
      // Rent always lands on the 1st: on the 10th it is no surprise.
      tx("2026-07-01", -1500000, "rent"), tx("2026-08-01", -1500000, "rent"),
      tx("2026-10-01", -1500000, "rent"),
      // Dining usually spreads out over the month; this month it is front-loaded.
      tx("2026-07-05", -50000, "dining"), tx("2026-07-25", -150000, "dining"),
      tx("2026-08-05", -50000, "dining"), tx("2026-08-25", -150000, "dining"),
      tx("2026-10-03", -120000, "dining"), tx("2026-10-08", -60000, "dining"),
    ];
    const rows = ba.pace({
      categories: [
        { id: "rent", name: "Rent", balance: 0, activity: -1500000 },
        { id: "dining", name: "Dining", balance: 70000, activity: -180000 },
      ],
      transactions,
      currentMonth: "2026-10",
      day: 10,
      lookback: ["2026-07", "2026-08"],
    });
    assert.deepEqual(rows.map((r) => r.id), ["dining"]);
    const dining = rows[0];
    assert.equal(dining.typicalByNow, 50000);
    assert.equal(dining.projected, 180000 + 150000);
    assert.equal(dining.available, 250000);
    assert.equal(dining.willRunOut, true);
    assert.equal(dining.shortBy, 80000);
    assert.equal(dining.ahead, true);
  });
});
