import { describe, test } from "node:test";
import assert from "node:assert/strict";

import * as cz from "../js/tools/categorize.js";

let next = 0;
const tx = (payee, category_id, extra = {}) => ({
  id: `t${next++}`, date: "2026-10-01", amount: -10000, payee_name: payee, category_id,
  approved: true, deleted: false, subtransactions: [], ...extra,
});

describe("categorize and approve", () => {
  const groups = [{ name: "Internal Master Category", categories: [
    { id: "rta", name: "Inflow: Ready to Assign" }, { id: "uncat", name: "Uncategorized" },
  ] }];
  const uncategorized = cz.uncategorizedIds(groups);

  const past = [
    tx("SHELL #1234", "gas"), tx("Shell #9876", "gas"), tx("SHELL", "gas"), tx("Shell", "snacks"),
    tx("Corner Store", "groceries"), tx("Corner Store", "household"),
    tx("Amazon", "gifts", { approved: false }),
    tx("Amazon", null, { subtransactions: [{ category_id: "books", amount: -10000, deleted: false }] }),
  ];
  const history = cz.payeeHistory(past, { uncategorized });

  test("the internal Uncategorized category counts as no category", () => {
    assert.deepEqual([...uncategorized], ["uncat"]);
  });

  test("suggestions come from approved, single-category history", () => {
    assert.deepEqual(cz.suggestCategory("SHELL #5555", history),
      { categoryId: "gas", count: 3, total: 4, strength: "weak" });
    const corner = cz.suggestCategory("Corner Store", history);
    assert.equal(corner.strength, "weak");
    assert.equal(cz.suggestCategory("Amazon", history), null,
      "unapproved and split history is not used");
    assert.equal(cz.suggestCategory("Brand New Shop", history), null);
  });

  test("a payee always given one category is a strong suggestion", () => {
    const steady = cz.payeeHistory([tx("Netflix", "subs"), tx("Netflix", "subs")]);
    assert.equal(cz.suggestCategory("NETFLIX", steady).strength, "strong");
  });

  test("the queue: needs a category, needs approval, or both", () => {
    const waiting = [
      tx("Shell", null, { approved: false, date: "2026-10-05" }),
      tx("Shell", "uncat", { date: "2026-10-04" }),
      tx("Hydro", "utilities", { approved: false, date: "2026-10-03" }),
      tx("Transfer : Savings", null, { approved: false, transfer_account_id: "sav", date: "2026-10-02" }),
      tx("Done", "gas", { date: "2026-10-06" }),
    ];
    const queue = cz.reviewQueue(waiting, { history, uncategorized });
    assert.deepEqual(queue.map((i) => [i.transaction.payee_name, i.kind, i.needsCategory, i.needsApproval, i.categoryId]), [
      ["Shell", "normal", true, true, "gas"],
      ["Shell", "normal", true, false, "gas"],
      ["Hydro", "normal", false, true, "utilities"],
      ["Transfer : Savings", "transfer", false, true, null],
    ]);
  });

  test("off-budget accounts are left out entirely", () => {
    const ids = cz.offBudgetAccountIds([
      { id: "chq", on_budget: true },
      { id: "tfsa", on_budget: false, closed: true },
    ]);
    assert.deepEqual([...ids], ["tfsa"]);
    const queue = cz.reviewQueue([
      tx("Manual Balance Adjustment", null, { account_id: "tfsa" }),
      tx("Shell", null, { account_id: "chq" }),
    ], { history, uncategorized, offBudget: ids });
    assert.deepEqual(queue.map((i) => i.transaction.payee_name), ["Shell"]);
  });

  test("a suggestion the picker cannot show is never filled in", () => {
    const steady = cz.payeeHistory([tx("Adjustment", "rta"), tx("Shell", "gas")]);
    const queue = cz.reviewQueue([
      tx("Adjustment", null, { id: "a" }),
      tx("Shell", null, { id: "b" }),
    ], { history: steady, uncategorized, pickable: new Set(["gas"]) });
    const byId = Object.fromEntries(queue.map((i) => [i.transaction.id, i]));
    assert.equal(byId.a.suggestion.usable, false);
    assert.equal(byId.a.suggestion.categoryId, "rta");
    assert.equal(byId.a.categoryId, null);
    assert.equal(byId.b.suggestion.usable, true);
    assert.equal(byId.b.categoryId, "gas");
    assert.deepEqual(cz.buildUpdate(queue).updates.map((u) => u.id), ["b"],
      "ticking the unusable one cannot save a category the screen never showed");
  });

  test("the update sets only what changes, and keeps a backup to undo", () => {
    const queue = cz.reviewQueue([
      tx("Shell", null, { id: "a", approved: false }),
      tx("Hydro", "utilities", { id: "b", approved: false }),
      tx("Transfer : Savings", null, { id: "c", approved: false, transfer_account_id: "sav" }),
      tx("Mystery", null, { id: "d", approved: false }),
    ], { history, uncategorized });
    const { updates, backup } = cz.buildUpdate(queue);
    assert.deepEqual(updates, [
      { id: "a", category_id: "gas", approved: true },
      { id: "b", approved: true },
      { id: "c", approved: true },
    ], "no suggestion and no category: left alone unless asked");
    assert.deepEqual(cz.undoUpdate(backup).find((u) => u.id === "a"),
      { id: "a", category_id: null, approved: false, memo: "" });

    const all = cz.buildUpdate(queue, { approveUncategorized: true });
    assert.deepEqual(all.updates.find((u) => u.id === "d"), { id: "d", approved: true });
  });
});

