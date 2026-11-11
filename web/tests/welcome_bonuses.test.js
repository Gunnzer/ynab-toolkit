import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { setCatalogue } from "../js/tools/card_catalogue.js";
import { validateCatalogue } from "../js/tools/card_rewards.js";
import {
  CHEXY_FEE, ENDING_SOON_DAYS, addMonths, bonusValue, daysBetween, filterOffers, firstYearFee, offerDeadline, progress, rankOffers, spentOnAccount,
} from "../js/tools/welcome_bonuses.js";

const SHIPPED = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
setCatalogue(SHIPPED);

const offer = (fields) => ({
  points: 10000, minSpend: 3000, months: 3, detail: "10,000 points.", source: "Milesopedia",
  checked: SHIPPED.checked, ...fields,
});
const card = (id, points, welcome, annualFee = 120) =>
  ({ id, name: id, points, annualFee, welcome: welcome && offer(welcome) });

describe("welcome offers", () => {
  test("worth the points at the cautious value plus any cash, less the first year's fee", () => {
    const aeroplan = card("a", "aeroplan", { points: 20000 });
    assert.equal(bonusValue(aeroplan), 220);
    assert.equal(bonusValue(aeroplan, { aeroplan: 2 }), 400);
    assert.equal(bonusValue(card("c", "cash", { points: 0, cash: 150 })), 150);
    assert.equal(firstYearFee(aeroplan), 120);
    assert.equal(firstYearFee(card("w", "aeroplan", { firstYearFee: 0 })), 0);
  });

  test("ranked by first-year value, ended offers left out, yours marked", () => {
    const list = rankOffers([
      card("big", "aeroplan", { points: 30000 }),
      card("waived", "aeroplan", { points: 20000, firstYearFee: 0 }),
      card("over", "aeroplan", { points: 90000, ends: "2026-11-01" }),
      card("none", "aeroplan", null),
    ], { held: ["waived"], today: "2026-11-05" });
    assert.deepEqual(list.map((o) => [o.card.id, o.net, o.held]), [["waived", 220, true], ["big", 210, false]]);
  });

  test("the data file's offers are checked", () => {
    const withOffer = (welcome) => ({ ...SHIPPED, cards: SHIPPED.cards.map((c, i) => (i === 0 ? { ...c, welcome } : c)) });
    assert.deepEqual(validateCatalogue(withOffer(offer({}))), []);
    for (const [bad, pattern] of [
      [offer({ points: 0 }), /points or cash above 0/],
      [offer({ months: 0 }), /1 to 24 months/],
      [offer({ minSpend: "lots" }), /1 to 24 months/],
      [offer({ firstYearFee: -1 }), /first-year fee/],
      [offer({ ends: "soon" }), /end is not a date/],
      [offer({ source: "" }), /needs a detail, a source/],
      [offer({ checked: "2099-01-01" }), /no later than the catalogue/],
    ]) {
      assert.ok(validateCatalogue(withOffer(bad)).some((p) => pattern.test(p)), String(pattern));
    }
  });
});

