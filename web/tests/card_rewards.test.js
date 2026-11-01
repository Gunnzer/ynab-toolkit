import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { CARDS, CATALOGUE_CHECKED, PURCHASES, setCatalogue } from "../js/tools/card_catalogue.js";
import {
  QUESTIONS, TARGET_CONFIDENCE, UNSURE, daysSince, describeEarn, earnFor, explain,
  centsPerPoint, formatEarned, formatRate, formatValue, formatWorth, normaliseCustom, questionsFor, recommend, shortName, transferRatio, asPreferred,
  validateCatalogue, walletCards,
} from "../js/tools/card_rewards.js";

// The file the site serves and the app downloads every day.
const SHIPPED = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
setCatalogue(SHIPPED);

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
  test("the shipped data file passes validation", () => {
    assert.deepEqual(validateCatalogue(SHIPPED), []);
    assert.equal(CATALOGUE_CHECKED, SHIPPED.checked);
    assert.ok(CARDS.length >= 10);
  });

  test("the user's own cards are in it", () => {
    assert.ok(CARDS.some((c) => c.id === "amex-cobalt"));
    assert.ok(CARDS.some((c) => c.id === "td-aeroplan-vi"));
  });

  test("validation catches the mistakes a monthly update could make", () => {
    const broken = structuredClone(SHIPPED);
    broken.cards[0].earn[0].on = ["grocerys"];
    broken.cards[1].points = "air-miles";
    broken.cards[2].earn.push({ on: ["travel"], rate: 2, when: { booking: ["westjet"] } });
    broken.cards[3].checked = "2099-01-01";
    broken.cards.push({ ...broken.cards[4] });
    const problems = validateCatalogue(broken);
    assert.ok(problems.some((p) => /unknown purchase grocerys/.test(p)));
    assert.ok(problems.some((p) => /unknown point type/.test(p)));
    assert.ok(problems.some((p) => /booking has no answer westjet/.test(p)));
    assert.ok(problems.some((p) => /checked date/.test(p)));
    assert.ok(problems.some((p) => /listed twice/.test(p)));
    assert.deepEqual(validateCatalogue(null), ["It is not a catalogue at all."]);
    assert.ok(validateCatalogue({ checked: "2026-10-31", pointTypes: {}, cards: [] }).length > 0);
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

  test("every purchase type can be asked about", () => {
    assert.ok(PURCHASES.every((p) => QUESTIONS.some((q) => q.appliesTo.includes(p.id))));
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
    assert.equal(result.asked[0].answer, "Store not sure");
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

  test("answers read on their own as short chips", () => {
    const result = recommend(mine, "dining", { amex: "yes", currency: "cad", "cap:amex-cobalt:eats": "under" });
    assert.deepEqual(result.asked.map((a) => a.answer).sort(),
      ["CAD", "Amex Cobalt under cap", "Takes Amex"].sort());
    for (const q of QUESTIONS) {
      assert.ok(q.unsure, `${q.id} needs a short "not sure" chip`);
      for (const o of q.options) assert.ok(o.chip && o.chip.length <= 24, `${q.id}/${o.id} chip`);
    }
  });

  test("sure enough still offers the question that would help, without asking it", () => {
    const wallet = walletCards([{ id: "scotia-momentum-vi" }, { id: "td-aeroplan-vi" }]);
    const result = recommend(wallet, "groceries", { store: "grocer", currency: "cad" });
    assert.ok(result.confidence >= TARGET_CONFIDENCE);
    assert.equal(result.next, null);
    assert.match(result.optional.id, /^cap:/);
    const settled = recommend(wallet, "groceries", { store: "grocer", currency: "cad",
      "cap:scotia-momentum-vi:four": "under", "cap:td-aeroplan-vi:accel": "under" });
    assert.equal(settled.confidence, 1);
    assert.equal(settled.optional, null);
  });

  test("a cap alone does not make a vague 'could be' range", () => {
    const [momentum] = walletCards([{ id: "scotia-momentum-vi" }]);
    const result = recommend([momentum], "groceries", { store: "grocer", currency: "cad" });
    const stat = result.groups[0].cards[0];
    assert.equal(stat.min, stat.max);
    const lines = explain(stat, "groceries", { store: "grocer", currency: "cad" });
    assert.ok(!lines.some((l) => /Could be/.test(l)));
    assert.ok(lines.some((l) => /\$25,000/.test(l)));
  });

  test("one card past its cap does not make another card's range vague, and says why it dropped", () => {
    const wallet = walletCards([{ id: "scotia-momentum-vi" }, { id: "td-aeroplan-vi" }]);
    const answers = { store: "grocer", currency: "cad", "cap:scotia-momentum-vi:four": "over" };
    const result = recommend(wallet, "groceries", answers, { grouped: false });
    const [td, momentum] = result.groups[0].cards;
    assert.equal(td.card.id, "td-aeroplan-vi");
    assert.equal(td.min, td.max);
    const lines = explain(momentum, "groceries", answers);
    assert.ok(lines.some((l) => /Past its \$25,000 yearly cap, so 1% instead of 4%/.test(l)), lines.join(" | "));
  });

  test("an empty wallet has nothing to say", () => {
    const result = recommend([], "groceries", {});
    assert.equal(result.groups.length, 0);
    assert.equal(result.next, null);
  });
});

describe("value or points, grouped or one list", () => {
  const wallet = walletCards([{ id: "amex-cobalt" }, { id: "td-aeroplan-vi" }, { id: "pc-world-elite" }]);
  const atLoblaw = { store: "loblaw", currency: "cad", amex: "yes", "cap:amex-cobalt:eats": "under", "cap:td-aeroplan-vi:accel": "under" };

  test("by value, a 5x Cobalt beats 30x PC Optimum; by points it does not", () => {
    const value = recommend(wallet, "groceries", atLoblaw, { measure: "value", grouped: false });
    assert.equal(value.groups.length, 1);
    assert.deepEqual(value.groups[0].cards.map((c) => c.card.id),
      ["amex-cobalt", "pc-world-elite", "td-aeroplan-vi"]);
    assert.equal(value.groups[0].cards[0].score, 10);
    const points = recommend(wallet, "groceries", atLoblaw, { measure: "points", grouped: false });
    assert.equal(points.groups[0].cards[0].card.id, "pc-world-elite");
  });

  test("grouped keeps one list per point type, ordered by the chosen measure", () => {
    const result = recommend(wallet, "groceries", atLoblaw, { measure: "value", grouped: true });
    // PC at Loblaw (30 x 0.1c) and TD Aeroplan (1.5 x 2c) both come to 3%.
    assert.deepEqual(result.groups.map((g) => g.points), ["mr", "aeroplan", "pc"]);
    assert.equal(result.groups[1].cards[0].score, result.groups[2].cards[0].score);
  });

  test("your own point values change the ranking", () => {
    const result = recommend(wallet, "groceries", atLoblaw,
      { measure: "value", grouped: false, values: { pc: 1, mr: 1 } });
    assert.equal(result.groups[0].cards[0].card.id, "pc-world-elite");
  });

  test("ungrouped, how sure is about the single top card", () => {
    const result = recommend(wallet, "groceries", {}, { grouped: false });
    assert.ok(result.confidence < TARGET_CONFIDENCE);
    assert.equal(result.next.id, "store");
  });

  test("point values: yours, then typical, cash always 1 cent per percent", () => {
    assert.equal(centsPerPoint("aeroplan"), 2);
    assert.equal(centsPerPoint("aeroplan", { aeroplan: 1.6 }), 1.6);
    assert.equal(centsPerPoint("aeroplan", { aeroplan: "" }), 2);
    assert.equal(centsPerPoint("cash", { cash: 5 }), 1);
    assert.equal(centsPerPoint("custom:Air Miles"), 1);
    assert.equal(formatValue("mr", 5), "10%");
    assert.equal(formatValue("pc", 30), "3%");
    assert.equal(formatValue("td", 1.5), "0.75%");
    assert.equal(formatWorth("aeroplan", 1.5, 100), "$3.00");
  });

  test("validation rejects an odd point value", () => {
    const broken = structuredClone(SHIPPED);
    broken.pointTypes.mr.cents = "two";
    assert.ok(validateCatalogue(broken).some((p) => /odd value in cents/.test(p)));
  });
});

describe("preferred points", () => {
  const wallet = walletCards([{ id: "amex-cobalt" }, { id: "td-aeroplan-vi" }, { id: "cibc-dividend-vi" }]);
  const known = { store: "loblaw", currency: "cad", amex: "yes",
    "cap:amex-cobalt:eats": "under", "cap:td-aeroplan-vi:accel": "under" };

  test("Membership Rewards moves to Aeroplan 1 to 1; nothing moves the other way", () => {
    assert.equal(transferRatio("mr", "aeroplan"), 1);
    assert.equal(transferRatio("aeroplan", "mr"), 0);
    assert.equal(transferRatio("aeroplan", "aeroplan"), 1);
    assert.equal(transferRatio("scene", "aeroplan"), 0);
  });

  test("with Aeroplan preferred, the Cobalt earns Aeroplan and joins that group first", () => {
    const result = recommend(wallet, "groceries", known, { grouped: true, preferred: "aeroplan" });
    assert.equal(result.groups[0].points, "aeroplan");
    assert.deepEqual(result.groups[0].cards.map((c) => c.card.id), ["amex-cobalt", "td-aeroplan-vi"]);
    const cobalt = result.groups[0].cards[0];
    assert.equal(cobalt.rate, 5);
    assert.equal(cobalt.card.convertedFrom, "mr");
    assert.ok(!result.groups.some((g) => g.points === "mr"));
  });

  test("it uses Aeroplan's value, so one number moves both", () => {
    const result = recommend(wallet, "groceries", known,
      { grouped: false, preferred: "aeroplan", values: { aeroplan: 1, mr: 5 } });
    const cobalt = result.groups[0].cards.find((c) => c.card.id === "amex-cobalt");
    assert.equal(cobalt.score, 5);
  });

  test("a preference never changes a card that cannot move", () => {
    const [dividend] = asPreferred(walletCards([{ id: "cibc-dividend-vi" }]), "aeroplan");
    assert.equal(dividend.points, "cash");
    assert.equal(dividend.convertedFrom, undefined);
    const same = recommend(wallet, "groceries", known, { grouped: true, preferred: "" });
    assert.ok(same.groups.some((g) => g.points === "mr"));
  });

  test("validation rejects a transfer to nowhere or an odd ratio", () => {
    const broken = structuredClone(SHIPPED);
    broken.pointTypes.mr.transfers = { "air-miles": 1, aeroplan: -1 };
    const problems = validateCatalogue(broken);
    assert.ok(problems.some((p) => /odd transfer to air-miles/.test(p)));
    assert.ok(problems.some((p) => /odd transfer to aeroplan/.test(p)));
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

  test("short names fit one line and stay recognisable", () => {
    const short = (name) => shortName({ name });
    assert.equal(short("American Express Aeroplan Card"), "Amex Aeroplan");
    assert.equal(short("TD Aeroplan Visa Infinite Card"), "TD Aeroplan VI");
    assert.equal(short("Scotiabank Gold American Express Card"), "Scotia Gold Amex");
    assert.equal(short("SimplyCash Preferred Card from American Express"), "SimplyCash Preferred (Amex)");
    assert.equal(short("PC World Elite Mastercard"), "PC World Elite");
    assert.equal(shortName({ custom: true, name: "My store card" }), "My store card");
    assert.equal(shortName({ name: "Anything", short: "Mine" }), "Mine");
    for (const card of CARDS) {
      assert.ok(shortName(card).length <= 28, `${card.name} shortens to ${shortName(card)}`);
    }
  });

  test("days since", () => {
    assert.equal(daysSince("2026-10-01", "2026-10-31"), 30);
    assert.equal(daysSince("", "2026-10-31"), null);
  });
});
