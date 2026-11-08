import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { setCatalogue, CARDS, TIERS } from "../js/tools/card_catalogue.js";
import { validateCatalogue } from "../js/tools/card_rewards.js";
import { moveCard, publishedTier, tierBoard } from "../js/tools/card_tiers.js";

const SHIPPED = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
setCatalogue(SHIPPED);

const published = {
  updated: "2026-11-08",
  source: "Reddit",
  tiers: [
    { id: "S", label: "Top", cards: [{ card: "a", why: "A" }, { card: "b", why: "B" }] },
    { id: "A", label: "Great", cards: [{ card: "c", why: "C" }, { card: "gone", why: "Gone" }] },
  ],
};
const cards = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
const ids = (board) => board.tiers.map((t) => [t.id, t.cards.map((e) => e.card.id + (e.moved ? "*" : ""))]);

describe("tier list", () => {
  test("the shipped list is valid and ranks every card once", () => {
    assert.deepEqual(validateCatalogue(SHIPPED), []);
    assert.ok(TIERS);
    const board = tierBoard(TIERS, {}, CARDS);
    assert.deepEqual(board.unranked, []);
    assert.equal(board.tiers.flatMap((t) => t.cards).length, CARDS.length);
  });

  test("bad tiers are refused", () => {
    const bad = (tiers) => validateCatalogue({ ...SHIPPED, tiers: { ...SHIPPED.tiers, tiers } });
    assert.ok(bad([{ id: "S", label: "S", cards: [{ card: "nope", why: "x" }] }]).some((p) => /unknown card nope/.test(p)));
    assert.ok(bad([{ id: "S", label: "S", cards: [{ card: "amex-cobalt", why: "x" }, { card: "amex-cobalt", why: "y" }] }]).some((p) => /ranked twice/.test(p)));
    assert.ok(bad([{ id: "S", label: "S", cards: [{ card: "amex-cobalt" }] }]).some((p) => /needs a reason/.test(p)));
    assert.ok(validateCatalogue({ ...SHIPPED, tiers: { tiers: [] } }).some((p) => /updated date/.test(p)));
  });

  test("published order, unknown cards dropped, the rest unranked", () => {
    const board = tierBoard(published, {}, cards);
    assert.deepEqual(ids(board), [["S", ["a", "b"]], ["A", ["c"]]]);
    assert.deepEqual(board.unranked.map((c) => c.id), ["d"]);
  });

  test("moves layer on top, and moving back undoes the move", () => {
    let overrides = moveCard({}, published, "b", "A");
    overrides = moveCard(overrides, published, "d", "S");
    overrides = moveCard(overrides, published, "c", "");
    assert.deepEqual(overrides, { b: "A", d: "S", c: "" });
    const board = tierBoard(published, overrides, cards);
    assert.deepEqual(ids(board), [["S", ["a", "d*"]], ["A", ["b*"]]]);
    assert.deepEqual(board.unranked.map((c) => c.id), ["c"]);
    assert.equal(board.tiers[1].cards[0].why, "B");
    assert.deepEqual(moveCard(overrides, published, "b", "S"), { d: "S", c: "" });
    assert.equal(publishedTier(published, "d"), "");
  });
});
