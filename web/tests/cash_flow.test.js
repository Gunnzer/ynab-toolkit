import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { cashFlow, cashFlowTotals } from "../js/tools/cash_flow.js";

const tx = (date, amount, category_id, extra = {}) => ({
  id: `${date}-${amount}`, date, amount, category_id, deleted: false, subtransactions: [], ...extra,
});

describe("cash flow", () => {
  const transactions = [
    tx("2026-08-01", 5000000, "rta"),
    tx("2026-08-05", -1500000, "rent"),
    tx("2026-08-09", -400000, "food"),
    tx("2026-08-12", 50000, "food"),
    tx("2026-08-20", -500000, "invest", { transfer_account_id: "brokerage" }),
    tx("2026-08-21", -800000, null, { transfer_account_id: "visa" }),
    tx("2026-09-01", 2000000, "rta"),
    tx("2026-09-04", -2500000, null, {
      subtransactions: [
        { category_id: "rent", amount: -1500000, deleted: false },
        { category_id: "fun", amount: -1000000, deleted: false },
      ],
    }),
  ];
  const rows = cashFlow({ transactions, rtaIds: new Set(["rta"]), months: ["2026-08", "2026-09"] });

  test("income, spending, and investing kept apart", () => {
    const [aug, sep] = rows;
    assert.equal(aug.income, 5000000);
    assert.equal(aug.spending, 1850000, "refund nets off; card payment is not spending");
    assert.equal(aug.toTracking, 500000, "moved to a tracking account is saved, not spent");
    assert.equal(aug.leftOver, 3150000);
    assert.equal(Math.round(aug.rate * 100), 63);
    assert.equal(sep.spending, 2500000);
    assert.equal(sep.leftOver, -500000);
    assert.equal(Math.round(sep.rate * 100), -25);
  });

  test("totals and a month with no income", () => {
    const totals = cashFlowTotals(rows);
    assert.equal(totals.income, 7000000);
    assert.equal(totals.spending, 4350000);
    assert.equal(Math.round(totals.rate * 100), 38);
    const empty = cashFlow({ transactions: [], rtaIds: new Set(), months: ["2026-01"] });
    assert.equal(empty[0].rate, null);
  });
});
