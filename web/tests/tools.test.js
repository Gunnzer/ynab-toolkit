// Ported from the Python suite. Run with: node --test web/tests
import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { fmt, fromMilliunits, splitMilliunits, toMilliunits } from "../js/money.js";
import * as shared from "../js/tools/shared_expenses.js";
import * as autoassign from "../js/tools/autoassign.js";
import * as duplicates from "../js/tools/duplicates.js";
import * as bank from "../js/tools/bank_convert.js";
import * as sheet from "../js/tools/split_sheet.js";
import { CATEGORY_GROUPS, TRANSACTIONS } from "./fixtures/test_budget.js";

describe("money", () => {
  test("round trip", () => {
    assert.equal(toMilliunits("12.34"), 12340);
    assert.equal(toMilliunits(-5), -5000);
    assert.equal(fromMilliunits(12340), 12.34);
    assert.equal(fmt(-12340), "-$12.34");
  });

  test("splitting never loses a milliunit", () => {
    for (const total of [-104350, 100000, 33333, -1, 0, 7]) {
      const [a, b] = splitMilliunits(total, 0.35);
      assert.equal(a + b, total, `total ${total} was not preserved`);
    }
  });

  test("matches the original arithmetic", () => {
    // splitter3.py: bailey = round(total * 0.35); alex = total - bailey
    const total = -123456;
    const [bailey, alex] = splitMilliunits(total, 0.35);
    assert.equal(bailey, Math.round(total * 0.35));
    assert.equal(alex, total - bailey);
  });
});

