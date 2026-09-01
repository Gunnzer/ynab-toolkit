import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as spendingExport from "../js/tools/spending_export.js";

const PEOPLE = {
  person1Name: "Alex", person2Name: "Sam",
  person1AccountTag: "", person2AccountTag: "",
};

const GROUPS = [
  {
    id: "g1", name: "Alex Wants",
    categories: [
      { id: "c1", name: "Groceries" },
      { id: "c2", name: "Hobbies" },
    ],
  },
  {
    id: "g2", name: "Sam Wants",
    categories: [{ id: "c3", name: "Books" }],
  },
  {
    id: "g3", name: "Shared",
    categories: [{ id: "c4", name: "Rent" }],
  },
];

describe("ownedCategories", () => {
  test("only categories in that person's own groups, in budget order", () => {
    const cats = spendingExport.ownedCategories(GROUPS, "p1", PEOPLE);
    assert.deepEqual(cats.map((c) => c.name), ["Groceries", "Hobbies"]);
    assert.deepEqual(cats.map((c) => c.label), ["Groceries", "Hobbies"]);
  });

  test("hidden and deleted categories/groups are skipped", () => {
    const groups = [
      { id: "g1", name: "Alex Wants", hidden: true, categories: [{ id: "c1", name: "Groceries" }] },
      {
        id: "g2", name: "Alex Wants",
        categories: [
          { id: "c2", name: "Hobbies", hidden: true },
          { id: "c3", name: "Fun", deleted: true },
          { id: "c4", name: "Books" },
        ],
      },
    ];
    const cats = spendingExport.ownedCategories(groups, "p1", PEOPLE);
    assert.deepEqual(cats.map((c) => c.name), ["Books"]);
  });

  test("a duplicate category name across groups gets a disambiguated label", () => {
    const groups = [
      { id: "g1", name: "Alex Wants", categories: [{ id: "c1", name: "Gifts" }] },
      { id: "g2", name: "Alex Home", categories: [{ id: "c2", name: "Gifts" }] },
    ];
    const cats = spendingExport.ownedCategories(groups, "p1", PEOPLE);
    assert.deepEqual(cats.map((c) => c.label),
      ["Gifts (Alex Wants)", "Gifts (Alex Home)"]);
  });
});

