// Whose is it - the shared rules behind Home's and Reports' Whose choice.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as own from "../js/tools/ownership.js";

const GROUPS = [
  { id: "img", name: "Internal Master Category", categories: [{ id: "rta", name: "Inflow: Ready to Assign" }, { id: "uncat", name: "Uncategorized" }] },
  { id: "ccp", name: "Credit Card Payments", categories: [{ id: "visapay", name: "(A) Visa" }] },
  { id: "g1", name: "Household", categories: [{ id: "food", name: "Groceries" }, { id: "gas", name: "Gas" }] },
  { id: "g2", name: "Alex Wants", categories: [{ id: "afood", name: "Alex Groceries" }] },
  { id: "g3", name: "Sam Wants", categories: [{ id: "sfood", name: "Sam Groceries" }] },
];
const ACCOUNTS = { visa: "(A) Visa", schq: "(S) Chequing", chq: "Joint Chequing" };
const PEOPLE = { person1Name: "Alex", person2Name: "Sam", person1AccountTag: "A", person2AccountTag: "S" };
const whose = (owner) => own.ownership({ owner, categoryGroups: GROUPS, people: PEOPLE, accountNameOf: (id) => ACCOUNTS[id] });
const t = (id, amount, category_id, account_id, subtransactions = []) =>
  ({ id, amount, category_id, account_id, subtransactions, deleted: false, date: "2026-10-04" });

describe("ownership", () => {
  test("categories by group prefix; YNAB's own categories are nobody's", () => {
    const alex = whose("p1");
    assert.equal(alex.categoryMine("afood"), true);
    assert.equal(alex.categoryMine("food"), false);
    assert.equal(whose("shared").categoryMine("food"), true);
    assert.equal(alex.ownCategory("rta"), false);
    assert.equal(alex.ownCategory("visapay"), false);
  });

  test("accounts by tag; shared means a joint account", () => {
    assert.equal(whose("p1").accountMine("visa"), true);
    assert.equal(whose("p2").accountMine("schq"), true);
    assert.equal(whose("shared").accountMine("chq"), true);
    assert.equal(whose("shared").accountMine("visa"), false);
  });

  test("no category of its own: goes by account", () => {
    assert.equal(whose("p1").transactionMine(t("a", -10, null, "visa")), true);
    assert.equal(whose("p1").transactionMine(t("b", -10, "uncat", "visa")), true);
    assert.equal(whose("shared").transactionMine(t("c", 100, "rta", "chq")), true, "income into the joint account");
    assert.equal(whose("shared").transactionMine(t("d", 100, "rta", "schq")), false);
  });

  test("a split is shared out leg by leg", () => {
    const legs = [{ category_id: "afood", amount: -150 }, { category_id: "sfood", amount: -50 }];
    assert.equal(whose("p1").shareOf(legs, null, "visa"), 0.75);
    assert.equal(whose("p2").shareOf(legs, null, "visa"), 0.25);
    assert.equal(whose("shared").shareOf(legs, null, "visa"), 0);
    assert.equal(whose("all").shareOf(legs, null, "visa"), 1);
  });

  test("a recurring charge's share is across all its charges, an uncategorized one taking the series' category", () => {
    const list = [t("1", -60, "gas", "visa"), t("2", -60, "gas", "visa"), t("3", -60, null, "visa")];
    const item = { key: "shell", categoryId: "gas", transactionIds: ["1", "2", "3"], typical: 60, usual: 60, latest: 60, yearly: 720, priceUp: null };
    assert.deepEqual(own.personRecurring([item], list, whose("p1")), [], "not Alex's, despite his card");
    assert.equal(own.personRecurring([item], list, whose("shared"))[0], item, "all shared: unchanged");
  });

  test("a split recurring charge is scaled to the person's share", () => {
    const legs = [{ category_id: "afood", amount: -100 }, { category_id: "sfood", amount: -100 }];
    const list = [t("1", -200, null, "visa", legs), t("2", -200, null, "visa", legs)];
    const item = { key: "grocer", categoryId: null, transactionIds: ["1", "2"], typical: 200000, usual: 200000, latest: 200000, yearly: 2400000, priceUp: { from: 180000, to: 200000 } };
    const [sam] = own.personRecurring([item], list, whose("p2"));
    assert.equal(sam.share, 0.5);
    assert.equal(sam.typical, 100000);
    assert.equal(sam.fullTypical, 200000);
    assert.deepEqual(sam.priceUp, { from: 90000, to: 100000 });
  });

  test("a person's transactions are only their own legs, never income", () => {
    const legs = [{ category_id: "afood", amount: -100 }, { category_id: "sfood", amount: -100 }];
    const list = [t("1", -200, null, "visa", legs), t("2", 500, "rta", "visa"), t("3", -30, "afood", "schq"), t("4", -40, "food", "visa")];
    const alex = own.personTransactions(list, whose("p1"));
    assert.deepEqual(alex.map((x) => [x.id, x.amount, x.subtransactions.length]), [["1", -100, 1], ["3", -30, 0]]);
    assert.equal(own.personTransactions(list, whose("all")), list);
  });
});
