import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PURCHASES, setCatalogue } from "../js/tools/card_catalogue.js";
import { QUESTIONS, recommend, walletCards } from "../js/tools/card_rewards.js";
import { MERCHANTS, merchantByName, normalise, searchMerchants } from "../js/tools/merchants.js";

setCatalogue(JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8")));

describe("shops", () => {
  test("every shop points at a real purchase and real answers", () => {
    const purchases = new Set(PURCHASES.map((p) => p.id));
    const names = new Set();
    for (const m of MERCHANTS) {
      assert.ok(!names.has(normalise(m.name)), `${m.name} is listed twice`);
      names.add(normalise(m.name));
      assert.ok(purchases.has(m.purchase), `${m.name}: unknown purchase ${m.purchase}`);
      for (const [question, answer] of Object.entries(m.answers)) {
        const q = QUESTIONS.find((x) => x.id === question);
        assert.ok(q, `${m.name}: unknown question ${question}`);
        assert.ok(q.appliesTo.includes(m.purchase), `${m.name}: ${question} is not asked for ${m.purchase}`);
        assert.ok(q.options.some((o) => o.id === answer), `${m.name}: ${question} has no ${answer}`);
      }
    }
  });

  test("search by name, start of a word, or nickname", () => {
    assert.equal(searchMerchants("dolla")[0].name, "Dollarama");
    assert.equal(searchMerchants("costco")[0].name, "Costco");
    assert.equal(searchMerchants("timmies")[0].name, "Tim Hortons");
    assert.equal(searchMerchants("sdm")[0].name, "Shoppers Drug Mart");
    assert.equal(searchMerchants("frills")[0].name, "No Frills");
    assert.equal(searchMerchants("nofrills")[0].name, "No Frills");
    assert.equal(searchMerchants("A & W")[0].name, "A&W");
    assert.equal(searchMerchants("petro canada")[0].name, "Petro-Canada");
    assert.equal(searchMerchants("voila")[0].name, "Voila");
    assert.deepEqual(searchMerchants(""), []);
    assert.deepEqual(searchMerchants("zzzz"), []);
    assert.ok(searchMerchants("a").length <= 6);
  });

  test("exact names are found ignoring case", () => {
    assert.equal(merchantByName("dollarama").name, "Dollarama");
    assert.equal(merchantByName("nowhere"), null);
  });

  test("a shop settles its own question, so it is not asked", () => {
    const cards = walletCards([{ id: "amex-cobalt" }, { id: "td-aeroplan-vi" }, { id: "pc-world-elite" }]);
    const loblaws = merchantByName("Loblaws");
    const result = recommend(cards, loblaws.purchase, { ...loblaws.answers });
    assert.notEqual(result.next?.id, "store");
    const costco = merchantByName("Costco");
    const atCostco = recommend(cards, costco.purchase, { ...costco.answers });
    const accepted = atCostco.groups.flatMap((g) => g.cards).filter((c) => c.accepted).map((c) => c.card.id);
    assert.deepEqual(accepted, ["pc-world-elite"]);
    assert.equal(merchantByName("Dollarama").purchase, "other");
  });
});