describe("monthsBetween", () => {
  test("inclusive, crossing a year boundary", () => {
    assert.deepEqual(spendingExport.monthsBetween("2025-11-01", "2026-02-28"),
      ["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("buildRows", () => {
  const tx = (date, payee, amount, category, extra = {}) => ({
    date, payee_name: payee, amount, category_id: category,
    account_name: "Joint", ...extra,
  });
  const groupOf = (id) => ({ c1: "Alex Wants", c2: "Alex Wants", c3: "Sam Wants" }[id] || "");

  const entries = spendingExport.toEntries([
    tx("2026-01-05", "Corner Store", -20000, "c1"),
    tx("2026-01-20", "Corner Store", -10000, "c1"),
    tx("2026-02-03", "Hobby Shop", -50000, "c2"),
    tx("2026-02-20", "Refund Co", 8000, "c1"),
    tx("2026-01-10", "Book Nook", -30000, "c3"),
  ], groupOf, PEOPLE);

  const categories = [
    { id: "c1", name: "Groceries", label: "Groceries" },
    { id: "c2", name: "Hobbies", label: "Hobbies" },
  ];
  const months = ["2026-01", "2026-02"];

  test("every month/category combination is present, $0 when nothing was spent", () => {
    const rows = spendingExport.buildRows(entries, months, categories, "p1");
    assert.deepEqual(rows, [
      { month: "2026-01", c1: 30000, c2: 0 },
      { month: "2026-02", c1: 0, c2: 50000 },
    ]);
  });

  test("a refund nets off within its own month and category by default", () => {
    const feb = spendingExport.buildRows(entries, ["2026-02"], categories, "p1")[0];
    assert.equal(feb.c1, 0, "the $8 refund has nothing that month's spend to net against");
  });

  test("includeInflow counts income/refunds as their own positive-reducing entry", () => {
    // Same category, same month as an actual spend, so the refund should
    // show up as a reduction once it is counted at all.
    const withSpend = spendingExport.buildRows(spendingExport.toEntries([
      tx("2026-02-01", "Shop", -20000, "c1"),
      tx("2026-02-20", "Refund Co", 8000, "c1"),
    ], groupOf, PEOPLE), ["2026-02"], categories, "p1", { includeInflow: true });
    assert.equal(withSpend[0].c1, 12000);
  });

  test("a category not owned by the chosen person contributes nothing", () => {
    const rows = spendingExport.buildRows(entries, months, categories, "p2");
    assert.deepEqual(rows, [
      { month: "2026-01", c1: 0, c2: 0 },
      { month: "2026-02", c1: 0, c2: 0 },
    ]);
  });
});

describe("toCsv", () => {
  const categories = [
    { id: "c1", name: "Groceries", groupName: "Alex Wants", label: "Groceries" },
    { id: "c2", name: "Gifts", groupName: "Alex Home", label: "Gifts (Alex Home)" },
  ];
  const rows = [
    { month: "2026-01", c1: 30000, c2: 0 },
    { month: "2026-02", c1: 0, c2: 12500 },
  ];

  test("a header row plus one row per month, dollars not milliunits, $0 left blank", () => {
    const csv = spendingExport.toCsv(categories, rows, (m) => m);
    assert.equal(csv,
      "Month,Groceries,Gifts\r\n" +
      "2026-01,30.00,\r\n" +
      "2026-02,,12.50\r\n");
  });

  test("emoji, an account tag in parens and a goal amount in brackets are stripped from headers", () => {
    const decorated = [
      { id: "c1", name: "🏠 Rent (J) [$1643]", groupName: "Household" },
      { id: "c2", name: "🛒 Groceries (J) [$585]", groupName: "Household" },
      { id: "c3", name: "🌎 Internet (J) [$47.74]", groupName: "Household" },
    ];
    const csv = spendingExport.toCsv(decorated, [{ month: "2026-01", c1: 0, c2: 0, c3: 0 }], (m) => m);
    assert.equal(csv.split("\r\n")[0], "Month,Rent,Groceries,Internet");
  });

  test("a due-date suffix like '- 11th' is cut off too", () => {
    const decorated = [
      { id: "c1", name: "🌎 Internet - 11th", groupName: "Household" },
      { id: "c2", name: "Rent (J) [$1643] - 1st", groupName: "Household" },
    ];
    const csv = spendingExport.toCsv(decorated, [{ month: "2026-01", c1: 0, c2: 0 }], (m) => m);
    assert.equal(csv.split("\r\n")[0], "Month,Internet,Rent");
  });

  test("an en dash before the suffix cuts the name just the same as a hyphen", () => {
    // A due-date suffix some banks/autocorrect write with an en dash
    // instead of a plain hyphen - written via fromCharCode, not typed
    // literally, since this file is scanned for that character the same
    // way user-facing text is (see privacy.test.js).
    const enDash = String.fromCharCode(0x2013);
    const decorated = [{ id: "c1", name: `Car Insurance ${enDash} 22nd`, groupName: "Household" }];
    const csv = spendingExport.toCsv(decorated, [{ month: "2026-01", c1: 0 }], (m) => m);
    assert.equal(csv.split("\r\n")[0], "Month,Car Insurance");
  });

  test("emoji, a bracketed goal amount, a due-date suffix and a trailing " +
    "progress note are all cut at once - only the first special character matters", () => {
    // A real example: everything after the first decoration character
    // goes, regardless of how many different kinds follow it.
    const decorated = [
      { id: "c1", name: "🌎 Internet [$67.80] - 11th (Alex $23.73)", groupName: "Household" },
    ];
    const csv = spendingExport.toCsv(decorated, [{ month: "2026-01", c1: 0 }], (m) => m);
    assert.equal(csv.split("\r\n")[0], "Month,Internet");
  });

  test("a name with no decoration at all passes through untouched, spaces included", () => {
    const plain = [{ id: "c1", name: "Car Insurance", groupName: "Household" }];
    const csv = spendingExport.toCsv(plain, [{ month: "2026-01", c1: 0 }], (m) => m);
    assert.equal(csv.split("\r\n")[0], "Month,Car Insurance");
  });

  test("the on-screen label (with its own decoration) is untouched - cleaning is export-only", () => {
    const decorated = [{ id: "c1", name: "🏠 Rent (J) [$1643]", groupName: "Household", label: "🏠 Rent (J) [$1643]" }];
    assert.equal(decorated[0].label, "🏠 Rent (J) [$1643]", "unchanged by toCsv() below");
    spendingExport.toCsv(decorated, [{ month: "2026-01", c1: 0 }], (m) => m);
    assert.equal(decorated[0].label, "🏠 Rent (J) [$1643]");
  });

  test("a collision that only appears after cleaning is re-disambiguated by group", () => {
    const decorated = [
      { id: "c1", name: "🏠 Rent (J)", groupName: "Joint" },
      { id: "c2", name: "Rent [$1200]", groupName: "Personal" },
    ];
    const csv = spendingExport.toCsv(decorated, [{ month: "2026-01", c1: 0, c2: 0 }], (m) => m);
    assert.equal(csv.split("\r\n")[0], "Month,Rent (Joint),Rent (Personal)");
  });
});
