// Cash flow: income against spending, month by month, and the savings rate.
//
// Income is what reached Ready to Assign. Spending is every categorized
// outflow (refunds netting off), except money moved into a tracking
// account - an investment or retirement account, typically - which is
// counted as saved, not spent, even though it leaves the budget.

import { monthKey } from "./budget_actual.js";

/**
 * One row per month in `months`: income, spending, moved to tracking
 * accounts, what was left over (income less spending) and the savings
 * rate (left over / income). `rtaIds` is the set of Ready to Assign
 * category ids. A categorized amount that is also a transfer is "to
 * tracking": YNAB only lets a transfer carry a category when the other
 * side is off budget. Split legs are read one by one, since a leg can be
 * a transfer of its own.
 */
export function cashFlow({ transactions, rtaIds, months }) {
  const rows = new Map(months.map((m) => [m, { month: m, income: 0, spending: 0, toTracking: 0 }]));

  const add = (date, categoryId, amount, isTransfer) => {
    const row = rows.get(monthKey(date));
    if (!row || !categoryId) return;
    if (rtaIds.has(categoryId)) row.income += amount;
    else if (isTransfer) row.toTracking -= amount;
    else row.spending -= amount;
  };

  for (const t of transactions || []) {
    if (t.deleted) continue;
    const legs = (t.subtransactions || []).filter((leg) => !leg.deleted);
    if (legs.length) {
      for (const leg of legs) add(t.date, leg.category_id, leg.amount || 0, Boolean(leg.transfer_account_id));
    } else {
      add(t.date, t.category_id, t.amount || 0, Boolean(t.transfer_account_id));
    }
  }

  return months.map((m) => {
    const row = rows.get(m);
    const leftOver = row.income - row.spending;
    return { ...row, leftOver, rate: row.income > 0 ? leftOver / row.income : null };
  });
}

/** Totals across rows, with the savings rate over the whole period. */
export function cashFlowTotals(rows) {
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const income = sum("income");
  const spending = sum("spending");
  return {
    income,
    spending,
    toTracking: sum("toTracking"),
    leftOver: income - spending,
    rate: income > 0 ? (income - spending) / income : null,
    averageSpending: rows.length ? Math.round(spending / rows.length) : 0,
  };
}
