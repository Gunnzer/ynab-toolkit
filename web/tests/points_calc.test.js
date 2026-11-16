import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { setCatalogue } from "../js/tools/card_catalogue.js";
import { balancesWorth, redemption, tierPlan, transferOptions, transferable } from "../js/tools/points_calc.js";

setCatalogue(JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8")));

describe("points calculator", () => {
  test("a flight's value per point, after the fees paid in cash and what cash would have earned", () => {
    // 25,000 Aeroplan points plus $80 of taxes, against a $560 cash fare.
    const r = redemption({ points: 25000, cash: 560, fees: 80, backRate: 0.02, yours: 1.5 });
    assert.equal(r.saved, 480);
    assert.equal(r.cents, 1.92);
    assert.equal(r.fair, 1.88, "paying $480 in cash would have earned 2% back");
    assert.equal(r.verdict, "good");
    assert.equal(redemption({ points: 25000, cash: 380, fees: 80, yours: 1.5 }).verdict, "poor");
    assert.equal(redemption({ points: 25000, cash: 410, fees: 80, yours: 1.5 }).verdict, "close");
    assert.equal(redemption({ points: 0, cash: 100 }).verdict, "", "nothing to work out yet");
  });

  test("where Amex points are best sent, at your point values", () => {
    const options = transferOptions("mr", 10000, { values: { aeroplan: 1.5, bonvoy: 0.8 } });
    assert.deepEqual(options.map((o) => [o.to, o.points, o.worth]), [
      ["aeroplan", 10000, 150],
      ["mr", 10000, 100],
      ["bonvoy", 12000, 96],
    ]);
    assert.ok(transferable().includes("mr"));
    assert.deepEqual(transferOptions("mr", 0), []);
  });

  test("a PC Optimum bonus tier against a balance", () => {
    assert.deepEqual(tierPlan(320000, 150000, 225), { cents: 0.15, times: 2, dollars: 450, left: 20000, short: 130000 });
    assert.deepEqual(tierPlan(150000, 150000, 225).short, 0);
    assert.equal(tierPlan(1000, 0, 10), null);
  });

  test("balances at your point values", () => {
    const { rows, total } = balancesWorth({ aeroplan: 40000, pc: 100000, nope: 5, mr: 0 }, { pc: 0.15 });
    assert.deepEqual(rows.map((r) => [r.points, r.worth]), [["aeroplan", 600], ["pc", 150]]);
    assert.equal(total, 750);
  });
});