describe("bank import", () => {
  const settings = {
    dateColumn: "Transfer date", payeeColumn: "Description",
    amountColumn: "Amount", memoColumn: "", outflowColumn: "",
    inflowColumn: "", dateFormat: "yyyy-MM-dd", invertAmount: false,
    payeeRules: [
      {
        enabled: true, label: "received",
        pattern: "^\\s*interac\\s*e[-\\u2010-\\u2015\\u2212]?transfer\\s+" +
          "received\\s+from\\s*:?\\s*(?<name>[A-Za-z][A-Za-z .'-]+)",
        replacement: "E-Transfer from $<name>", titleCase: true, cleanName: true,
      },
    ],
  };

  test("amount parsing", () => {
    const cases = [
      ["$1,234.56", 1234.56], ["1.234,56", 1234.56], ["-45.00", -45],
      ["(45.00)", -45], ["", 0], ["12", 12],
    ];
    for (const [raw, expected] of cases) {
      assert.equal(bank.parseAmount(raw).value, expected, `input ${raw}`);
    }
  });

  test("date parsing keeps unparseable values", () => {
    // 15 cannot be a month, so this resolves either way.
    assert.deepEqual(bank.parseDate("15/03/2025"), { value: "2025-03-15", ok: true });
    assert.deepEqual(bank.parseDate("2025-03-15"), { value: "2025-03-15", ok: true });
    assert.deepEqual(bank.parseDate("5 Mar 2025"), { value: "2025-03-05", ok: true });
    // Ambiguous dates default to month first, matching the PowerShell
    // original, which parsed with InvariantCulture.
    assert.deepEqual(bank.parseDate("03/05/2025"), { value: "2025-03-05", ok: true });
    assert.deepEqual(bank.parseDate("03/05/2025", "yyyy-MM-dd", { dateOrder: bank.DAY_FIRST }),
      { value: "2025-05-03", ok: true });
    assert.deepEqual(bank.parseDate("03-05-2025"), { value: "2025-03-05", ok: true });
    assert.deepEqual(bank.parseDate("not a date"),
      { value: "not a date", ok: false });
  });

  test("e-transfer payee rules", () => {
    const { compiled, errors } = bank.compileRules(settings.payeeRules);
    assert.deepEqual(errors, []);

    let result = bank.applyPayeeRules(
      "INTERAC e-Transfer received from: JANE DOE - REF12345", compiled);
    assert.equal(result.changed, true);
    assert.equal(result.payee, "E-Transfer from Jane Doe");

    result = bank.applyPayeeRules("TIM HORTONS #123", compiled);
    assert.equal(result.changed, false);
    assert.equal(result.payee, "TIM HORTONS #123");
  });

  test("end to end, and nothing is written", () => {
    const text = "Transfer date,Description,Amount\n" +
      "2025-03-01,INTERAC e-Transfer received from: SAM B,$500.00\n" +
      "2025-03-02,Hydro One,-84.21\n";
    const parsed = bank.parseDelimited(text);
    const result = bank.convert(parsed, settings);

    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].Payee, "E-Transfer from Sam B");
    assert.equal(result.rows[0].Amount, "500.00");
    assert.equal(result.rows[1].Payee, "Hydro One");
    assert.equal(result.rows[1].Amount, "-84.21");

    const csv = bank.toCsv(result.rows);
    assert.ok(csv.startsWith("Date,Payee,Memo,Amount"));
    assert.ok(csv.includes("E-Transfer from Sam B"));
  });

  test("quoted fields containing the delimiter", () => {
    const { headers, rows } = bank.parseDelimited(
      'Date,Description,Amount\n2025-01-01,"SHOP, THE",-4.50\n');
    assert.deepEqual(headers, ["Date", "Description", "Amount"]);
    assert.equal(rows[0].Description, "SHOP, THE");
  });

  test("a bad mapping names the columns that exist", () => {
    const parsed = bank.parseDelimited("Posted,Details,Value\n2025-01-01,Coffee,-4.50\n");
    assert.throws(() => bank.convert(parsed, settings), /Posted/);
  });

  test("column guessing", () => {
    const guess = bank.guessColumns(["Date", "Description", "Amount", "Balance"]);
    assert.equal(guess.dateColumn, "Date");
    assert.equal(guess.payeeColumn, "Description");
    assert.equal(guess.amountColumn, "Amount");
  });

  test("converted rows carry an ISO date regardless of the display format", () => {
    const text = "Transfer date,Description,Amount\n03/05/2025,Coffee,-4.50\n";
    const parsed = bank.parseDelimited(text);
    const result = bank.convert(parsed, { ...settings, dateFormat: "MM/dd/yyyy" });
    assert.equal(result.rows[0].Date, "03/05/2025");
    assert.equal(result.rows[0].ISODate, "2025-03-05");
  });

  test("YNAB transactions get milliunits and a stable, deduping import_id", () => {
    const rows = [
      { Date: "2025-03-05", Payee: "Coffee", Memo: "", Amount: "-4.50", ISODate: "2025-03-05" },
      { Date: "2025-03-05", Payee: "Coffee", Memo: "", Amount: "-4.50", ISODate: "2025-03-05" },
    ];
    const [first, second] = bank.toYnabTransactions(rows, "acct-1");
    assert.equal(first.account_id, "acct-1");
    assert.equal(first.date, "2025-03-05");
    assert.equal(first.amount, -4500);
    assert.equal(first.import_id, "YNAB:-4500:2025-03-05:1");
    // Same day, same amount, second occurrence: the counter must bump so
    // a real repeated charge is not mistaken for a re-import of the first.
    assert.equal(second.import_id, "YNAB:-4500:2025-03-05:2");
  });

  test("undoPush deletes exactly the ids it was given, and reports failures", async () => {
    const deleted = [];
    const client = {
      async deleteTransaction(budgetId, id) {
        if (id === "bad") throw new Error("already deleted");
        deleted.push([budgetId, id]);
      },
    };
    const result = await bank.undoPush(client, "budget-1", ["t1", "bad", "t2"]);
    assert.deepEqual(result, { deleted: 2, failed: 1 });
    assert.deepEqual(deleted, [["budget-1", "t1"], ["budget-1", "t2"]]);
  });

  test("undoPush stops early when shouldStop says to", async () => {
    const deleted = [];
    const client = { async deleteTransaction(_b, id) { deleted.push(id); } };
    const result = await bank.undoPush(client, "budget-1", ["t1", "t2", "t3"], {
      shouldStop: () => deleted.length >= 1,
    });
    assert.deepEqual(deleted, ["t1"]);
    assert.equal(result.deleted, 1);
  });
});

