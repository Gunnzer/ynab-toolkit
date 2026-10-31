import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  CARDS, CATALOGUE_CHECKED, NETWORKS, POINT_TYPES, PURCHASES,
} from "../js/tools/card_catalogue.js";
import {
  QUESTIONS, TARGET_CONFIDENCE, UNSURE, daysSince, describeEarn, earnFor, explain,
  formatEarned, formatRate, normaliseCustom, questionsFor, recommend, walletCards,
} from "../js/tools/card_rewards.js";

const PURCHASE_IDS = new Set(PURCHASES.map((p) => p.id));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Answer whatever it asks with its first option, until it stops asking. */
function answerAll(cards, purchase, pick = (q) => q.options[0].id) {
  const answers = {};
  let result = recommend(cards, purchase, answers);
  for (let i = 0; result.next && i < 12; i += 1) {
    answers[result.next.id] = pick(result.next);
    result = recommend(cards, purchase, answers);
  }
  return { answers, result };
}

describe("card catalogue", () => {
  test("every card is complete and refers only to things that exist", () => {
    const ids = new Set();
    const questionIds = new Set(QUESTIONS.map((q) => q.id));
    assert.match(CATALOGUE_CHECKED, DATE);
    for (const card of CARDS) {
      assert.ok(!ids.has(card.id), `${card.id} is listed twice`);
      ids.add(card.id);
      assert.ok(card.name && card.issuer, `${card.id} needs a name and issuer`);
      assert.ok(NETWORKS[card.network], `${card.id} has an unknown network`);
      assert.ok(POINT_TYPES[card.points], `${card.id} has an unknown point type`);
      assert.ok(card.base > 0, `${card.id} needs a base rate`);
      assert.ok(card.annualFee >= 0 && card.fxFee >= 0 && card.fxFee < 0.1, `${card.id} fees`);
      assert.match(card.checked, DATE, `${card.id} needs a checked date`);
      assert.ok(card.checked <= CATALOGUE_CHECKED, `${card.id} checked after the catalogue`);
      assert.ok(card.source, `${card.id} needs a source`);
      for (const rule of card.earn) {
        assert.ok(rule.rate > 0, `${card.id} has a rule with no rate`);
        for (const on of rule.on) {
          assert.ok(on === "*" || on === "picks" || PURCHASE_IDS.has(on), `${card.id}: unknown purchase ${on}`);
          if (on === "picks") assert.ok(card.picks, `${card.id} uses picks without offering any`);
        }
        for (const [key, allowed] of Object.entries(rule.when || {})) {
          if (key === "flag") {
            assert.ok(card.flags?.some((f) => f.id === allowed), `${card.id}: unknown flag ${allowed}`);
            continue;
          }
          assert.ok(questionIds.has(key), `${card.id}: unknown question ${key}`);
          const options = QUESTIONS.find((q) => q.id === key).options.map((o) => o.id);
          for (const value of allowed) assert.ok(options.includes(value), `${card.id}: ${key} has no ${value}`);
        }
        if (rule.cap) {
          assert.ok(rule.cap.key && rule.cap.spend > 0 && rule.cap.label, `${card.id} cap`);
          assert.ok(["month", "year"].includes(rule.cap.per), `${card.id} cap period`);
        }
      }
      for (const id of card.picks?.from || []) assert.ok(PURCHASE_IDS.has(id), `${card.id}: pick ${id}`);
    }
  });

  test("the user's own cards are in it", () => {
    assert.ok(CARDS.some((c) => c.id === "amex-cobalt"));
    assert.ok(CARDS.some((c) => c.id === "td-aeroplan-vi"));
  });

  test("every question's priors add up for every purchase", () => {
    for (const q of QUESTIONS) {
      for (const purchase of q.appliesTo) {
        const total = q.options.reduce((s, o) => s + (typeof o.prior === "number"
          ? o.prior : (o.prior[purchase] ?? o.prior.default)), 0);
        assert.ok(Math.abs(total - 1) < 1e-9, `${q.id} for ${purchase} adds up to ${total}`);
      }
    }
  });
});