describe("a bonus being worked towards", () => {
  test("months are calendar months, pulled back to a short month's end", () => {
    assert.equal(addMonths("2026-11-05", 3), "2027-02-05");
    assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
    assert.equal(addMonths("2027-11-30", 3), "2028-02-29");
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(daysBetween("2026-11-05", "2027-02-05"), 92);
  });

  test("on track, behind, done, missed", () => {
    const t = { opened: "2026-11-05", minSpend: 3000, months: 3 };
    const start = progress({ ...t, spent: 0 }, "2026-11-05");
    assert.equal(start.status, "on-track");
    assert.equal(start.deadline, "2027-02-05");
    assert.equal(start.daysLeft, 92);
    assert.equal(start.left, 3000);
    assert.equal(start.chexyFee, 52.5);
    assert.equal(CHEXY_FEE, 0.0175);
    // Half way through the time with a third spent is behind an even pace.
    assert.equal(progress({ ...t, spent: 1000 }, "2026-12-21").status, "behind");
    assert.equal(progress({ ...t, spent: 2000 }, "2026-12-21").status, "on-track");
    const done = progress({ ...t, spent: 3200 }, "2026-12-21");
    assert.deepEqual([done.status, done.left, done.pct, done.perDay], ["done", 0, 1, 0]);
    assert.equal(progress({ ...t, spent: 2000 }, "2027-02-06").status, "missed");
    // The last day still counts, and the daily amount includes today.
    const last = progress({ ...t, spent: 2900 }, "2027-02-05");
    assert.deepEqual([last.status, last.daysLeft, last.perDay], ["behind", 0, 100]);
  });

  test("YNAB spending on the card: purchases less refunds, payments left out", () => {
    const tx = [
      { account_id: "c", date: "2026-11-06", amount: -120500 },
      { account_id: "c", date: "2026-11-07", amount: 20500 },
      { account_id: "c", date: "2026-11-08", amount: 500000, transfer_account_id: "chq" },
      { account_id: "c", date: "2026-11-01", amount: -999000 },
      { account_id: "c", date: "2027-03-01", amount: -50000 },
      { account_id: "c", date: "2026-11-09", amount: -40000, deleted: true },
      { account_id: "other", date: "2026-11-09", amount: -70000 },
    ];
    assert.equal(spentOnAccount(tx, "c", "2026-11-05", "2027-02-05"), 100);
    assert.equal(spentOnAccount([{ account_id: "c", date: "2026-11-06", amount: 5000 }], "c", "2026-11-05"), 0);
  });
});

describe("narrowing the offers", () => {
  const cards = [
    { id: "a", name: "a", points: "aeroplan", network: "visa", issuer: "TD", annualFee: 139, welcome: offer({ firstYearFee: 0 }) },
    { id: "b", name: "b", points: "mr", network: "amex", issuer: "American Express", annualFee: 799, welcome: offer({}) },
    { id: "c", name: "c", points: "cash", network: "mastercard", issuer: "Rogers Bank", annualFee: 0, welcome: offer({ points: 0, cash: 50 }) },
  ];
  const ids = (filters) => filterOffers(rankOffers(cards), filters).map((o) => o.card.id).sort();
  test("by point type, network, issuer and fee", () => {
    assert.deepEqual(ids({}), ["a", "b", "c"]);
    assert.deepEqual(ids({ points: "aeroplan" }), ["a"]);
    assert.deepEqual(ids({ network: "amex" }), ["b"]);
    assert.deepEqual(ids({ issuer: "Rogers Bank" }), ["c"]);
    assert.deepEqual(ids({ fee: "none" }), ["c"]);
    assert.deepEqual(ids({ fee: "first-free" }), ["a", "c"]);
    assert.deepEqual(ids({ fee: "under-200" }), ["a", "c"]);
    assert.deepEqual(ids({ fee: "premium" }), ["b"]);
    assert.deepEqual(ids({ points: "aeroplan", network: "amex" }), []);
  });
});

describe("offer deadlines", () => {
  test("the last day to apply, days left, ending soon, and the spend window", () => {
    const c = (ends) => ({ welcome: offer({ ends, minSpend: 5000, months: 6 }) });
    const d = offerDeadline(c("2026-11-25"), "2026-11-11");
    assert.deepEqual([d.ends, d.daysLeft, d.soon, d.minSpend, d.months], ["2026-11-25", 14, true, 5000, 6]);
    assert.equal(offerDeadline(c("2026-12-31"), "2026-11-11").soon, false);
    assert.equal(offerDeadline(c("2026-11-11"), "2026-11-11").daysLeft, 0);
    const none = offerDeadline(c(undefined), "2026-11-11");
    assert.deepEqual([none.ends, none.daysLeft, none.soon], ["", null, false]);
    assert.equal(ENDING_SOON_DAYS, 14);
  });
});