describe("shared expenses", () => {
  const rule = {
    sharedId: "shared1", name: "Groceries",
    person1Id: "p1cat", person2Id: "p2cat",
  };
  const transactions = () => [
    { id: "t1", date: "2025-03-01", amount: -100000, category_id: "shared1",
      account_id: "a1", cleared: "cleared", approved: true, memo: "x",
      subtransactions: [] },
    { id: "t2", date: "2025-03-02", amount: -50000, category_id: "other",
      account_id: "a1", cleared: "cleared", approved: true, subtransactions: [] },
    { id: "t3", date: "2031-01-01", amount: -50000, category_id: "shared1",
      account_id: "a1", cleared: "cleared", approved: true, subtransactions: [] },
    { id: "t4", date: "2025-03-03", amount: -20000, category_id: "shared1",
      account_id: "a1", cleared: "cleared", approved: true,
      subtransactions: [{ amount: -20000 }] },
  ];

  test("scan filters by rule, date and split state", () => {
    const result = shared.scan(
      transactions(), [rule], "2025-01-01", "2030-12-31", 0.35);
    assert.deepEqual(result.planned.map((p) => p.transaction.id), ["t1"]);
    assert.equal(result.skippedAlreadySplit, 1);
  });

  test("transfers are skipped", () => {
    const items = transactions();
    items[0].transfer_account_id = "acct";
    const result = shared.scan(items, [rule], "2025-01-01", "2030-12-31", 0.35);
    assert.equal(result.skippedTransfers, 1);
    assert.equal(result.planned.length, 0);
  });

  test("the split payload preserves the total", () => {
    const result = shared.scan(
      transactions(), [rule], "2025-01-01", "2030-12-31", 0.35);
    const item = result.planned[0];
    const payload = shared.splitPayload(
      item.transaction, item.person1Amount, item.person2Amount,
      rule.person1Id, rule.person2Id);

    assert.equal(payload.category_id, null);
    assert.equal(payload.amount, -100000);
    const subs = payload.subtransactions;
    assert.equal(subs.reduce((sum, s) => sum + s.amount, 0), -100000);
    assert.equal(subs[0].amount, -35000);
    assert.equal(subs[1].amount, -65000);
    assert.equal(subs[0].category_id, "p1cat");
  });

  test("restore recreates a single-category transaction with the original details", () => {
    const payload = shared.restoreCreatePayload(
      shared.backupRecord(transactions()[0]));
    assert.equal(payload.category_id, "shared1");
    assert.equal(payload.amount, -100000);
    assert.ok(!("subtransactions" in payload));
    assert.ok(!("id" in payload));
  });

  test("drift check drops transactions changed since the preview", () => {
    const planned = shared.scan(
      transactions(), [rule], "2025-01-01", "2030-12-31", 0.35).planned;

    const edited = transactions();
    edited[0] = { ...edited[0], amount: -111000 };
    const { stillValid, drifted } = shared.driftCheck(
      planned, edited, "2025-01-01", "2030-12-31");

    assert.equal(stillValid.length, 0);
    assert.equal(drifted.length, 1);
    assert.equal(drifted[0].reason, "amount changed");
  });

  test("apply writes splits and records a backup", async () => {
    const puts = [];
    const client = {
      async updateTransaction(_budget, id, transaction) {
        puts.push([id, transaction]);
        return transaction;
      },
    };
    const planned = shared.scan(
      transactions(), [rule], "2025-01-01", "2030-12-31", 0.35).planned;
    const backups = [];

    const { changed, failed, applied } = await shared.applySplits(
      client, "b", planned, backups);

    assert.deepEqual([changed, failed], [1, 0]);
    assert.equal(backups.length, 1);
    assert.equal(backups[0].categoryId, "shared1");
    // The exact items written, not just a count - what a "last applied"
    // review would show.
    assert.equal(applied.length, 1);
    assert.equal(applied[0].transaction.id, planned[0].transaction.id);

    const undoClient = {
      async deleteTransaction() { return {}; },
      async createTransactions(_budget, txns) {
        return { transaction_ids: txns.map((_t, i) => `new-${i}`) };
      },
    };
    const undo = await shared.undoFromBackup(undoClient, "b", backups);
    assert.equal(undo.restored, 1);
    assert.deepEqual(undo.remaining, []);
    assert.equal(undo.restoredRecords[0].newId, "new-0");
  });

  test("undo can restore a subset and keeps the rest", async () => {
    const client = {
      async deleteTransaction() { return {}; },
      async createTransactions() { return { transaction_ids: ["newid"] }; },
    };
    const backups = [
      { id: "t1", date: "2025-03-01", amount: -1000, categoryId: "c1" },
      { id: "t2", date: "2025-03-02", amount: -2000, categoryId: "c1" },
    ];
    const result = await shared.undoFromBackup(client, "b", backups, { ids: ["t2"] });
    assert.equal(result.restored, 1);
    assert.deepEqual(result.remaining.map((r) => r.id), ["t1"]);
  });
});

