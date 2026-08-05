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
  if (filters.groupNames?.length && !filters.groupNames.includes(entry.groupName)) {
    return false;
  }
  // Categories are excluded rather than included, so a category added to the
  // budget later shows up in an existing saved filter instead of silently
  // going missing from it.
  if (filters.excludeCategoryIds?.length &&
    filters.excludeCategoryIds.includes(entry.categoryId)) {
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
