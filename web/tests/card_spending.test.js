import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CARDS, setCatalogue } from "../js/tools/card_catalogue.js";
import { walletCards } from "../js/tools/card_rewards.js";
import {
  bestOfSet, bonusPlan, bonusProfile, capUsage, cardEarnings, cardsToAdd, categoryPurchase, purchaseOf, rentToClose,
  spendByPurchase, spendGroups, spendItems,
} from "../js/tools/card_spending.js";

setCatalogue(JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8")));

const tx = (date, payee, dollars, extra = {}) => ({
  id: `${date}-${payee}`, date, payee_name: payee, amount: -Math.round(dollars * 1000), account_id: "card", category_id: "", ...extra,
});

// A card with simple, made-up rules, so the sums are easy to check by hand.
// Answers are pinned (which grocer, in CAD), so no question's priors spread
// the value.
const G = { store: "grocer", currency: "cad" };
const C = { currency: "cad" };
const plain = {
  id: "test-card", name: "Test Card", network: "visa", points: "cash", base: 1, annualFee: 50,
  earn: [
    { on: ["groceries"], rate: 4, cap: { key: "four", spend: 1000, per: "month", label: "groceries" } },
    { on: ["dining"], rate: 2 },
  ],
};

describe("sorting spending into card categories", () => {
  test("a YNAB category name, most specific first", () => {
    assert.equal(categoryPurchase("Groceries"), "groceries");
    assert.equal(categoryPurchase("Natural Gas"), "bills", "a gas bill is not fuel");
    assert.equal(categoryPurchase("Gas & Car"), "gas");
    assert.equal(categoryPurchase("Food delivery"), "delivery");
    assert.equal(categoryPurchase("Eating out"), "dining");
    assert.equal(categoryPurchase("Rent"), "");
  });

  test("a known shop beats the payee's words, which beat the category", () => {
    const loblaws = purchaseOf({ payee: "LOBLAWS 1234 TORONTO ON", category: "Household" });
    assert.equal(loblaws.purchase, "groceries");
    assert.equal(loblaws.answers.store, "loblaw", "the shop settles which grocer it is");
    assert.equal(purchaseOf({ payee: "LUIGI PIZZERIA", category: "Groceries" }).purchase, "dining");
    assert.equal(purchaseOf({ payee: "ACME LTD", category: "Groceries" }).purchase, "groceries");
    assert.equal(purchaseOf({ payee: "ACME LTD", category: "Rent" }).purchase, "other");
    assert.equal(purchaseOf({ payee: "CHEXY", category: "Rent" }).purchase, "bills", "rent through Chexy is a bill payment");
  });

  test("past charges count as Canadian dollars, except travel and hotels", () => {
    const items = spendItems([
      tx("2026-01-02", "SOME BISTRO", 40, { category_id: "d" }),
      tx("2026-01-03", "AIR TRANSAT", 500, { category_id: "t" }),
    ], { categoryName: (id) => ({ d: "Dining", t: "Travel" })[id] || "" });
    assert.equal(items[0].answers.currency, "cad");
    assert.equal(items[1].answers.currency, undefined);
  });

  test("the card's own fees, interest and reward payouts are not spending", () => {
    const items = spendItems([
      tx("2026-01-02", "ANNUAL FEE", 120),
      tx("2026-01-03", "PURCHASE INTEREST", 14),
      tx("2026-11-01", "CASH BACK REWARD", -950),
      tx("2026-11-02", "Scotia", -950, { memo: "Cash back redemption" }),
      tx("2026-11-03", "CHEXY", 2000),
    ]);
    assert.deepEqual(items.map((i) => i.payee), ["CHEXY"]);
  });

  test("transfers and income are left out, split legs count on their own, refunds take away", () => {
    const items = spendItems([
      tx("2026-01-02", "PAYMENT THANK YOU", -500, { transfer_account_id: "chequing" }),
      tx("2026-01-03", "Employer", -2000, { category_id: "rta" }),
      tx("2026-01-04", "COSTCO", 150, {
        subtransactions: [
          { amount: -100000, category_id: "g", payee_name: "" },
          { amount: -50000, category_id: "h", payee_name: "" },
        ],
      }),
      tx("2026-01-05", "SOME BISTRO", 40, { category_id: "d" }),
      tx("2026-01-06", "SOME BISTRO", -10, { category_id: "d" }),
      tx("2026-01-07", "OLD", 5, { deleted: true }),
    ], { categoryName: (id) => ({ g: "Groceries", h: "Household", d: "Dining" })[id] || "", exclude: new Set(["rta"]) });
    assert.equal(items.length, 4);
    assert.deepEqual(spendByPurchase(items), [
      { purchase: "groceries", amount: 150 },
      { purchase: "dining", amount: 30 },
    ], "Costco is listed as a grocer, so both legs are groceries");
  });
});

describe("what a card earned", () => {
  test("a monthly cap counts in its own month, and the fee comes off", () => {
    const items = [
      { date: "2026-03-01", amount: 800, purchase: "groceries", answers: G },
      { date: "2026-03-15", amount: 400, purchase: "groceries", answers: G },
      { date: "2026-04-01", amount: 400, purchase: "groceries", answers: G },
      { date: "2026-04-02", amount: 100, purchase: "dining", answers: C },
    ];
    const result = cardEarnings(plain, items);
    // March: 1,000 at 4% + 200 at 1%; April: 400 at 4% + 100 at 2%.
    assert.equal(result.earned, 40 + 2 + 16 + 2);
    assert.equal(result.spend, 1700);
    assert.equal(result.net, 60 - 50);
    assert.deepEqual(result.capsHit, ["groceries"]);
    assert.equal(cardEarnings(plain, [...items, { date: "2026-04-03", amount: -100, purchase: "dining", answers: C }]).refunds, 100);
    assert.equal(result.byPurchase[0].purchase, "groceries");
    const named = cardEarnings(plain, [
      { date: "2026-05-01", amount: 300, purchase: "other", answers: C, payee: "AMAZON.CA*AB12CD" },
      { date: "2026-05-02", amount: 200, purchase: "other", answers: C, payee: "Amazon.ca*ZZ99" },
      { date: "2026-05-03", amount: 100, purchase: "other", answers: C, payee: "BEST BUY #123" },
    ]);
    assert.deepEqual(named.byPurchase[0].topPayees, [
      { payee: "AMAZON.CA", spend: 500 },
      { payee: "BEST BUY", spend: 100 },
    ], "one shop's charges are grouped, store numbers dropped");
  });

  test("a card used somewhere it supposedly is not accepted still earns its base rate", () => {
    const [cobalt] = walletCards([{ id: "amex-cobalt" }]);
    const result = cardEarnings(cobalt, [{ date: "2026-05-01", amount: 100, purchase: "groceries", answers: { store: "loblaw" } }]);
    assert.ok(result.earned > 0);
  });

  test("how much of each cap is used this month, for Which card to use", () => {
    const items = [
      { date: "2026-11-02", amount: 700, purchase: "groceries", answers: G },
      { date: "2026-11-03", amount: 400, purchase: "groceries", answers: G },
      { date: "2026-10-30", amount: 900, purchase: "groceries", answers: G },
      { date: "2026-11-04", amount: 50, purchase: "dining", answers: C },
    ];
    const usage = capUsage(plain, items, "2026-11-16");
    assert.deepEqual(usage["cap:test-card:four"], { value: "over", used: 1100, spend: 1000, per: "month", label: "groceries" });
    assert.equal(capUsage(plain, items.slice(0, 1), "2026-11-16")["cap:test-card:four"].value, "under");
  });
});

describe("best cards for your spending", () => {
  const groups = spendGroups([
    { date: "2026-01-01", amount: 6000, purchase: "groceries", answers: G },
    { date: "2026-01-01", amount: 1200, purchase: "dining", answers: C },
    { date: "2026-01-01", amount: 3000, purchase: "other", answers: C },
  ]);

  test("each purchase goes on the card that gives the most, and a cap spreads over the year", () => {
    const flat = { ...plain, id: "flat", earn: [], base: 2, annualFee: 0 };
    const result = bestOfSet([plain, flat], groups);
    // Groceries: 6,000 at 4% fits under 12 x 1,000; dining ties at 2% (the
    // first card listed keeps it); everything else at 2% on the flat card.
    assert.equal(result.earned, 240 + 24 + 60);
    assert.equal(result.fees, 50);
    assert.equal(result.perCard[1].spend, 3000);
  });

  test("spending past a cap earns the card's rate past it", () => {
    const big = spendGroups([{ date: "2026-01-01", amount: 18000, purchase: "groceries", answers: G }]);
    assert.equal(bestOfSet([plain], big).earned, 12000 * 0.04 + 6000 * 0.01);
  });

  test("a card to add is worth what it adds, less its fee", () => {
    const flat = { ...plain, id: "flat", name: "Flat", earn: [], base: 2, annualFee: 20 };
    const none = { ...plain, id: "none", name: "None", earn: [], base: 0.5, annualFee: 0 };
    const [first, second] = cardsToAdd([plain], [plain, flat, none], groups);
    assert.equal(first.card.id, "flat");
    // Adds 1% on 3,000 of everything else; dining is a tie, so it stays put.
    assert.equal(first.extra, 30);
    assert.equal(first.gain, 10);
    assert.equal(second.card.id, "none");
    assert.equal(second.gain, 0);
  });

  test("works across the whole shipped card list", () => {
    const held = walletCards([{ id: "amex-cobalt" }]);
    const ranked = cardsToAdd(held, CARDS, groups, { limit: 3 });
    assert.equal(ranked.length, 3);
    assert.ok(ranked.every((r) => Number.isFinite(r.gain)));
    assert.ok(!ranked.some((r) => r.card.id === "amex-cobalt"), "a card already held is never offered");
  });
});

describe("reaching a sign-up bonus, with and without rent", () => {
  // Rent through Chexy earns 4% on the card it is on now; the new card
  // earns 1% on everything, the same as the old one does on dining.
  const now = { id: "now", name: "Now", network: "visa", points: "cash", base: 1, annualFee: 0, earn: [{ on: ["bills"], rate: 4 }] };
  const next = { id: "next", name: "Next", network: "visa", points: "cash", base: 1, annualFee: 0, earn: [] };
  const year = (withRent) => {
    const list = [];
    for (let m = 1; m <= 12; m += 1) {
      const month = String(m).padStart(2, "0");
      list.push(tx(`2026-${month}-05`, "SOME BISTRO", 500, { category_id: "d" }));
      if (withRent) list.push(tx(`2026-${month}-01`, "CHEXY", 2000, { category_id: "r" }));
    }
    return spendItems(list, { categoryName: (id) => ({ d: "Dining", r: "Rent" })[id] || "" });
  };

  test("rent through Chexy is found and averaged, and kept out of everyday spending", () => {
    const profile = bonusProfile(year(true), [now]);
    assert.equal(profile.foundRent, 2000);
    assert.equal(profile.monthlyRent, 2000);
    assert.equal(profile.viaChexy, true);
    assert.equal(profile.yearly, 6000);
    assert.equal(bonusProfile(year(true), [now], { rent: 2500 }).monthlyRent, 2500, "a typed rent wins");
  });

  test("short without rent; rent closes the gap at the rewards it no longer earns", () => {
    const plan = bonusPlan(next, bonusProfile(year(true), [now]), { minSpend: 3000, months: 3 });
    assert.equal(plan.monthly, 500);
    assert.deepEqual(plan.without, { reachable: false, short: 1500, cost: 0 });
    // Dining moves at no loss (1% either way), then $1,500 of rent loses 4% - 1%.
    assert.deepEqual(plan.withRent, { reachable: true, short: 0, cost: 45, rentUsed: 1500, payments: 1 });
  });

  test("a big minimum over a year: how many rent payments it takes", () => {
    const plan = bonusPlan(next, bonusProfile(year(true), [now, next]), { minSpend: 12000, months: 12 });
    assert.equal(plan.without.short, 6000);
    assert.equal(plan.withRent.payments, 3, "$6,000 of rent at $2,000 a month");
    assert.equal(plan.withRent.cost, 180);
  });

  test("rent not on a card yet costs Chexy's fee less what the new card earns", () => {
    const profile = bonusProfile(year(false), [now], { rent: 2000 });
    assert.equal(profile.viaChexy, false);
    const plan = bonusPlan(next, profile, { minSpend: 3000, months: 3 });
    assert.equal(plan.withRent.cost, 11.25, "$1,500 at 1.75% - 1%");
  });

  test("still short with every rent payment", () => {
    const plan = bonusPlan(next, bonusProfile(year(true), [now]), { minSpend: 20000, months: 3 });
    assert.equal(plan.withRent.reachable, false);
    assert.equal(plan.withRent.short, 12500);
  });

  test("no rent known: only the plan without it", () => {
    const plan = bonusPlan(next, bonusProfile(year(false), [now]), { minSpend: 1000, months: 3 });
    assert.equal(plan.without.reachable, true);
    assert.equal(plan.withRent, null);
  });

  test("closing what is left of a tracked bonus with rent", () => {
    const profile = bonusProfile(year(true), [now]);
    assert.deepEqual(rentToClose(next, profile, 4500), { payments: 3, cost: 135 });
    assert.equal(rentToClose(next, profile, 0), null);
  });
});
