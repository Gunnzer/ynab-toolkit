// Bill Splitting. Test data uses generic names and a 65/35 ratio purely
// because uneven ratios are the interesting case.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as sheet from "../js/tools/split_sheet.js";

const SETTINGS = {
  person1Name: "Alex",
  person2Name: "Sam",
  person1AccountTag: "A",
  person2AccountTag: "S",
  codes: { person1: "P1", person2: "P2", custom: "C" },
  defaultSharedCode: "SH",
  ratioPresets: [
    { code: "SH", person1Percent: 65 },
    { code: "HALF", person1Percent: 50 },
    { code: "P1HEAVY", person1Percent: 75 },
  ],
  tolerance: 0.02,
  skipPayeeSubstrings: ["interest"],
};

describe("owner detection", () => {
  test("the category group decides", () => {
    assert.equal(sheet.ownerOf("Alex Wants", "", SETTINGS), "p1");
    assert.equal(sheet.ownerOf("Sam Needs", "", SETTINGS), "p2");
    assert.equal(sheet.ownerOf("Household", "", SETTINGS), "shared");
  });

  test("a group naming neither person is shared, not the payer's", () => {
    // The account tag must not override a group that is present.
    assert.equal(sheet.ownerOf("Groceries", "(A) Chequing", SETTINGS), "shared");
  });

  test("the account tag only applies when there is no group", () => {
    assert.equal(sheet.ownerOf("", "(A) Chequing", SETTINGS), "p1");
    assert.equal(sheet.ownerOf("", "(S) Visa", SETTINGS), "p2");
    assert.equal(sheet.ownerOf("", "Joint Chequing", SETTINGS), "shared");
  });

  test("an unset tag never matches", () => {
    const settings = { ...SETTINGS, person1AccountTag: "", person2AccountTag: "" };
    assert.equal(sheet.ownerOf("", "() Chequing", settings), "shared");
  });

  test("tags are read and stripped", () => {
    assert.equal(sheet.accountTag("(J) Scotia Chequing"), "J");
    assert.equal(sheet.accountTag("Scotia Chequing"), "");
    assert.equal(sheet.stripAccountTag("(J) Scotia Chequing"), "Scotia Chequing");
    assert.equal(sheet.stripAccountTag("Scotia Chequing"), "Scotia Chequing");
  });
});

describe("split classification", () => {
  test("a ratio within tolerance snaps to its preset", () => {
    const result = sheet.classifySplit(65, 35, SETTINGS);
    assert.equal(result.code, "SH");
    assert.equal(result.share1, 65);
    assert.equal(result.share2, 35);
  });

  test("a near miss still snaps, and the shares are the exact ratio", () => {
    const result = sheet.classifySplit(64, 36, SETTINGS);
    assert.equal(result.code, "SH");
    assert.equal(result.share1, 65);
  });

  test("one person paying everything is their expense", () => {
    assert.equal(sheet.classifySplit(100, 0, SETTINGS).code, "P1");
    assert.equal(sheet.classifySplit(0, 100, SETTINGS).code, "P2");
  });

  test("an unrecognised ratio keeps the exact amounts", () => {
    const result = sheet.classifySplit(40, 60, SETTINGS);
    assert.equal(result.code, "C");
    assert.equal(result.share1, 40);
    assert.equal(result.share2, 60);
  });

  test("a zero total does not divide by zero", () => {
    const result = sheet.classifySplit(0, 0, SETTINGS);
    assert.equal(result.share1, 0);
    assert.equal(result.share2, 0);
  });
});

describe("excel serial dates", () => {
  test("matches the 1900 system Excel actually uses", () => {
    // Excel believes 1900 was a leap year, so the epoch is the 30th.
    assert.equal(sheet.excelSerial(new Date(1900, 0, 1)), 2);
    assert.equal(sheet.excelSerial(new Date(2026, 0, 1)), 46023);
    assert.equal(sheet.excelSerial(null), "");
  });

  test("dates are written without leading zeros", () => {
    assert.equal(sheet.formatDate(new Date(2026, 2, 5)), "3/5/2026");
  });
});