describe("auto assign", () => {
  const month = (holdingBalance = 100000) => [
    { id: "hold", name: "Holding", category_group_id: "gX",
      balance: holdingBalance, budgeted: holdingBalance, sort_order: 0,
      goal_type: null },
    { id: "c1", name: "Rent", category_group_id: "needs", balance: 0,
      budgeted: 10000, sort_order: 0, goal_type: "NEED", goal_target: 50000,
      goal_under_funded: 40000 },
    { id: "c2", name: "Food", category_group_id: "needs", balance: 0,
      budgeted: 0, sort_order: 1, goal_type: "NEED", goal_target: 30000,
      goal_under_funded: 30000 },
    { id: "c3", name: "Fun", category_group_id: "wants", balance: 0,
      budgeted: 0, sort_order: 0, goal_type: "NEED", goal_target: 90000,
      goal_under_funded: 90000 },
    { id: "c4", name: "No target", category_group_id: "wants", balance: 0,
      budgeted: 0, sort_order: 1, goal_type: null },
  ];

  test("priority order and exhaustion", () => {
    const plan = autoassign.buildPlan(month(), ["needs", "wants"], "hold");
    assert.deepEqual(plan.allocations.map((a) => a.categoryId), ["c1", "c2", "c3"]);
    assert.deepEqual(plan.allocations.map((a) => a.amount), [40000, 30000, 30000]);
    assert.equal(plan.totalAllocated, 100000);
    assert.equal(plan.remaining, 0);
  });

  test("group order is respected", () => {
    const plan = autoassign.buildPlan(month(), ["wants", "needs"], "hold");
    assert.equal(plan.allocations[0].categoryId, "c3");
  });

  test("categories without targets are skipped", () => {
    const plan = autoassign.buildPlan(month(), ["needs", "wants"], "hold");
    assert.ok(!plan.allocations.some((a) => a.categoryId === "c4"));
  });

  test("an empty holding category does nothing", () => {
    const plan = autoassign.buildPlan(month(0), ["needs"], "hold");
    assert.equal(plan.allocations.length, 0);
    assert.match(plan.reason, /empty/i);
  });

  test("target basis reproduces the original arithmetic", () => {
    const plan = autoassign.buildPlan(month(), ["needs"], "hold",
      { basis: autoassign.BASIS_TARGET });
    assert.equal(plan.allocations[0].amount, 50000 - 10000);
  });

  test("backup round trip restores previous amounts", async () => {
    const plan = autoassign.buildPlan(month(), ["needs"], "hold");
    const backup = autoassign.makeBackup("2026-03", plan, "hold");
    assert.equal(backup.categories[0].budgeted, 10000);
    assert.equal(backup.holdingBudgeted, 100000);

    const writes = [];
    const client = {
      async updateMonthCategory(_b, _m, id, budgeted) { writes.push([id, budgeted]); },
    };
    const result = await autoassign.undoFromBackup(client, "b", backup);
    assert.equal(result.failed, 0);
    assert.ok(writes.some(([id, value]) => id === "c1" && value === 10000));
    assert.ok(writes.some(([id, value]) => id === "hold" && value === 100000));
  });
});

