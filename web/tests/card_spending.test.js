import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CARDS, setCatalogue } from "../js/tools/card_catalogue.js";
import { walletCards } from "../js/tools/card_rewards.js";
import {
  bestOfSet, capUsage, cardEarnings, cardsToAdd, categoryPurchase, purchaseOf, spendByPurchase, spendGroups, spendItems,
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
    assert.equal(result.byPurchase[0].purchase, "groceries");
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
