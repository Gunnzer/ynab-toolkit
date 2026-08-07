// Sanity checks on the fake budget itself (web/tests/fixtures/test_budget.js).
// Not testing app logic - just guarding the fixture's own referential
// integrity, so a future edit to it (add a transaction, rename a category)
// gets caught here instead of surfacing as a confusing failure in an
// unrelated test that happens to use it.
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  ACCOUNTS, BUDGET, CATEGORY_GROUPS, MONTHS, MONTH_KEYS, PLANNED_AMOUNTS,
  TRANSACTIONS,
} from "./fixtures/test_budget.js";

describe("fake budget fixture", () => {
  const categoryIds = new Set(
    CATEGORY_GROUPS.flatMap((g) => g.categories.map((c) => c.id)));
  const accountIds = new Set(ACCOUNTS.map((a) => a.id));

  test("budget has the fields the app actually reads", () => {
    assert.ok(BUDGET.id);
    assert.ok(BUDGET.first_month < BUDGET.last_month);
    assert.equal(BUDGET.currency_format.currency_symbol, "$");
  });

  test("every account has a unique id and a plausible type", () => {
    const types = new Set(["checking", "savings", "creditCard"]);
    assert.equal(accountIds.size, ACCOUNTS.length, "account ids collide");
    for (const account of ACCOUNTS) assert.ok(types.has(account.type), account.name);
    // The fixture promises one closed account exists, for filter tests.
    assert.equal(ACCOUNTS.filter((a) => a.closed).length, 1);
  });

  test("every category belongs to a real group, ids are unique", () => {
    const seen = new Set();
    for (const group of CATEGORY_GROUPS) {
      for (const category of group.categories) {
        assert.equal(category.category_group_id, group.id);
        assert.ok(!seen.has(category.id), `duplicate category id ${category.id}`);
        seen.add(category.id);
      }
    }
    // The fixture promises a hidden group with a hidden category exists.
    assert.ok(CATEGORY_GROUPS.some((g) => g.hidden));
    assert.ok(CATEGORY_GROUPS.some((g) => g.categories.some((c) => c.hidden)));
  });

  test("every month covers exactly the categories that exist", () => {
    assert.deepEqual(Object.keys(MONTHS).sort(), [...MONTH_KEYS].sort());
    for (const [key, month] of Object.entries(MONTHS)) {
      assert.equal(month.month, `${key}-01`);
      const monthCategoryIds = month.categories.map((c) => c.id).sort();
      assert.deepEqual(monthCategoryIds, [...categoryIds].sort(), key);
      for (const category of month.categories) {
        // balance is defined as budgeted + activity throughout this fixture.
        assert.equal(category.balance, category.budgeted + category.activity,
          `${key} ${category.name}`);
      }
    }
  });

  test("goal-tracked categories carry consistent goal figures", () => {
    for (const month of Object.values(MONTHS)) {
      for (const category of month.categories) {
        if (!category.goal_type) continue;
        assert.ok(category.goal_target > 0);
        assert.equal(category.goal_under_funded,
          Math.max(0, category.goal_target - category.goal_overall_funded));
      }
    }
  });

  test("every transaction points at a real account, and a real category when it has one", () => {
    for (const transaction of TRANSACTIONS) {
      assert.ok(accountIds.has(transaction.account_id), transaction.id);
      if (transaction.category_id) {
        assert.ok(categoryIds.has(transaction.category_id), transaction.id);
      }
      if (transaction.transfer_account_id) {
        assert.ok(accountIds.has(transaction.transfer_account_id), transaction.id);
      }
      for (const sub of transaction.subtransactions || []) {
        assert.ok(categoryIds.has(sub.category_id), sub.id);
      }
    }
  });

  test("transfer pairs reference each other and net to zero", () => {
    const byId = new Map(TRANSACTIONS.map((t) => [t.id, t]));
    const legs = TRANSACTIONS.filter((t) => t.transfer_account_id);
    assert.ok(legs.length > 0 && legs.length % 2 === 0);
    for (const leg of legs) {
      const mirror = byId.get(leg.transfer_transaction_id);
      assert.ok(mirror, `${leg.id} points at a missing transfer leg`);
      assert.equal(mirror.transfer_transaction_id, leg.id);
      assert.equal(mirror.amount, -leg.amount, leg.id);
      assert.equal(mirror.account_id, leg.transfer_account_id, leg.id);
    }
  });

  test("split transaction's subtransactions sum to the parent amount", () => {
    const splits = TRANSACTIONS.filter((t) => (t.subtransactions || []).length);
    assert.ok(splits.length > 0);
    for (const parent of splits) {
      const sum = parent.subtransactions.reduce((total, sub) => total + sub.amount, 0);
      assert.equal(sum, parent.amount, parent.id);
    }
  });

  test("the near-duplicate pair normalises to the same payee", () => {
    const gas = TRANSACTIONS.filter((t) => t.id.startsWith("txn-2026-06-15-gas"));
    assert.equal(gas.length, 2);
    assert.equal(gas[0].amount, gas[1].amount);
    assert.equal(gas[0].date, gas[1].date);
    assert.notEqual(gas[0].account_id, gas[1].account_id);
  });

  test("planned amounts only reference real categories", () => {
    for (const id of Object.keys(PLANNED_AMOUNTS)) {
      assert.ok(categoryIds.has(id), id);
    }
  });
});