describe("what a card earns", () => {
  const [cobalt, tdAeroplan] = walletCards([{ id: "amex-cobalt" }, { id: "td-aeroplan-vi" }]);

  test("grocery rates only at a store that codes as groceries", () => {
    assert.equal(earnFor(cobalt, "groceries", { store: "loblaw", currency: "cad" }).rate, 5);
    assert.equal(earnFor(cobalt, "groceries", { store: "walmart", currency: "cad" }).rate, 1);
    assert.equal(earnFor(tdAeroplan, "groceries", { store: "walmart" }).rate, 1);
    assert.equal(earnFor(tdAeroplan, "groceries", { store: "sobeys" }).rate, 1.5);
  });

  test("Costco takes only Mastercard, and a 'no Amex' answer blocks Amex", () => {
    assert.equal(earnFor(cobalt, "groceries", { store: "costco" }).accepted, false);
    assert.equal(earnFor(tdAeroplan, "groceries", { store: "costco" }).accepted, false);
    const [costcoCard] = walletCards([{ id: "cibc-costco-mc" }]);
    assert.deepEqual(earnFor(costcoCard, "gas", { station: "costco" }).rate, 3);
    assert.equal(earnFor(cobalt, "dining", { amex: "no", currency: "cad" }).accepted, false);
    assert.equal(earnFor(tdAeroplan, "dining", { amex: "no" }).accepted, true);
  });

  test("a used-up cap drops to the base rate", () => {
    const answers = { currency: "cad", "cap:amex-cobalt:eats": "over" };
    assert.equal(earnFor(cobalt, "dining", answers).rate, 1);
  });

  test("Cobalt's bonus is for purchases in Canada only", () => {
    assert.equal(earnFor(cobalt, "dining", { currency: "usd" }).rate, 1);
  });

  test("chosen categories and yes/no facts about the holder", () => {
    const [tangerine, rogers] = walletCards([
      { id: "tangerine-mc", picks: ["gas", "bills", "groceries", "dining"] },
      { id: "rogers-red-we", flags: { rogersService: true } },
    ]);
    assert.deepEqual(tangerine.chosen, ["gas", "bills", "groceries"], "only as many picks as allowed");
    assert.equal(earnFor(tangerine, "gas", {}).rate, 2);
    assert.equal(earnFor(tangerine, "dining", {}).rate, 0.5);
    assert.equal(earnFor(rogers, "other", { currency: "cad" }).rate, 2);
    assert.equal(earnFor(rogers, "other", { currency: "usd" }).rate, 3);
    const [plainRogers] = walletCards([{ id: "rogers-red-we" }]);
    assert.equal(earnFor(plainRogers, "other", { currency: "cad" }).rate, 1.5);
  });

  test("cards typed in by hand", () => {
    const card = normaliseCustom({
      id: "custom-1", name: " Store card ", network: "diners", pointsName: "Air Miles",
      base: "1", rates: { groceries: "3", gas: "", nonsense: 9, dining: 1 },
    });
    assert.equal(card.name, "Store card");
    assert.equal(card.network, "visa");
    assert.equal(card.points, "custom:Air Miles");
    assert.deepEqual(card.earn, [{ on: ["groceries"], rate: 3 }]);
    const [held] = walletCards([{ custom: true, id: "custom-1", name: "X", points: "cash", base: 1, rates: { gas: 2 } }]);
    assert.equal(earnFor(held, "gas", {}).rate, 2);
    assert.equal(walletCards([{ id: "no-such-card" }]).length, 0);
  });
});