describe("reading a YNAB export", () => {
  const headers = ["Account", "Date", "Payee", "Category Group", "Memo",
    "Outflow", "Inflow"];
  const row = (values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index]]));

  test("transfers and filtered payees are dropped", () => {
    const result = sheet.fromExport({
      headers,
      rows: [
        row(["(A) Chequing", "03/05/2026", "Transfer : Savings", "", "", "100.00", ""]),
        row(["(A) Chequing", "03/05/2026", "Monthly Interest", "", "", "2.00", ""]),
        row(["(A) Chequing", "03/05/2026", "Corner Store", "Household", "", "20.00", ""]),
      ],
    }, SETTINGS);

    assert.equal(result.skippedTransfers, 1);
    assert.equal(result.skippedPayees, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].payee, "Corner Store");
  });

  test("split rows are gathered by date and payee", () => {
    const result = sheet.fromExport({
      headers,
      rows: [
        row(["(A) Visa", "03/05/2026", "Furniture Co", "Alex Wants",
          "Split (1/2) new desk", "650.00", ""]),
        row(["(S) Visa", "03/05/2026", "Furniture Co", "Sam Wants",
          "Split (2/2) new desk", "350.00", ""]),
      ],
    }, SETTINGS);

    assert.equal(result.items.length, 1);
    const rows = sheet.buildRows(result.items, SETTINGS);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Amount, 1000);
    assert.equal(rows[0].Owner, "SH");
    assert.equal(rows[0].Share1, 650);
    assert.equal(rows[0].Share2, 350);
    assert.equal(rows[0].Memo, "new desk", "the Split prefix is stripped");
  });

  test("differing memos on the two halves are joined", () => {
    const result = sheet.fromExport({
      headers,
      rows: [
        row(["(A) Visa", "03/05/2026", "Shop", "Alex Wants", "Split (1/2) desk", "50.00", ""]),
        row(["(S) Visa", "03/05/2026", "Shop", "Sam Wants", "Split (2/2) chair", "50.00", ""]),
      ],
    }, SETTINGS);
    assert.equal(sheet.buildRows(result.items, SETTINGS)[0].Memo, "desk | chair");
  });

  test("outflow and inflow become separate rows", () => {
    const result = sheet.fromExport({
      headers,
      rows: [row(["(A) Visa", "03/05/2026", "Shop", "Household", "", "80.00", "30.00"])],
    }, SETTINGS);

    const rows = sheet.buildRows(result.items, SETTINGS);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].Amount, 80);
    assert.equal(rows[1].Amount, -30, "a refund is written negative");
  });

  test("excluded accounts are dropped and counted", () => {
    const settings = {
      ...SETTINGS,
      excludedAccounts: ["Business Visa"],
      accountOwners: { "Savings": "exclude" },
    };
    const result = sheet.fromExport({
      headers,
      rows: [
        row(["Business Visa", "03/05/2026", "Supplier", "Household", "", "40.00", ""]),
        row(["Savings", "03/05/2026", "Transfer Fee", "Household", "", "1.00", ""]),
        row(["Joint", "03/05/2026", "Corner Store", "Household", "", "20.00", ""]),
      ],
    }, settings);

    assert.equal(result.skippedAccounts, 2);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].payee, "Corner Store");
  });

  test("exclusion matches the whole name, not part of it", () => {
    const settings = { ...SETTINGS, excludedAccounts: ["Visa"] };
    assert.equal(sheet.isExcludedAccount("Visa", settings), true);
    assert.equal(sheet.isExcludedAccount("  visa  ", settings), true, "case and space");
    assert.equal(sheet.isExcludedAccount("Visa Rewards", settings), false);
  });

  test("a missing column is reported rather than silently ignored", () => {
    assert.throws(
      () => sheet.fromExport({ headers: ["Date", "Payee"], rows: [] }, SETTINGS),
      /missing these columns/i);
  });

  test("shared rows use the default code and its ratio", () => {
    const result = sheet.fromExport({
      headers,
      rows: [row(["Joint", "03/05/2026", "Power Co", "Household", "", "100.00", ""])],
    }, SETTINGS);
    const rows = sheet.buildRows(result.items, SETTINGS);
    assert.equal(rows[0].Owner, "SH");
    assert.equal(rows[0].Share1, 65);
    assert.equal(rows[0].Share2, 35);
  });

  test("one person's own expense is theirs entirely", () => {
    const result = sheet.fromExport({
      headers,
      rows: [row(["Joint", "03/05/2026", "Hobby Shop", "Sam Wants", "", "40.00", ""])],
    }, SETTINGS);
    const rows = sheet.buildRows(result.items, SETTINGS);
    assert.equal(rows[0].Owner, "P2");
    assert.deepEqual([rows[0].Share1, rows[0].Share2], [0, 40]);
  });

  test("the account tag is kept in Card unless asked otherwise", () => {
    const rows = [["(A) Visa", "03/05/2026", "Shop", "Household", "", "10.00", ""]];
    const build = (settings) => sheet.buildRows(
      sheet.fromExport({ headers, rows: rows.map(row) }, settings).items, settings);

    assert.equal(build(SETTINGS)[0].Card, "(A) Visa");
    assert.equal(build({ ...SETTINGS, stripAccountTag: true })[0].Card, "Visa");
  });
});

