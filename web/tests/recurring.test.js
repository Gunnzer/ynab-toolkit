import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { findRecurring, normalizePayee, recurringTotals } from "../js/tools/recurring.js";

let next = 0;
const charge = (date, amount, payee, extra = {}) => ({
  id: `t${next++}`, date, amount: -amount, payee_name: payee, category_id: "subs",
  deleted: false, subtransactions: [], ...extra,
});
const monthly = (payee, amounts, startMonth = 1, day = 5, year = 2026) =>
  amounts.map((amount, i) => charge(
    `${year}-${String(startMonth + i).padStart(2, "0")}-${String(day).padStart(2, "0")}`, amount, payee));

describe("recurring charges", () => {
  test("payee names lose order numbers and processor suffixes", () => {
    assert.equal(normalizePayee("SPOTIFY*P2A1B3C"), "spotify");
    assert.equal(normalizePayee("Netflix.com #12345"), "netflix com");
  });

  test("a steady monthly subscription, with its yearly cost and next date", () => {
    const found = findRecurring(monthly("Spotify", [1199, 1199, 1199, 1199, 1199, 1199, 1199, 1199, 1199]),
      { today: "2026-10-01" });
    assert.equal(found.length, 1);
    const [spotify] = found;
    assert.equal(spotify.cadence, "monthly");
    assert.equal(spotify.payee, "Spotify");
    assert.equal(spotify.yearly, 1199 * 12);
    assert.equal(spotify.lastDate, "2026-09-05");
    assert.equal(spotify.priceUp, null);
    assert.equal(spotify.stopped, false);
    assert.equal(spotify.isNew, false);
  });

  test("a price increase is called out", () => {
    // Amounts are milliunits: $16.49 going up to $18.99.
    const [netflix] = findRecurring(monthly("Netflix", [16490, 16490, 16490, 16490, 18990]),
      { today: "2026-05-20" });
    assert.deepEqual(netflix.priceUp, { from: 16490, to: 18990 });
  });

  test("a price increase already charged twice is still a price increase", () => {
    const [netflix] = findRecurring(monthly("Netflix", [16490, 16490, 16490, 16490, 18990, 18990]),
      { today: "2026-06-20" });
    assert.equal(netflix.varies, false);
    assert.deepEqual(netflix.priceUp, { from: 16490, to: 18990 });
    assert.equal(netflix.yearly, 18990 * 12);
  });

  test("a rise long ago is just the price now", () => {
    const [netflix] = findRecurring(monthly("Netflix", [16490, 16490, 18990, 18990, 18990, 18990, 18990]),
      { today: "2026-07-20" });
    assert.equal(netflix.priceUp, null);
  });

  test("a bill that varies is still found, marked as varying", () => {
    const [hydro] = findRecurring(monthly("Hydro One", [90000, 120000, 105000, 95000, 130000]),
      { today: "2026-05-20" });
    assert.equal(hydro.varies, true);
    assert.equal(hydro.priceUp, null);
  });

  test("two subscriptions from the same company stay separate", () => {
    const transactions = [
      ...monthly("Apple", [299, 299, 299, 299]),
      ...monthly("Apple", [1299, 1299, 1299, 1299], 1, 9),
    ];
    const found = findRecurring(transactions, { today: "2026-05-01" });
    assert.deepEqual(found.map((r) => r.latest).sort((a, b) => a - b), [299, 1299]);
  });

  test("a weekly shop that varies is a habit, not a recurring charge", () => {
    const weekly = [];
    for (let i = 0; i < 10; i += 1) {
      const d = new Date(Date.UTC(2026, 0, 3 + i * 7)).toISOString().slice(0, 10);
      weekly.push(charge(d, 80000 + (i % 3) * 25000, "Costco"));
    }
    assert.deepEqual(findRecurring(weekly, { today: "2026-03-20" }), []);
  });

  test("one that stopped, and one that is new", () => {
    const found = findRecurring([
      ...monthly("Old Gym", [4000, 4000, 4000, 4000]),
      ...monthly("New App", [999, 999, 999], 7),
    ], { today: "2026-10-01" });
    const byPayee = Object.fromEntries(found.map((r) => [r.payee, r]));
    assert.equal(byPayee["Old Gym"].stopped, true);
    assert.equal(byPayee["New App"].isNew, true);
    assert.equal(byPayee["New App"].stopped, false);
    assert.equal(recurringTotals(found).yearly, 999 * 12, "stopped ones are not counted");
  });

  test("a yearly charge needs only two sightings", () => {
    const found = findRecurring([
      charge("2025-03-15", 12000, "Domain Renewal"), charge("2026-03-15", 12000, "Domain Renewal"),
    ], { today: "2026-06-01" });
    assert.equal(found[0].cadence, "yearly");
    assert.equal(found[0].nextDate, "2027-03-15");
  });

  test("irregular spending at one shop is not recurring, and transfers are ignored", () => {
    const found = findRecurring([
      charge("2026-01-03", 5000, "Corner Store"), charge("2026-01-20", 7000, "Corner Store"),
      charge("2026-03-01", 6000, "Corner Store"), charge("2026-03-05", 5500, "Corner Store"),
      ...monthly("Payment to Visa", [50000, 50000, 50000, 50000])
        .map((t) => ({ ...t, category_id: null, transfer_account_id: "visa" })),
      ...monthly("Transfer : Brokerage", [500000, 500000, 500000, 500000])
        .map((t) => ({ ...t, category_id: "invest", transfer_account_id: "brokerage" })),
    ], { today: "2026-05-01" });
    assert.deepEqual(found, []);
  });
});
