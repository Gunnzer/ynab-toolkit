import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { forecastAccounts, occurrences, upcomingEvents } from "../js/tools/forecast.js";

describe("forecast", () => {
  test("YNAB frequencies, including month ends", () => {
    assert.deepEqual(occurrences("2026-01-31", "monthly", "2026-04-30"),
      ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    assert.deepEqual(occurrences("2026-10-02", "everyOtherWeek", "2026-11-01"),
      ["2026-10-02", "2026-10-16", "2026-10-30"]);
    assert.deepEqual(occurrences("2026-10-01", "twiceAMonth", "2026-11-20"),
      ["2026-10-01", "2026-10-16", "2026-11-01", "2026-11-16"]);
    assert.deepEqual(occurrences("2026-10-20", "never", "2026-12-31"), ["2026-10-20"]);
    assert.deepEqual(occurrences("2026-12-01", "yearly", "2026-11-30"), []);
  });

  const scheduled = [
    { id: "s1", date_next: "2026-10-15", frequency: "monthly", amount: -1500000,
      account_id: "chq", payee_name: "Landlord", category_id: "rent", deleted: false },
    { id: "s2", date_next: "2026-10-20", frequency: "never", amount: -300000,
      account_id: "chq", transfer_account_id: "sav", payee_name: "Transfer : Savings", deleted: false },
  ];
  const recurringOut = [
    { payee: "Hydro One", typical: 110000, nextDate: "2026-10-21", intervalDays: 30,
      cadenceLabel: "Monthly", direction: "out", accountId: "chq", categoryId: "hydro", stopped: false },
    // Already scheduled in YNAB - must not be counted twice.
    { payee: "Landlord", typical: 1500000, nextDate: "2026-10-15", intervalDays: 30,
      cadenceLabel: "Monthly", direction: "out", accountId: "chq", stopped: false },
    { payee: "Old Gym", typical: 45000, nextDate: "2026-06-01", intervalDays: 30,
      cadenceLabel: "Monthly", direction: "out", accountId: "chq", stopped: true },
    { payee: "Spotify", typical: 11990, nextDate: "2026-10-10", intervalDays: 30,
      cadenceLabel: "Monthly", direction: "out", accountId: "visa", stopped: false },
  ];
  const recurringIn = [
    { payee: "Payroll", typical: 2000000, nextDate: "2026-10-23", intervalDays: 14,
      cadenceLabel: "Every 2 weeks", direction: "in", accountId: "chq", stopped: false },
  ];
  const events = upcomingEvents({ scheduled, recurringOut, recurringIn, today: "2026-10-12", days: 30 });

  test("scheduled first in trust, detected only where not already scheduled", () => {
    assert.deepEqual(events.map((e) => [e.date, e.payee, e.amount, e.source]), [
      ["2026-10-12", "Spotify", -11990, "expected"],
      ["2026-10-15", "Landlord", -1500000, "scheduled"],
      ["2026-10-20", "Transfer : Savings", -300000, "scheduled"],
      ["2026-10-21", "Hydro One", -110000, "expected"],
      ["2026-10-23", "Payroll", 2000000, "expected"],
      ["2026-11-06", "Payroll", 2000000, "expected"],
      // Spotify was due on the 10th, so it shows today and then a cycle on
      // from today; Hydro's next bill (Nov 20) is past the 30 days.
      ["2026-11-11", "Spotify", -11990, "expected"],
    ]);
    assert.equal(events.find((e) => e.payee === "Spotify").late, true, "past due shows as today");
    assert.equal(events.some((e) => e.payee === "Old Gym"), false, "stopped ones are left out");
  });

  test("an account run forward finds its low point and first day below zero", () => {
    const [chequing, savings] = forecastAccounts([
      { id: "chq", name: "Chequing", type: "checking", balance: 1700000, on_budget: true },
      { id: "sav", name: "Savings", type: "savings", balance: 5000000, on_budget: true },
      { id: "visa", name: "Visa", type: "creditCard", balance: -200000, on_budget: true },
      { id: "old", name: "Old", type: "checking", balance: 0, closed: true },
    ], events, { today: "2026-10-12" }).sort((a, b) => a.name.localeCompare(b.name));
    assert.equal(chequing.start, 1700000);
    assert.equal(chequing.low, -210000);
    assert.equal(chequing.lowDate, "2026-10-21");
    assert.equal(chequing.firstNegative, "2026-10-20");
    assert.equal(chequing.end, 1700000 - 1500000 - 300000 - 110000 + 4000000);
    assert.equal(savings.end, 5300000, "the transfer lands in savings");
  });
});