describe("reading from the API", () => {
  const groupOf = (id) => ({
    c1: "Household", c2: "Alex Wants", c3: "Sam Wants",
  }[id] || "");

  test("subtransactions are the split, no memo convention needed", () => {
    const result = sheet.fromApi([{
      date: "2026-03-05", payee_name: "Furniture Co", account_name: "(A) Visa",
      amount: -1000000, category_id: null, memo: "",
      subtransactions: [
        { category_id: "c2", amount: -650000, memo: "new desk" },
        { category_id: "c3", amount: -350000, memo: "" },
      ],
    }], groupOf, SETTINGS);

    const rows = sheet.buildRows(result.items, SETTINGS);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Amount, 1000);
    assert.equal(rows[0].Owner, "SH");
    assert.equal(rows[0].Share1, 650);
    assert.equal(rows[0].Memo, "new desk");
  });

  test("transfers are skipped and inflows go negative", () => {
    const result = sheet.fromApi([
      { date: "2026-03-05", payee_name: "Transfer : Savings", amount: -5000,
        transfer_account_id: "acc2", account_name: "" },
      { date: "2026-03-06", payee_name: "Refund Co", amount: 25000,
        category_id: "c1", account_name: "Joint" },
    ], groupOf, SETTINGS);

    assert.equal(result.skippedTransfers, 1);
    const rows = sheet.buildRows(result.items, SETTINGS);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Amount, -25);
  });
});

describe("monthly summary", () => {
  const CYCLE = {
    ...SETTINGS,
    cycleStartDay: 6,
    accountOwners: { "Amex Cobalt": "p1", "Joint Chequing": "joint" },
  };

  test("a cycle runs from its start day to the day before the next", () => {
    // The 5th belongs to the cycle that opened the previous month.
    assert.equal(
      sheet.cycleStart(new Date(2026, 2, 5), 6).toDateString(),
      new Date(2026, 1, 6).toDateString());
    assert.equal(
      sheet.cycleStart(new Date(2026, 2, 6), 6).toDateString(),
      new Date(2026, 2, 6).toDateString());
    assert.equal(
      sheet.cycleEnd(new Date(2026, 2, 6), 6).toDateString(),
      new Date(2026, 3, 5).toDateString());
  });

  test("day 1 is plain calendar months", () => {
    assert.equal(
      sheet.cycleStart(new Date(2026, 2, 31), 1).toDateString(),
      new Date(2026, 2, 1).toDateString());
    assert.match(sheet.cycleLabel(new Date(2026, 2, 1), 1), /2026/);
  });

  test("who paid comes from the mapping, then the tag, then the name", () => {
    assert.equal(sheet.payerOf("Amex Cobalt", CYCLE), "p1", "explicit mapping");
    assert.equal(sheet.payerOf("(A) Chequing", CYCLE), "p1", "account tag A is person 1");
    assert.equal(sheet.payerOf("(S) Visa", CYCLE), "p2", "account tag S is person 2");
    assert.equal(sheet.payerOf("Sam Visa", CYCLE), "p2", "starts with the name");
    assert.equal(sheet.payerOf("Joint Chequing", CYCLE), "joint");
    assert.equal(sheet.payerOf("Some Bank", CYCLE), "joint", "unknown is never a guess");
  });

  test("spend is grouped into cycles, newest first", () => {
    const rows = [
      { Card: "Amex Cobalt", Date: new Date(2026, 1, 10), Amount: 100,
        Owner: "SH", Share1: 65, Share2: 35, Memo: "" },
      { Card: "Amex Cobalt", Date: new Date(2026, 2, 5), Amount: 50,
        Owner: "SH", Share1: 32.5, Share2: 17.5, Memo: "" },
      { Card: "Amex Cobalt", Date: new Date(2026, 2, 6), Amount: 10,
        Owner: "SH", Share1: 6.5, Share2: 3.5, Memo: "" },
    ];
    const cycles = sheet.monthlySummary(rows, CYCLE);

    assert.equal(cycles.length, 2);
    assert.equal(cycles[0].label, sheet.cycleLabel(new Date(2026, 2, 6), 6));
    assert.equal(cycles[1].total, 150, "the 5th falls in the earlier cycle");
    assert.equal(cycles[1].share1, 97.5);
    assert.equal(cycles[1].count, 2);
  });

  test("settling up nets what each owes on the other's cards", () => {
    const rows = [
      // Person 1 paid; person 2 owes their 35.
      { Card: "Amex Cobalt", Date: new Date(2026, 2, 10), Amount: 100,
        Owner: "SH", Share1: 65, Share2: 35, Memo: "" },
      // Person 2 paid; person 1 owes their 13.
      { Card: "Sam Visa", Date: new Date(2026, 2, 11), Amount: 20,
        Owner: "SH", Share1: 13, Share2: 7, Memo: "" },
    ];
    const [cycle] = sheet.monthlySummary(rows, CYCLE);
    assert.equal(cycle.net, 22, "35 owed one way less 13 the other");
    assert.equal(cycle.settleFrom, 2, "person 2 pays");
    assert.equal(cycle.settleAmount, 22);
  });

  test("a joint card is left out of the settle up", () => {
    const rows = [{ Card: "Joint Chequing", Date: new Date(2026, 2, 10),
      Amount: 100, Owner: "SH", Share1: 65, Share2: 35, Memo: "" }];
    const [cycle] = sheet.monthlySummary(rows, CYCLE);
    assert.equal(cycle.net, 0);
    assert.equal(cycle.settleFrom, 0, "nobody owes anybody");
    assert.equal(cycle.total, 100, "but it still counts as spending");
  });

  test("each card is totalled, biggest first", () => {
    const rows = [
      { Card: "Amex Cobalt", Date: new Date(2026, 2, 10), Amount: 20,
        Owner: "SH", Share1: 13, Share2: 7, Memo: "" },
      { Card: "Sam Visa", Date: new Date(2026, 2, 11), Amount: 80,
        Owner: "SH", Share1: 52, Share2: 28, Memo: "" },
    ];
    const [cycle] = sheet.monthlySummary(rows, CYCLE);
    assert.deepEqual(cycle.byCard.map((c) => c.name), ["Sam Visa", "Amex Cobalt"]);
    assert.equal(cycle.byCard[0].amount, 80);
  });

  test("an explicit closing day can end a cycle early", () => {
    const settings = { ...CYCLE, cycleEndDay: 3 };
    // Cycle opens on the 6th and closes on the 3rd of the next month, so
    // the 4th and 5th belong to no cycle at all.
    assert.equal(
      sheet.cycleEnd(new Date(2026, 1, 6), 6, 3).toDateString(),
      new Date(2026, 2, 3).toDateString());

    const rows = [
      { Card: "Amex Cobalt", Date: new Date(2026, 2, 2), Amount: 10,
        Owner: "SH", Share1: 6.5, Share2: 3.5, Memo: "" },
      { Card: "Amex Cobalt", Date: new Date(2026, 2, 4), Amount: 99,
        Owner: "SH", Share1: 64, Share2: 35, Memo: "" },
    ];
    const cycles = sheet.monthlySummary(rows, settings);
    assert.equal(cycles.length, 1);
    assert.equal(cycles[0].total, 10);
    assert.equal(cycles.outside.length, 1, "the gap day is reported, not hidden");
  });

  test("a closing day at or after the start day closes in the same month", () => {
    assert.equal(
      sheet.cycleEnd(new Date(2026, 1, 6), 6, 20).toDateString(),
      new Date(2026, 1, 20).toDateString());
  });

  test("a closing day past the end of the month is clamped", () => {
    // February has no 31st.
    assert.equal(
      sheet.cycleEnd(new Date(2026, 1, 6), 6, 31).toDateString(),
      new Date(2026, 1, 28).toDateString());
  });

  test("rows with no readable date are left out rather than bucketed wrongly", () => {
    const rows = [{ Card: "Amex Cobalt", Date: null, Amount: 10,
      Owner: "SH", Share1: 6.5, Share2: 3.5, Memo: "" }];
    const cycles = sheet.monthlySummary(rows, CYCLE);
    assert.equal(cycles.length, 0);
    assert.equal(cycles.outside.length, 0, "undated is not the same as out of cycle");
  });
});