describe("duplicates", () => {
  const txn = (id, date, amount, payee, extra = {}) => ({
    id, date, amount, payee_name: payee, account_id: "a1",
    cleared: "cleared", approved: true, deleted: false, ...extra,
  });

  test("finds a same day duplicate", () => {
    const groups = duplicates.find([
      txn("1", "2026-03-01", -12500, "Corner Store"),
      txn("2", "2026-03-01", -12500, "Corner Store"),
      txn("3", "2026-03-01", -900, "Coffee Shop"),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].extras.map((t) => t.id), ["2"]);
  });

  test("respects the day window", () => {
    const pair = [
      txn("1", "2026-03-01", -5000, "Streaming"),
      txn("2", "2026-03-09", -5000, "Streaming"),
    ];
    assert.equal(duplicates.find(pair, { withinDays: 3 }).length, 0);
    assert.equal(duplicates.find(pair, { withinDays: 10 }).length, 1);
  });

  test("payee noise is ignored", () => {
    const groups = duplicates.find([
      txn("1", "2026-03-01", -4200, "FUEL STOP #1234"),
      txn("2", "2026-03-02", -4200, "Fuel Stop 1234"),
    ]);
    assert.equal(groups.length, 1);
  });

  test("different amounts, transfers, zeros and deletions are ignored", () => {
    assert.equal(duplicates.find([
      txn("1", "2026-03-01", -4200, "Shop"),
      txn("2", "2026-03-01", -4300, "Shop"),
    ]).length, 0);

    assert.equal(duplicates.find([
      txn("1", "2026-03-01", -100, "Move", { transfer_account_id: "x" }),
      txn("2", "2026-03-01", -100, "Move", { transfer_account_id: "x" }),
      txn("3", "2026-03-01", 0, "Zero"),
      txn("4", "2026-03-01", 0, "Zero"),
      txn("5", "2026-03-01", -100, "Shop"),
      txn("6", "2026-03-01", -100, "Shop", { deleted: true }),
    ]).length, 0);
  });

  test("same account option", () => {
    const pair = [
      txn("1", "2026-03-01", -100, "Shop", { account_id: "a1" }),
      txn("2", "2026-03-01", -100, "Shop", { account_id: "a2" }),
    ];
    assert.equal(duplicates.find(pair).length, 1);
    assert.equal(duplicates.find(pair, { requireSameAccount: true }).length, 0);
  });

  test("flagging sets the colour and never deletes", async () => {
    const puts = [];
    const client = {
      async updateTransaction(_b, _id, transaction) { puts.push(transaction); },
    };
    const result = await duplicates.flagTransactions(
      client, "b", [txn("1", "2026-03-01", -100, "Shop")], "red");

    assert.deepEqual([result.flagged, result.failed], [1, 0]);
    assert.equal(puts[0].flag_color, "red");
    assert.equal(puts[0].amount, -100);
    assert.ok(!("subtransactions" in puts[0]));
  });
});

