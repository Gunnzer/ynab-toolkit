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
      { id: "a", category_id: null, approved: false });

    const all = cz.buildUpdate(queue, { approveUncategorized: true });
    assert.deepEqual(all.updates.find((u) => u.id === "d"), { id: "d", approved: true });
  });
});