describe("output", () => {
  test("the person columns carry their real names", () => {
    assert.deepEqual(sheet.columnsFor(SETTINGS), [
      "Card", "Date", "Description", "Amount", "Owner", "Alex", "Sam",
      "Memo", "Date Adjusted",
    ]);
  });

  test("csv quotes what needs quoting and writes the serial date", () => {
    const rows = [{
      Card: "Visa", Date: new Date(2026, 2, 5), Description: "Shop, Local",
      Amount: 10, Owner: "SH", Share1: 6.5, Share2: 3.5, Memo: 'said "hi"',
      DateAdjusted: new Date(2026, 2, 5),
    }];
    const csv = sheet.toCsv(rows, SETTINGS);
    const [header, line] = csv.trim().split("\r\n");
    assert.match(header, /Alex,Sam/);
    assert.match(line, /"Shop, Local"/);
    assert.match(line, /"said ""hi"""/);
    assert.match(line, /3\/5\/2026/);
    assert.match(line, /,46086$/);
  });

  test("rows come out in date order", () => {
    const rows = sheet.buildRows([
      { accountName: "V", date: new Date(2026, 2, 9), payee: "B", groupName: "Household", memo: "", outflow: 1, inflow: 0, parts: null },
      { accountName: "V", date: new Date(2026, 2, 1), payee: "A", groupName: "Household", memo: "", outflow: 1, inflow: 0, parts: null },
    ], SETTINGS);
    assert.deepEqual(rows.map((row) => row.Description), ["A", "B"]);
  });
});