// Exercises real tools against the fake budget in tests/fixtures/test_budget.js
// instead of a one-off inline fixture, so these scenarios stay realistic and
// shared across whatever else ends up testing against the same budget.
describe("fake budget: bill splitting", () => {
  const settings = {
    person1GroupPrefix: "Alex", person1Name: "Alex",
    person2GroupPrefix: "Sam", person2Name: "Sam",
    person1AccountTag: "A", person2AccountTag: "S",
    codes: { person1: "P1", person2: "P2", shared: "S", custom: "C" },
  };

  function groupNameFor(categoryId) {
    for (const group of CATEGORY_GROUPS) {
      if (group.categories.some((c) => c.id === categoryId)) return group.name;
    }
    return "";
  }

  test("every transfer leg and bare inflow is skipped, nothing else is", () => {
    const { items, skippedTransfers, skippedIncome } =
      sheet.fromApi(TRANSACTIONS, groupNameFor, settings);
    const isBareInflow = (t) =>
      !(t.subtransactions || []).length && (t.amount || 0) > 0;
    const expectedTransfers = TRANSACTIONS.filter(
      (t) => !t.deleted && t.transfer_account_id).length;
    const expectedIncome = TRANSACTIONS.filter(
      (t) => !t.deleted && !t.transfer_account_id && isBareInflow(t)).length;
    const expectedItems = TRANSACTIONS.filter(
      (t) => !t.deleted && !t.transfer_account_id && !isBareInflow(t)).length;
    assert.equal(skippedTransfers, expectedTransfers);
    assert.equal(skippedIncome, expectedIncome);
    assert.equal(items.length, expectedItems);
  });

  test("the split Costco transaction becomes one row with two parts", () => {
    const { items } = sheet.fromApi(TRANSACTIONS, groupNameFor, settings);
    const costco = items.find((item) => item.payee === "Costco Wholesale");
    assert.ok(costco);
    assert.equal(costco.parts.length, 2);
    // Groceries is a shared category (no group prefix), Personal Care is
    // Alex's. The raw owner is kept as "shared" here, not folded onto
    // person 1 - buildRows() is what divides a shared part by ratio.
    assert.deepEqual(costco.parts.map((p) => p.owner), ["shared", "p1"]);
    const total = costco.parts.reduce((sum, p) => sum + p.amount, 0);
    assert.ok(Math.abs(total - 212.18) < 0.001);
  });

  test("a split's shared part is divided by ratio, not credited whole to person 1", () => {
    const { items } = sheet.fromApi(TRANSACTIONS, groupNameFor, settings);
    const costco = items.find((item) => item.payee === "Costco Wholesale");
    const [row] = sheet.buildRows([costco], settings);

    // Groceries ($180.18, shared, split 50/50 with no ratio preset
    // configured) plus Personal Care ($32.00, wholly Alex's/p1):
    // paid1 = 32 + 90.09 = 122.09, paid2 = 90.09 - a genuine one-off mix,
    // not the 100%-to-Alex result the old fold-to-p1 behaviour produced.
    assert.ok(Math.abs(row.Share1 - 122.09) < 0.01, row.Share1);
    assert.ok(Math.abs(row.Share2 - 90.09) < 0.01, row.Share2);
    assert.equal(row.Owner, "C");
  });

  test("the joint savings account with no tag falls back to shared", () => {
    assert.equal(sheet.accountTag("Emergency Savings"), "");
    assert.equal(
      sheet.ownerOf("Shared Bills", "Emergency Savings", settings), "shared");
  });
});

describe("fake budget: duplicates", () => {
  test("the same-day gas station charge on two cards is flagged", () => {
    const groups = duplicates.find(TRANSACTIONS);
    const gasGroup = groups.find((g) => g.transactions[0].payee_name.includes("Shell"));
    assert.ok(gasGroup, "expected the Shell Gas Station pair to be found");
    assert.equal(gasGroup.transactions.length, 2);
    assert.equal(gasGroup.amount, -52000);
  });

  test("same-account-only mode drops the cross-card pair", () => {
    const groups = duplicates.find(TRANSACTIONS, { requireSameAccount: true });
    assert.ok(!groups.some((g) => g.transactions[0].payee_name.includes("Shell")));
  });

  test("deleted and transfer transactions are never candidates", () => {
    const groups = duplicates.find(TRANSACTIONS, { ignoreTransfers: true });
    const flagged = groups.flatMap((g) => g.transactions);
    assert.ok(!flagged.some((t) => t.deleted));
    assert.ok(!flagged.some((t) => t.transfer_account_id));
  });
});
