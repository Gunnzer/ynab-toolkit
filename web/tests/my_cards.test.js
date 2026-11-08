import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CARDS, setCatalogue } from "../js/tools/card_catalogue.js";
import { validateCatalogue } from "../js/tools/card_rewards.js";
import { FACES, cardFace, earnLines, feeInfo, walletFees } from "../js/tools/my_cards.js";

const SHIPPED = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
setCatalogue(SHIPPED);
const byId = (id) => CARDS.find((c) => c.id === id);

describe("my cards", () => {
  test("every card has a face, and a hand-made card can pick its own", () => {
    for (const c of CARDS) assert.ok(FACES.includes(cardFace(c)), c.id);
    assert.equal(cardFace(byId("amex-gold")), "gold");
    assert.equal(cardFace({ id: "x", issuer: "TD", network: "visa" }), "green");
    assert.equal(cardFace({ id: "x", issuer: "Nobody", network: "amex" }), "blue");
    assert.equal(cardFace({ id: "x", custom: true, face: "teal" }), "teal");
  });

  test("fees, with an announced change upcoming until its date", () => {
    const card = { annualFee: 599, feeChange: { fee: 799, from: "2027-01-12", detail: "d" } };
    assert.deepEqual(feeInfo(card, "2026-11-08").change, { fee: 799, from: "2027-01-12", detail: "d", upcoming: true, diff: 200 });
    assert.equal(feeInfo(card, "2027-01-13").change.upcoming, false);
    assert.deepEqual(feeInfo({ annualFee: 0 }, "2026-11-08"), { fee: 0, change: null });
    const total = walletFees([card, { annualFee: 120 }], "2026-11-08");
    assert.deepEqual([total.now, total.next, total.changes.length], [719, 919, 1]);
  });

  test("earn lines best first by value, everything else last", () => {
    const lines = earnLines(byId("amex-cobalt"));
    assert.equal(lines.at(-1).what, "Everything else");
    assert.equal(lines[0].back, 5.5);
    assert.ok(lines.slice(0, -1).every((l, i, a) => i === 0 || a[i - 1].back >= l.back));
    assert.equal(earnLines(byId("amex-cobalt"), { mr: 2 })[0].back, 10);
    const sc = earnLines(byId("amex-simplycash-preferred"));
    assert.deepEqual(sc.map((l) => l.back), [4, 4, 2]);
    assert.ok(sc.some((l) => l.conditions.some((c) => /30,000/.test(c))));
  });

  test("the data file's fee changes are checked", () => {
    const withChange = (feeChange) => ({ ...SHIPPED, cards: SHIPPED.cards.map((c, i) => (i === 0 ? { ...c, feeChange } : c)) });
    assert.deepEqual(validateCatalogue(SHIPPED), []);
    assert.deepEqual(validateCatalogue(withChange({ fee: 200, from: "2027-01-01" })), []);
    for (const bad of [{ fee: -1, from: "2027-01-01" }, { fee: 200 }, { fee: 200, from: "soon" }, null]) {
      assert.ok(validateCatalogue(withChange(bad)).some((p) => /fee change/.test(p)), JSON.stringify(bad));
    }
  });
});