describe("categorize: new shops, notes and splits", () => {
  const groups = [{ name: "Internal Master Category", categories: [{ id: "uncat", name: "Uncategorized" }] }];
  const uncategorized = cz.uncategorizedIds(groups);

  test("a shop's kind comes from the shop list, then words in its name", () => {
    assert.deepEqual(cz.payeeKind("TIM HORTONS #1234 TORONTO ON"), { kind: "dining", shop: "Tim Hortons" });
    assert.deepEqual(cz.payeeKind("SQ *SUSHI PLACE"), { kind: "dining", shop: null });
    assert.equal(cz.payeeKind("COSTCO WHOLESALE #55"), null, "a mixed basket says nothing");
    assert.equal(cz.payeeKind("WALMART SUPERCENTRE"), null, "everything-else shops are no help");
    assert.equal(cz.payeeKind("INDEPENDENT AUTO REPAIR"), null);
    assert.equal(cz.payeeKind("Some Business"), null);
  });

  test("a new restaurant gets the category your other restaurants go to", () => {
    const past = [
      tx("STARBUCKS 123", "eating-out", { account_id: "a1" }),
      tx("MCDONALDS #44", "eating-out", { account_id: "a1" }),
      tx("PIZZA PIZZA 12", "eating-out", { account_id: "a2" }),
      tx("THE KEG #5", "date-night", { account_id: "a2" }),
    ];
    const kinds = cz.kindHistory(past, { uncategorized });
    const fresh = tx("A&W 991", null, { account_id: "a1", approved: false });
    const found = cz.suggestByKind(fresh, kinds);
    assert.equal(found.categoryId, "eating-out");
    assert.equal(found.kind, "dining");
    assert.equal(found.shop, "A&W");
    assert.equal(found.strength, "weak", "two on this account is not enough to tick it");

    const queue = cz.reviewQueue([...past, fresh], { history: cz.payeeHistory(past, { uncategorized }), kinds, uncategorized });
    const item = queue.find((i) => i.transaction.id === fresh.id);
    assert.equal(item.categoryId, "eating-out");
    assert.equal(item.suggestion.source, "kind");
  });

  test("the payee's own history wins over the kind of shop", () => {
    const past = [tx("Starbucks", "coffee"), tx("McDonalds", "eating-out"), tx("A&W", "eating-out")];
    const kinds = cz.kindHistory(past, { uncategorized });
    const fresh = tx("STARBUCKS", null, { approved: false });
    const [item] = cz.reviewQueue([fresh], { history: cz.payeeHistory(past, { uncategorized }), kinds, uncategorized });
    assert.equal(item.categoryId, "coffee");
    assert.notEqual(item.suggestion.source, "kind");
  });

  test("a kind with no history is named but nothing is filled in", () => {
    const fresh = tx("Joe's Pizzeria", null, { approved: false });
    const [item] = cz.reviewQueue([fresh], { history: new Map(), kinds: new Map(), uncategorized });
    assert.equal(item.categoryId, null);
    assert.equal(item.looksLike.kind, "dining");
  });

  test("the last split of a payee is offered as shares", () => {
    const past = [tx("COSTCO WHOLESALE", null, {
      date: "2026-09-01", amount: -100000,
      subtransactions: [
        { category_id: "groceries", amount: -70000, deleted: false },
        { category_id: "household", amount: -30000, deleted: false },
      ],
    })];
    const splits = cz.splitHistory(past);
    const fresh = tx("Costco Wholesale", null, { approved: false, amount: -45670 });
    const [item] = cz.reviewQueue([fresh], { history: new Map(), splits, uncategorized });
    assert.deepEqual(item.lastSplit.legs.map((l) => [l.categoryId, l.share]), [["groceries", 0.7], ["household", 0.3]]);
    const amounts = cz.splitByShares(fresh.amount, item.lastSplit.legs.map((l) => l.share));
    assert.deepEqual(amounts, [-31970, -13700]);
    assert.equal(amounts[0] + amounts[1], fresh.amount);
  });

  test("a shared split finds each person's own version of the category", () => {
    const categories = [
      { id: "shared-groc", name: "Groceries", owner: "shared" },
      { id: "a-groc", name: "Groceries", owner: "p1" },
      { id: "s-groc", name: "\u{1F6D2} Groceries", owner: "p2" },
      { id: "a-fun", name: "Fun money (Alex)", owner: "p1" },
      { id: "s-fun", name: "Fun money (Sam)", owner: "p2" },
      { id: "a-gym", name: "Gym", owner: "p1" },
    ];
    assert.deepEqual(cz.personCategories("shared-groc", categories), { p1: "a-groc", p2: "s-groc" });
    assert.deepEqual(cz.personCategories("a-fun", categories, { names: ["Alex", "Sam"] }), { p1: "a-fun", p2: "s-fun" });
    assert.deepEqual(cz.personCategories("a-gym", categories), { p1: "a-gym", p2: null }, "nothing to match: left to pick");
    assert.deepEqual(cz.personCategories("missing", categories), { p1: null, p2: null });
  });

  test("a split must add up and have a category on every part", () => {
    assert.match(cz.splitProblem(-10000, [{ categoryId: "a", amount: -10000 }]), /two parts/);
    assert.match(cz.splitProblem(-10000, [{ categoryId: "a", amount: -6000 }, { categoryId: null, amount: -4000 }]), /category/);
    assert.match(cz.splitProblem(-10000, [{ categoryId: "a", amount: -6000 }, { categoryId: "b", amount: -3000 }]), /short by \$1\.00/);
    assert.equal(cz.splitProblem(-10000, [{ categoryId: "a", amount: -6000 }, { categoryId: "b", amount: -4000 }]), "");
    assert.match(cz.splitProblem(-9900, [{ categoryId: "a", amount: -50000 }, { categoryId: "b", amount: 40100 }]),
      /more than the whole/, "typing more than the total into one part");
  });

  test("notes and splits go into the update; only notes can be undone", () => {
    const plain = tx("Shop", "food", { approved: false, memo: "old" });
    const toSplit = tx("Costco", null, { approved: false, amount: -10000 });
    const items = [
      { transaction: plain, kind: "normal", categoryId: "food", memo: "new note" },
      { transaction: toSplit, kind: "normal", categoryId: null, memo: "big shop",
        split: [{ categoryId: "groceries", amount: -6000, memo: "" }, { categoryId: "household", amount: -4000, memo: "soap" }] },
    ];
    const { updates, backup, splits } = cz.buildUpdate(items);
    assert.deepEqual(updates, [{ id: plain.id, memo: "new note", approved: true }]);
    assert.equal(backup[0].memo, "old");
    assert.deepEqual(cz.undoUpdate(backup), [{ id: plain.id, category_id: "food", approved: false, memo: "old" }]);
    assert.equal(splits.length, 1);
    assert.equal(splits[0].category_id, null);
    assert.equal(splits[0].approved, true);
    assert.equal(splits[0].memo, "big shop");
    assert.deepEqual(splits[0].subtransactions, [
      { amount: -6000, category_id: "groceries", memo: "" },
      { amount: -4000, category_id: "household", memo: "soap" },
    ]);
  });
});