describe("ranking and questions", () => {
  const mine = walletCards([{ id: "amex-cobalt" }, { id: "td-aeroplan-vi" }]);

  test("groups by point type, most points first", () => {
    const { result } = answerAll(mine, "groceries");
    assert.deepEqual(result.groups.map((g) => g.points), ["mr", "aeroplan"]);
    assert.equal(result.groups[0].cards[0].rate, 5);
    assert.equal(result.groups[1].cards[0].rate, 1.5);
  });

  test("asks which store first for groceries, then stops at 90%", () => {
    const first = recommend(mine, "groceries", {});
    assert.ok(first.confidence < TARGET_CONFIDENCE);
    assert.equal(first.next.id, "store");
    const { result } = answerAll(mine, "groceries");
    assert.ok(result.confidence >= TARGET_CONFIDENCE);
    assert.equal(result.next, null);
  });

  test("at Costco neither card works, and it says so", () => {
    const result = recommend(mine, "groceries", { store: "costco" });
    assert.ok(result.groups.every((g) => !g.cards[0].accepted));
    assert.equal(result.confidence, 1);
    const lines = explain(result.groups[0].cards[0], "groceries", { store: "costco" });
    assert.match(lines[0], /Costco only takes Mastercard/);
  });

  test("Air Canada bookings move Aeroplan above Membership Rewards", () => {
    const result = recommend(mine, "travel", { booking: "air-canada", currency: "cad", amex: "yes" });
    assert.equal(result.groups[0].points, "aeroplan");
    assert.equal(result.groups[0].cards[0].rate, 1.5);
  });

  test("not sure is an answer: never asked again, the doubt stays", () => {
    const answers = { store: UNSURE };
    const result = recommend(mine, "groceries", answers);
    assert.notEqual(result.next?.id, "store");
    assert.ok(result.confidence < TARGET_CONFIDENCE);
    assert.equal(result.asked[0].answer, "Not sure");
  });

  test("never asks something that cannot change the answer", () => {
    const [onlyVisa] = walletCards([{ id: "rbc-avion-vi" }]);
    const result = recommend([onlyVisa], "other", {});
    assert.equal(result.confidence, 1);
    assert.equal(result.next, null);
  });

  test("within a group the best card leads", () => {
    const cash = walletCards([{ id: "td-cashback-vi" }, { id: "bmo-cashback-we" }, { id: "cibc-dividend-vi" }]);
    const { result } = answerAll(cash, "groceries", (q) => q.options.find((o) => o.id === "grocer" || o.id === "under" || o.id === "yes" || o.id === "cad")?.id ?? q.options[0].id);
    assert.equal(result.groups.length, 1);
    assert.deepEqual(result.groups[0].cards.map((c) => c.card.id),
      ["bmo-cashback-we", "cibc-dividend-vi", "td-cashback-vi"]);
  });

  test("cap questions only for caps that can matter", () => {
    const ids = questionsFor("streaming", mine).map((q) => q.id);
    assert.ok(!ids.includes("cap:td-aeroplan-vi:accel"));
    assert.ok(questionsFor("gas", mine).some((q) => q.id === "cap:td-aeroplan-vi:accel"));
    // Groceries at Walmart become "everything else", so caps on that count too.
    const [rogers] = walletCards([{ id: "rogers-red-we", flags: { rogersService: true } }]);
    assert.ok(questionsFor("groceries", [rogers]).some((q) => q.id === "cap:rogers-red-we:accel"));
  });

  test("a Visa alone at groceries: Costco is the only doubt, and 90% is enough", () => {
    const [onlyVisa] = walletCards([{ id: "rbc-avion-vi" }]);
    const result = recommend([onlyVisa], "groceries", {});
    assert.equal(result.confidence, 0.9);
    assert.equal(result.next, null);
  });

  test("an empty wallet has nothing to say", () => {
    const result = recommend([], "groceries", {});
    assert.equal(result.groups.length, 0);
    assert.equal(result.next, null);
  });
});

describe("formatting", () => {
  test("rates and earnings", () => {
    assert.equal(formatRate("mr", 5), "5x");
    assert.equal(formatRate("cash", 1.5), "1.5%");
    assert.equal(formatEarned("mr", 5, 120), "600 points");
    assert.equal(formatEarned("cash", 4, 50), "$2.00 back");
    assert.equal(formatEarned("mr", 5, 0), "");
  });

  test("a card's rules in words", () => {
    const [cobalt] = walletCards([{ id: "amex-cobalt" }]);
    const lines = describeEarn(cobalt);
    assert.equal(lines[0].rate, "5x");
    assert.match(lines[0].conditions.join(" "), /Canadian dollars/);
    assert.match(lines[0].conditions.join(" "), /\$2,500 of eats and drinks a month/);
    assert.deepEqual(lines.at(-1), { rate: "1x", value: 1, what: "Everything else", conditions: [] });
  });

  test("days since", () => {
    assert.equal(daysSince("2026-10-01", "2026-10-31"), 30);
    assert.equal(daysSince("", "2026-10-31"), null);
  });
});
