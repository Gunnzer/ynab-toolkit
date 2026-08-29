// Reports: what was actually spent, by month, category and payee.
//
// Reads only. Split transactions are counted one part at a time, because a
// split is exactly where "whose expense was this" stops being one answer.

import { ownerOf } from "./split_sheet.js";

export const OWNERS = ["all", "p1", "p2", "shared"];

/**
 * Flatten transactions into one entry per spend.
 *
 * A parent transaction with subtransactions contributes its parts, never
 * itself, or every split would be counted twice.
 */
export function toEntries(transactions, groupNameFor, settings) {
  const entries = [];

  for (const transaction of transactions || []) {
    if (transaction.deleted) continue;
    if (transaction.transfer_account_id) continue;

    const base = {
      date: String(transaction.date || ""),
      payee: transaction.payee_name || "(no payee)",
      accountName: transaction.account_name || "",
    };

    const subs = (transaction.subtransactions || []).filter((sub) => !sub.deleted);
    const parts = subs.length
      ? subs.map((sub) => ({ categoryId: sub.category_id, amount: sub.amount || 0 }))
      : [{ categoryId: transaction.category_id, amount: transaction.amount || 0 }];

    for (const part of parts) {
      const groupName = groupNameFor(part.categoryId) || "";
      entries.push({
        ...base,
        amount: part.amount,
        categoryId: part.categoryId,
        groupName,
        owner: ownerOf(groupName, base.accountName, settings),
      });
    }
  }

  return entries;
}

/** Everything a saved filter can say. */
export function matches(entry, filters) {
  if (filters.owner && filters.owner !== "all" && entry.owner !== filters.owner) {
    return false;
  }
  if (filters.since && entry.date < filters.since) return false;
  if (filters.until && entry.date > filters.until) return false;
  // categoryIds is the only category-level filter - an inclusion list,
  // empty meaning every category included. There used to be a separate
  // excludeCategoryIds ("except these") layered on top, but that was
  // solving a problem categoryIds already solves: not choosing a category
  // already excludes it, and ticking everything except a couple (the group
  // checkbox in chooseCategories() makes "everything" one click) covers the
  // "mostly all of them" case just as well with one control instead of two.
  // Removed entirely at explicit user request. A category's group is not
  // consulted for filtering at all, only for display.
  if (filters.categoryIds?.length && !filters.categoryIds.includes(entry.categoryId)) {
    return false;
  }
  const needle = (filters.payeeContains || "").trim().toLowerCase();
  if (needle && !entry.payee.toLowerCase().includes(needle)) return false;
  return true;
}

function rank(map, limit) {
  return [...map.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

function bump(map, key, amount) {
  const current = map.get(key) || { total: 0, count: 0 };
  current.total += amount;
  current.count += 1;
  map.set(key, current);
}

/**
 * Totals of *assigned* money (YNAB's own "Assigned" figure, `budgeted` in
 * the API) per month/group/category, for Saving mode.
 *
 * Saving started out reading the same activity/outflow figures Spending
 * does, just pointed at whichever categories were chosen - but that reads
 * backwards the moment you actually move the money: transferring out of an
 * "Investing" category to a real brokerage shows up as spending in that
 * category, even though the whole point was to save it. What you assigned
 * into the category is the real answer, and assigning is not affected by
 * what you do with the money afterward - a transfer out changes `activity`,
 * never `budgeted`. `monthlyCategories` is `[{ month, categories: [{ id,
 * name, groupName, budgeted, owner }] }]`, one entry per month in the
 * report's date range - built by the caller from state.month(), since
 * fetching a month's own category data is not something a pure function
 * here can do itself.
 */
export function summariseAssigned(monthlyCategories, filters = {}) {
  const months = new Map();
  const groups = new Map();
  const categories = new Map();

  let total = 0;

  for (const { month, categories: cats } of monthlyCategories || []) {
    for (const cat of cats || []) {
      if (filters.owner && filters.owner !== "all" && cat.owner !== filters.owner) continue;
      if (filters.categoryIds?.length && !filters.categoryIds.includes(cat.id)) continue;

      const amount = cat.budgeted || 0;
      total += amount;

      bump(months, month, amount);
      bump(groups, cat.groupName || "(uncategorised)", amount);
      bump(categories, cat.name || "(uncategorised)", amount);
    }
  }

  const monthly = [...months.entries()]
    .map(([month, value]) => ({ month, ...value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const activeMonths = monthly.filter((entry) => entry.total !== 0);

  return {
    total,
    monthly,
    average: activeMonths.length ? total / activeMonths.length : 0,
    busiest: monthly.reduce(
      (best, entry) => (!best || entry.total > best.total ? entry : best), null),
    groups: rank(groups, 10),
    categories: rank(categories, 10),
  };
}

/**
 * Totals by month, category group and payee.
 *
 * Amounts come back positive: this counts spending, so the sign is noise.
 * Refunds still net off within their month and category.
 */
export function summarise(entries, filters = {}, { limit = 10, categoryNameFor } = {}) {
  const months = new Map();
  const groups = new Map();
  const categories = new Map();
  const payees = new Map();

  let total = 0;
  let count = 0;

  for (const entry of entries) {
    if (!matches(entry, filters)) continue;
    // Inflow is income or a refund, not spending.
    if (entry.amount >= 0 && !filters.includeInflow) continue;

    const spent = -entry.amount;
    total += spent;
    count += 1;

    bump(months, entry.date.slice(0, 7), spent);
    bump(groups, entry.groupName || "(uncategorised)", spent);
    bump(categories,
      categoryNameFor?.(entry.categoryId) || "(uncategorised)", spent);
    bump(payees, entry.payee, spent);
  }

  const monthly = [...months.entries()]
    .map(([month, value]) => ({ month, ...value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const spendingMonths = monthly.filter((entry) => entry.total > 0);

  return {
    total,
    count,
    monthly,
    average: spendingMonths.length
      ? total / spendingMonths.length : 0,
    busiest: monthly.reduce(
      (best, entry) => (!best || entry.total > best.total ? entry : best), null),
    groups: rank(groups, limit),
    categories: rank(categories, limit),
    payees: rank(payees, limit),
  };
}
