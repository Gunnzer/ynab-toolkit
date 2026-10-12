import { describe, test } from "node:test";
import assert from "node:assert/strict";

import * as rta from "../js/tools/rta_tracker.js";

describe("rta tracker", () => {
  test("currentMonthString pads a single-digit month", () => {
    assert.equal(rta.currentMonthString(new Date(2026, 2, 15)), "2026-03");
    assert.equal(rta.currentMonthString(new Date(2026, 10, 1)), "2026-11");
  });

  test("monthStartIso", () => {
    assert.equal(rta.monthStartIso("2026-08"), "2026-08-01");
  });

  test("findFlaggedTransactions: backdated, no category, not a split, not a transfer", () => {
    const currentMonthStart = "2026-08-01";
    const transactions = [
      // Flagged: backdated, uncategorized, ordinary transaction.
      { id: "t1", date: "2026-07-28", category_id: null, amount: 250000 },
      // Not flagged: dated in the current month.
      { id: "t2", date: "2026-08-10", category_id: null, amount: 5000 },
      // Not flagged: has a real category.
      { id: "t3", date: "2026-07-01", category_id: "cat-1", amount: -4500 },
      // Not flagged: a split's parent record - category_id is null but the
      // category actually lives on each subtransaction (same trap
      // shared_expenses.js documents).
      {
        id: "t4", date: "2026-07-15", category_id: null, amount: 10000,
        subtransactions: [{ category_id: "cat-1", amount: 5000 }],
      },
      // Not flagged: a transfer, never touches Ready to Assign on its own.
      {
        id: "t5", date: "2026-07-20", category_id: null, amount: 20000,
        transfer_account_id: "acct-2",
      },
      // Not flagged: deleted.
      { id: "t6", date: "2026-07-01", category_id: null, amount: 1000, deleted: true },
    ];

    const flagged = rta.findFlaggedTransactions(transactions, currentMonthStart);
    assert.deepEqual(flagged.map((t) => t.id), ["t1"]);
  });

  test("sumAmount", () => {
    assert.equal(rta.sumAmount([{ amount: 100 }, { amount: -30 }, { amount: 5 }]), 75);
    assert.equal(rta.sumAmount([]), 0);
    assert.equal(rta.sumAmount(undefined), 0);
  });

  test("buildAttribution: fully explained", () => {
    const flagged = [
      { id: "t1", date: "2026-07-28", payee_name: "Employer Inc", amount: 250000 },
    ];
    const result = rta.buildAttribution(250000, flagged);
    assert.equal(result.explained, true);
    assert.match(result.summary, /Fully explained by 1 backdated/);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].payee, "Employer Inc");
  });

  test("buildAttribution: partially explained, says so rather than pretending", () => {
    const flagged = [{ id: "t1", date: "2026-07-28", payee_name: "Employer Inc", amount: 100000 }];
    const result = rta.buildAttribution(250000, flagged);
    assert.equal(result.explained, false);
    assert.match(result.summary, /does not fully account/);
  });

  test("buildAttribution: no flagged transactions but RTA moved", () => {
    const result = rta.buildAttribution(50000, []);
    assert.equal(result.explained, false);
    assert.match(result.summary, /no backdated or uncategorized/);
  });

  test("buildAttribution: no change at all", () => {
    const result = rta.buildAttribution(0, []);
    assert.match(result.summary, /did not change/);
  });

  test("buildAttribution: sorts by size of amount, largest first", () => {
    const flagged = [
      { id: "small", date: "2026-08-01", payee_name: "Small", amount: 1000 },
      { id: "big", date: "2026-08-02", payee_name: "Big", amount: -50000 },
    ];
    const result = rta.buildAttribution(-49000, flagged);
    assert.deepEqual(result.lines.map((l) => l.id), ["big", "small"]);
  });

  test("buildSnapshot: first snapshot has no delta or attribution", () => {
    const snapshot = rta.buildSnapshot({
      month: "2026-08", toBeBudgeted: 100000, previousSnapshot: null,
      deltaTransactions: [], serverKnowledge: 42,
    });
    assert.equal(snapshot.delta, null);
    assert.equal(snapshot.flagged.length, 0);
    assert.match(snapshot.summary, /First snapshot/);
    assert.equal(snapshot.serverKnowledge, 42);
  });

  test("buildSnapshot: computes delta against the previous snapshot and flags", () => {
    const previous = { toBeBudgeted: 100000 };
    const deltaTransactions = [
      { id: "t1", date: "2026-07-28", category_id: null, amount: 50000, payee_name: "Payroll" },
    ];
    const snapshot = rta.buildSnapshot({
      month: "2026-08", toBeBudgeted: 150000, previousSnapshot: previous,
      deltaTransactions, serverKnowledge: 99,
    });
    assert.equal(snapshot.delta, 50000);
    assert.equal(snapshot.flagged.length, 1);
    assert.equal(snapshot.flaggedSum, 50000);
    assert.match(snapshot.summary, /Fully explained/);
  });

  // ---------- reconstruction ----------

  const groups = [
    {
      name: "Internal Master Category",
      categories: [
        { id: "rta", name: "Inflow: Ready to Assign" },
        { id: "uncat", name: "Uncategorized" },
      ],
    },
    { name: "Bills", categories: [{ id: "rent", name: "Rent" }] },
  ];

  test("readyToAssignCategoryIds finds the internal inflow category only", () => {
    assert.deepEqual([...rta.readyToAssignCategoryIds(groups)], ["rta"]);
    assert.deepEqual([...rta.readyToAssignCategoryIds([
      { name: "Internal Master Category", categories: [{ id: "old", name: "To be Budgeted" }] },
    ])], ["old"]);
  });

  test("readyToAssignInflows reads split legs and skips deleted", () => {
    const inflows = rta.readyToAssignInflows([
      { id: "a", date: "2026-02-03", category_id: "rta", amount: 1000, payee_name: "Pay" },
      {
        id: "b", date: "2026-01-20", category_id: null, amount: 3000,
        subtransactions: [
          { category_id: "rta", amount: 2000 },
          { category_id: "rent", amount: 1000 },
        ],
      },
      { id: "c", date: "2026-02-04", category_id: "rta", amount: 5, deleted: true },
    ], new Set(["rta"]));
    assert.deepEqual(inflows.map((i) => [i.id, i.amount, i.splitLeg]),
      [["b", 2000, true], ["a", 1000, false]]);
  });

  const months = [
    { month: "2026-03-01", income: 1000, budgeted: 2000, to_be_budgeted: -500, deleted: false },
    { month: "2026-01-01", income: 3000, budgeted: 2000, to_be_budgeted: 1000, deleted: false },
    { month: "2026-02-01", income: 1000, budgeted: 1500, to_be_budgeted: 500, deleted: false },
    { month: "2026-04-01", income: 2000, budgeted: 0, to_be_budgeted: 1000, deleted: false },
  ];
  const transactions = [
    { id: "p1", date: "2026-01-15", category_id: "rta", amount: 3000 },
    { id: "p2", date: "2026-02-15", category_id: "rta", amount: 1000 },
    { id: "p3", date: "2026-03-15", category_id: "rta", amount: 1000 },
    // April's income is missing from transactions: an income mismatch.
    { id: "u1", date: "2026-03-20", category_id: null, amount: 700 },
  ];

  test("reconstruct finds when Ready to Assign went negative and recovered", () => {
    const result = rta.reconstruct({ months, transactions, rtaIds: new Set(["rta"]) });
    assert.equal(result.deductsLater, false);
    assert.deepEqual(result.rows.map((r) => r.month),
      ["2026-01", "2026-02", "2026-03", "2026-04"]);
    assert.deepEqual(result.rows.map((r) => r.rebuilt), [1000, 500, -500, 1500]);
    assert.equal(result.firstNegative.month, "2026-03");
    assert.equal(result.rows[2].wentNegative, true);
    assert.equal(result.rows[3].recovered, true);
    assert.deepEqual(result.stretches, [{ from: "2026-03", to: "2026-03", lowest: -500 }]);
    assert.equal(result.lowest.month, "2026-03");
    assert.equal(result.currentlyNegative, false);
  });

  test("reconstruct reports unexplained moves as other, per month", () => {
    const result = rta.reconstruct({ months, transactions, rtaIds: new Set(["rta"]) });
    const april = result.rows[3];
    assert.equal(april.otherTotal, -500);
    assert.equal(april.other, -500);
    assert.deepEqual(result.rows.slice(0, 3).map((r) => r.other), [0, 0, 0]);
  });

  test("reconstruct audits income mismatches and uncategorized money", () => {
    const result = rta.reconstruct({ months, transactions, rtaIds: new Set(["rta"]) });
    const kinds = result.findings.map((f) => `${f.month}:${f.kind}`);
    assert.deepEqual(kinds, [
      "2026-03:negative", "2026-03:uncategorized", "2026-04:income", "2026-04:other",
    ]);
    assert.equal(result.rows[2].uncategorizedSum, 700);
  });

  test("reconstruct detects a budget whose figures deduct later assignments", () => {
    const later = [
      { month: "2026-01-01", income: 3000, budgeted: 1000, to_be_budgeted: 1500 },
      { month: "2026-02-01", income: 0, budgeted: 500, to_be_budgeted: 1500 },
    ];
    const result = rta.reconstruct({ months: later, transactions: [], rtaIds: new Set() });
    assert.equal(result.deductsLater, true);
    assert.deepEqual(result.rows.map((r) => [r.assignedLater, r.rebuilt, r.other]),
      [[500, 1500, 0], [0, 1500, 0]]);
  });

  test("an ongoing negative stretch is marked ongoing", () => {
    const result = rta.reconstruct({
      months: months.slice(0, 1).concat([
        { month: "2026-02-01", income: 0, budgeted: 2000, to_be_budgeted: -1000 },
      ]),
      transactions: [],
      rtaIds: new Set(),
    });
    assert.equal(result.currentlyNegative, true);
    assert.equal(result.stretches[0].ongoing, true);
  });

  test("firstNegativeSnapshot and reconstructionCsv", () => {
    assert.equal(rta.firstNegativeSnapshot([
      { timestamp: 1, toBeBudgeted: 5 }, { timestamp: 2, toBeBudgeted: -5 },
      { timestamp: 3, toBeBudgeted: -9 },
    ]).timestamp, 2);
    assert.equal(rta.firstNegativeSnapshot([]), null);

    const result = rta.reconstruct({ months, transactions, rtaIds: new Set(["rta"]) });
    const lines = rta.reconstructionCsv(result.rows).trim().split("\n");
    assert.equal(lines.length, 5);
    assert.equal(lines[3], "2026-03,1.00,1.00,2.00,0.00,-0.50,0.00,-0.50,-1.00,1,0.70");
  });

  // ---------- why it went negative ----------

  const july = { month: "2026-07", income: 500000, assigned: 400000, assignedLater: 0, other: 0, ynab: 100000, change: null };
  const august = { month: "2026-08", income: 300000, assigned: 420000, assignedLater: 0, other: -30000, ynab: -50000, change: -150000 };
  const cat = (id, name, budgeted, balance = 0, group = "Bills") =>
    ({ id, name, budgeted, balance, category_group_name: group });

  function explainAugust(extra = {}) {
    return rta.explainMonth({
      row: august,
      previous: july,
      categories: [
        cat("rta", "Inflow: Ready to Assign", 0, 0, "Internal Master Category"),
        cat("rent", "Rent", 200000), cat("food", "Groceries", 150000),
        cat("fun", "Fun", 70000),
      ],
      previousCategories: [
        cat("rta", "Inflow: Ready to Assign", 0, 0, "Internal Master Category"),
        cat("rent", "Rent", 200000), cat("food", "Groceries", 100000, -30000),
        cat("fun", "Fun", 100000),
      ],
      inflows: [{ payee: "Acme Payroll", amount: 300000 }],
      previousInflows: [
        { payee: "Acme Payroll", amount: 300000 }, { payee: "Side Gig", amount: 200000 },
      ],
      uncategorized: [
        { payee_name: "Side Gig", amount: 200000 }, { payee_name: "Shop", amount: -5000 },
      ],
      ...extra,
    });
  }

  test("explainMonth names the payee that stopped paying in", () => {
    const income = explainAugust().causes.find((c) => c.kind === "income");
    assert.equal(income.amount, -200000);
    assert.match(income.text, /Side Gig \(\$0\.00, was \$200\.00\)/);
  });

  test("explainMonth names the categories assigned more, not less", () => {
    const result = explainAugust();
    assert.deepEqual(result.assignedIncreases.map((c) => [c.name, c.change]), [["Groceries", 50000]]);
    const assigned = result.causes.find((c) => c.kind === "assigned");
    assert.match(assigned.text, /\$20\.00 more than July 2026/);
    assert.match(assigned.text, /Groceries \+\$50\.00/);
    assert.doesNotMatch(assigned.text, /Inflow/);
  });

  test("explainMonth ties other to last month's overspending", () => {
    const result = explainAugust();
    assert.equal(result.overspentSum, -30000);
    const other = result.causes.find((c) => c.kind === "other");
    assert.match(other.text, /Groceries -\$30\.00/);
  });

  test("explainMonth points out uncategorized income that would cover the gap", () => {
    const result = explainAugust();
    assert.equal(result.uncategorizedInflowSum, 200000);
    const last = result.causes[result.causes.length - 1];
    assert.equal(last.kind, "uncategorized");
    assert.match(last.text, /enough to cover the gap/);
  });

  test("explainMonth ranks the biggest pull first and has an exact headline", () => {
    const result = explainAugust();
    assert.deepEqual(result.causes.map((c) => c.kind),
      ["assigned", "income", "other", "uncategorized"]);
    assert.equal(result.headline,
      "Ready to Assign went from $100.00 to -$50.00 (-$150.00).");
  });

  test("explainMonth with no previous month lists the largest assigned amounts", () => {
    const result = explainAugust({ previous: null, previousCategories: [], previousInflows: [] });
    const assigned = result.causes.find((c) => c.kind === "assigned");
    assert.match(assigned.text, /Largest amounts: Rent \$200\.00, Groceries \$150\.00/);
    assert.equal(result.causes.some((c) => c.kind === "income"), false);
  });

  // ---------- line by line ----------

  test("buildLedger runs a balance and marks the line where it ran out", () => {
    const row = { income: 300000, assigned: 380000, other: -30000, ynab: -10000 };
    const previous = { ynab: 100000 };
    const { lines, matches } = rta.buildLedger({
      row, previous,
      categories: [
        cat("rta", "Inflow: Ready to Assign", 0, 0, "Internal Master Category"),
        cat("rent", "Rent", 200000), cat("food", "Groceries", 150000),
        cat("fun", "Fun", 30000), cat("zero", "Unused", 0),
      ],
      inflows: [
        { date: "2026-08-15", payee: "Payroll", amount: 150000 },
        { date: "2026-08-01", payee: "Payroll", amount: 150000 },
      ],
      overspent: [{ name: "Groceries", balance: -30000 }],
    });
    assert.deepEqual(lines.map((l) => [l.kind, l.amount, l.balance]), [
      ["start", 100000, 100000],
      ["other", -30000, 70000],
      ["income", 150000, 220000],
      ["income", 150000, 370000],
      ["assigned", -200000, 170000],
      ["assigned", -150000, 20000],
      ["assigned", -30000, -10000],
    ]);
    assert.equal(lines[2].date, "2026-08-01");
    assert.match(lines[1].detail, /Groceries -\$30\.00/);
    assert.deepEqual(lines.filter((l) => l.wentNegative).map((l) => l.label), ["Fun"]);
    assert.equal(matches, true);
  });

  test("buildLedger adds reconciling lines so it always ends on YNAB's figure", () => {
    const { lines, endBalance } = rta.buildLedger({
      row: { income: 500000, assigned: 100000, other: 0, ynab: 350000 },
      previous: { ynab: 0 },
      categories: [cat("rent", "Rent", 100000)],
      inflows: [{ date: "2026-08-01", payee: "Payroll", amount: 400000 }],
    });
    assert.deepEqual(lines.filter((l) => l.kind === "reconcile").map((l) => l.amount),
      [100000, -50000]);
    assert.equal(endBalance, 350000);
  });

  test("buildLedger flags a recovery and handles the deductsLater model", () => {
    const { lines, endBalance } = rta.buildLedger({
      row: { income: 100000, assigned: 50000, assignedLater: 20000, other: 0, ynab: 50000 },
      previous: { ynab: -50000, assignedLater: 70000 },
      deductsLater: true,
      categories: [cat("rent", "Rent", 50000)],
      inflows: [{ date: "2026-08-01", payee: "Payroll", amount: 100000 }],
    });
    assert.equal(endBalance, 50000);
    assert.equal(lines.some((l) => l.kind === "reconcile"), false);
    assert.equal(lines.find((l) => l.recovered).kind, "later");
  });

  // ---------- by person ----------

  const people = {
    person1Name: "Alex", person2Name: "Sam",
    person1GroupPrefix: "Alex", person2GroupPrefix: "Sam",
    person1AccountTag: "A", person2AccountTag: "S",
  };
  const account = (name, type, balance, extra = {}) =>
    ({ name, type, balance, on_budget: true, closed: false, deleted: false, ...extra });

  function split() {
    return rta.byPerson({
      settings: people,
      accounts: [
        account("(A) Alex Checking", "checking", 1000000),
        account("(A) Alex Visa", "creditCard", -200000),
        account("(S) Sam Checking", "checking", 300000),
        account("Joint Savings", "savings", 500000),
        account("(S) Old", "checking", 999000, { closed: true }),
        account("(S) Brokerage", "otherAsset", 777000, { on_budget: false }),
      ],
      categories: [
        cat("rta", "Inflow: Ready to Assign", 0, 400000, "Internal Master Category"),
        { ...cat("a1", "Alex Fun", 50000, 600000, "Alex Spending") },
        { ...cat("s1", "Sam Fun", 80000, 450000, "Sam Spending") },
        { ...cat("cc", "(A) Alex Visa", 0, 200000, "Credit Card Payments") },
        { ...cat("j1", "Rent", 100000, 500000, "Bills") },
      ],
    });
  }

  test("byPerson splits accounts and categories by owner", () => {
    const { rows } = split();
    const [alex, sam, shared] = rows;
    assert.deepEqual([alex.cash, alex.owed, alex.accounts], [1000000, -200000, 800000]);
    assert.equal(sam.accounts, 300000);
    assert.equal(shared.accounts, 500000);
    assert.equal(alex.available, 800000);
    assert.equal(sam.available, 450000);
    assert.equal(shared.available, 500000);
    assert.deepEqual(rows.map((r) => r.assigned), [50000, 80000, 100000]);
  });

  test("byPerson follows a credit card payment category to its card's owner", () => {
    const [alex] = split().rows;
    assert.ok(alex.categoryList.some((c) => c.name === "(A) Alex Visa"));
  });

  test("byPerson gap shows whose categories hold money their accounts lack", () => {
    const { rows, total } = split();
    assert.deepEqual(rows.map((r) => r.gap), [0, -150000, 0]);
    assert.equal(total.gap, -150000);
    assert.equal(total.accounts - total.available, total.gap);
  });

  // ---------- money movement history ----------

  const rawMovements = [
    { id: "m1", month: "2026-08-01", moved_at: "2026-08-14T15:12:00Z", performed_by_user_id: "u-sam",
      from_category_id: null, to_category_id: "fun", amount: 30000 },
    { id: "m2", month: "2026-08-01", moved_at: "2026-08-01T09:00:00Z", performed_by_user_id: "u-alex",
      from_category_id: null, to_category_id: "rent", amount: 200000 },
    { id: "m3", month: "2026-08-01", moved_at: "2026-08-02T09:00:00Z", performed_by_user_id: "u-alex",
      from_category_id: "rta", to_category_id: "food", amount: 150000 },
    // Between two ordinary categories: Ready to Assign does not move.
    { id: "m4", month: "2026-08-01", moved_at: "2026-08-03T09:00:00Z", performed_by_user_id: "u-sam",
      from_category_id: "food", to_category_id: "fun", amount: 5000 },
    // Moved back into Ready to Assign.
    { id: "m5", month: "2026-08-01", moved_at: "2026-08-20T09:00:00Z", performed_by_user_id: "u-sam",
      from_category_id: "fun", to_category_id: null, amount: 10000 },
  ];
  const names = { fun: "Fun", rent: "Rent", food: "Groceries" };
  const mapped = () => rta.readyToAssignMovements(rawMovements, {
    rtaIds: new Set(["rta"]),
    categoryName: (id) => names[id],
    whoName: (id) => (id === "u-alex" ? "You" : "Other member"),
  });

  test("readyToAssignMovements keeps only moves in or out of Ready to Assign, in time order", () => {
    assert.deepEqual(mapped().map((m) => [m.category, m.effect, m.who]), [
      ["Rent", -200000, "You"],
      ["Groceries", -150000, "You"],
      ["Fun", -30000, "Other member"],
      ["Fun", 10000, "Other member"],
    ]);
  });

  test("assignedByWho totals each person's net assigning", () => {
    assert.deepEqual(rta.assignedByWho(mapped()).map((w) => [w.who, w.assigned, w.count]),
      [["You", 350000, 2], ["Other member", 20000, 2]]);
  });

  test("buildLedger with history interleaves income and assignments by time", () => {
    const { lines, timed, matches } = rta.buildLedger({
      // 30.00 more assigned than the history records: shown, not hidden.
      row: { income: 300000, assigned: 400000, other: 0, ynab: -100000 },
      previous: { ynab: 0 },
      categories: [],
      inflows: [
        { date: "2026-08-15", payee: "Payroll", amount: 150000 },
        { date: "2026-08-01", payee: "Payroll", amount: 150000 },
      ],
      movements: mapped(),
    });
    assert.equal(timed, true);
    assert.equal(matches, true);
    assert.deepEqual(lines.map((l) => [l.kind, l.label, l.balance]), [
      ["start", "Left over from last month", 0],
      ["reconcile", "Assigned with no record (before YNAB kept history, or since undone)", -30000],
      ["income", "Payroll", 120000],
      ["movement", "Rent", -80000],
      ["movement", "Groceries", -230000],
      ["movement", "Fun", -260000],
      ["income", "Payroll", -110000],
      ["movement", "Fun", -100000],
    ]);
  });

  test("buildLedger marks the exact assignment, and who made it, that took it negative", () => {
    const { lines, matches } = rta.buildLedger({
      row: { income: 300000, assigned: 370000, other: 0, ynab: -70000 },
      previous: { ynab: 0 },
      categories: [],
      inflows: [{ date: "2026-08-01", payee: "Payroll", amount: 300000 }],
      movements: mapped(),
    });
    assert.equal(matches, true);
    assert.deepEqual(lines.map((l) => [l.kind, l.label, l.balance]), [
      ["start", "Left over from last month", 0],
      ["income", "Payroll", 300000],
      ["movement", "Rent", 100000],
      ["movement", "Groceries", -50000],
      ["movement", "Fun", -80000],
      ["movement", "Fun", -70000],
    ]);
    const crossing = lines.find((l) => l.wentNegative);
    assert.deepEqual([crossing.label, crossing.who, crossing.at],
      ["Groceries", "You", "2026-08-02T09:00:00Z"]);
  });

  test("explainMonth says who assigned what", () => {
    const result = explainAugust({ movements: mapped() });
    const kinds = result.causes.map((c) => c.kind);
    assert.equal(kinds[kinds.indexOf("assigned") + 1], "who");
    assert.match(result.causes.find((c) => c.kind === "who").text,
      /You \$350\.00 \(2 moves\), Other member \$20\.00 \(2 moves\)/);
  });
});
