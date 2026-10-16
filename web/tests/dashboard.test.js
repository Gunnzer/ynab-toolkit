import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildAlerts } from "../js/tools/dashboard.js";

describe("dashboard alerts", () => {
  test("nothing to say when everything is fine", () => {
    assert.deepEqual(buildAlerts({ readyToAssign: 1000, review: { uncategorized: 0, unapproved: 0 } }), []);
  });

  test("most urgent first, each pointing at the page that fixes it", () => {
    const alerts = buildAlerts({
      readyToAssign: -50000,
      overspent: [{ name: "Dining", balance: -12000 }, { name: "Gas", balance: -3000 }],
      pace: [{ name: "Groceries", shortBy: 80000, willRunOut: true }, { name: "Fun", ahead: true }],
      review: { uncategorized: 2, unapproved: 5, suggested: 4 },
      duplicateGroups: 1,
      recurring: { priceUp: [{ payee: "Netflix", priceUp: { from: 16490, to: 18990 } }], fresh: [] },
      forecast: {
        accounts: [{ name: "Chequing", firstNegative: "2026-10-20", low: -210000, lowDate: "2026-10-21" }],
        dueSoon: { count: 2, total: -1600000, items: [{ payee: "Rent" }, { payee: "Hydro" }] },
      },
      settle: [{ key: "2026-09-01", label: "September 2026", status: "unpaid", who: "Sam pays Alex $30.00" }],
    });
    assert.deepEqual(alerts.map((a) => [a.level, a.key, a.go]), [
      ["error", "rta", "budget"],
      ["error", "overspent", "budget"],
      ["error", "cash", "upcoming"],
      ["warn", "pace", "reports"],
      ["warn", "settle-2026-09-01", "splitsheet"],
      ["warn", "review", "categorize"],
      ["warn", "duplicates", "duplicates"],
      ["info", "price", "reports"],
      ["info", "bills", "upcoming"],
    ]);
    assert.equal(alerts[1].title, "2 categories overspent by $15.00");
    assert.equal(alerts[3].tab, "budget");
    assert.equal(alerts[3].title, "1 category is on pace to run out this month");
    assert.equal(alerts[5].title, "2 with no category, 5 to approve");
    assert.match(alerts[7].detail, /Netflix \$16\.49 to \$18\.99/);
  });

  test("only approvals waiting is a gentle note", () => {
    const [review] = buildAlerts({ review: { uncategorized: 0, unapproved: 3, suggested: 0 } });
    assert.equal(review.level, "info");
    assert.equal(review.title, "3 to approve");
  });
});
