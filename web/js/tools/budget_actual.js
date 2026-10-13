// Budget vs actual: what each category was given against what it actually
// spent, over the last several full months, and how this month is pacing.
//
// Spending comes from transactions (split legs counted at their own
// amount, refunds netting off), assigned amounts from YNAB's own month
// figures. Amounts are milliunits; "spent" is positive.

export function monthKey(date) {
  return String(date || "").slice(0, 7);
}

/** "YYYY-MM" for n months before `month` (negative n goes forward). */
export function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const when = new Date(y, m - 1 - n, 1);
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
}

/** The `count` full months before `currentMonth`, oldest first. */
export function fullMonthsBefore(currentMonth, count) {
  const out = [];
  for (let n = count; n >= 1; n -= 1) out.push(shiftMonth(currentMonth, n));
  return out;
}

/**
 * Every categorized amount as { categoryId, date, amount }, split legs
 * included at their own amount. A transfer between two budget accounts has
 * no category and so never appears; one to a tracking account is
 * categorized and does - from the budget's point of view that money was
 * spent.
 */
export function categorizedAmounts(transactions) {
  const out = [];
  for (const t of transactions || []) {
    if (t.deleted) continue;
    const legs = (t.subtransactions || []).filter((leg) => !leg.deleted);
    if (legs.length) {
      for (const leg of legs) {
        if (leg.category_id) {
          out.push({ categoryId: leg.category_id, date: t.date, amount: leg.amount || 0 });
        }
      }
    } else if (t.category_id) {
      out.push({ categoryId: t.category_id, date: t.date, amount: t.amount || 0 });
    }
  }
  return out;
}

/** Map of category id -> Map of month -> spent (positive), refunds netted. */
export function spendingByMonth(transactions) {
  const out = new Map();
  for (const item of categorizedAmounts(transactions)) {
    const months = out.get(item.categoryId) || new Map();
    const key = monthKey(item.date);
    months.set(key, (months.get(key) || 0) - item.amount);
    out.set(item.categoryId, months);
  }
  return out;
}

/** Map of category id -> spent in `month` on or before day `day`. */
export function spentThroughDay(transactions, month, day) {
  const last = `${month}-${String(day).padStart(2, "0")}`;
  const out = new Map();
  for (const item of categorizedAmounts(transactions)) {
    if (monthKey(item.date) !== month || item.date > last) continue;
    out.set(item.categoryId, (out.get(item.categoryId) || 0) - item.amount);
  }
  return out;
}

/**
 * Saving up on purpose: a target-balance goal, or a need that comes round
 * less often than monthly (yearly insurance, a bill every two months).
 * Assigning more than is spent is the whole point of these, so they are
 * never called "more than needed".
 */
export function isSavingUp(category) {
  const type = category.goal_type;
  if (type === "TB" || type === "TBD") return true;
  if (type === "NEED" || type === "MF") {
    if (category.goal_cadence === 13) return true;
    if (category.goal_cadence === 1 && (category.goal_cadence_frequency || 1) > 1) return true;
  }
  return false;
}

const roundUpTo5 = (milli) => Math.ceil(milli / 5000) * 5000;

/**
 * Per category, over `history` (each { month, categories }, oldest first,
 * with each category's `budgeted` and a `groupName`): average assigned,
 * average spent, how many months spending ran past what was assigned, and
 * a verdict:
 *   "under"   usually spends more than it is given (at least half the
 *             months, and at least $10 and 10% a month over on average) -
 *             suggestion: assign what it actually spends
 *   "over"    usually given well more than it spends ($20 and 25% a month)
 *             and not saving up on purpose - suggestion: assign less
 *   "saving"  given more than it spends, but it has a savings-style target
 *   "ok"      everything else
 * Categories with next to nothing assigned or spent are left out.
 */
export function budgetVsActual(history, spending) {
  const months = history.map((h) => h.month);
  const latest = new Map();
  for (const h of history) {
    for (const category of h.categories || []) latest.set(category.id, category);
  }

  const rows = [];
  for (const category of latest.values()) {
    const assigned = history.map((h) =>
      (h.categories || []).find((c) => c.id === category.id)?.budgeted || 0);
    const spent = months.map((m) => spending.get(category.id)?.get(m) || 0);
    const n = months.length || 1;
    const avgAssigned = Math.round(assigned.reduce((a, b) => a + b, 0) / n);
    const avgSpent = Math.round(spent.reduce((a, b) => a + b, 0) / n);
    if (Math.abs(avgAssigned) < 1000 && Math.abs(avgSpent) < 1000) continue;

    const overMonths = spent.filter((s, i) => s > assigned[i] + 1000).length;
    const gap = avgSpent - avgAssigned;
    const saving = isSavingUp(category);
    let status = "ok";
    if (overMonths >= Math.ceil(n / 2) && gap >= 10000 && avgSpent > avgAssigned * 1.1) {
      status = "under";
    } else if (-gap >= 20000 && avgAssigned > avgSpent * 1.25) {
      status = saving ? "saving" : "over";
    }

    rows.push({
      id: category.id,
      name: category.name,
      groupName: category.groupName || "",
      months,
      assigned,
      spent,
      avgAssigned,
      avgSpent,
      overMonths,
      gap,
      status,
      suggested: status === "under" || status === "over" ? roundUpTo5(Math.max(0, avgSpent)) : null,
    });
  }

  const order = { under: 0, over: 1, saving: 2, ok: 3 };
  return rows.sort((a, b) => order[a.status] - order[b.status] ||
    Math.abs(b.gap) - Math.abs(a.gap) || a.name.localeCompare(b.name));
}

/**
 * How each category is pacing this month. "Typical by now" is what past
 * months had spent by this same day - not a straight-line share of the
 * month - so a bill that always lands on the 1st does not look like a
 * sudden overspend on the 2nd. Projected = spent so far plus whatever the
 * typical month still spends after today.
 *
 * `categories` is this month's (with balance, activity and groupName);
 * `lookback` the past months to compare with. Returns only categories that
 * look like trouble: on pace to spend more than they have this month
 * (`willRunOut`), or well ahead of their usual pace (`ahead`).
 */
export function pace({ categories, transactions, currentMonth, day, lookback }) {
  const now = spentThroughDay(transactions, currentMonth, day);
  const byNow = lookback.map((m) => spentThroughDay(transactions, m, day));
  const full = spendingByMonth(transactions);
  const n = lookback.length || 1;

  const rows = [];
  for (const category of categories || []) {
    const spentNow = now.get(category.id) || 0;
    const typicalByNow = Math.round(byNow.reduce((sum, map) => sum + (map.get(category.id) || 0), 0) / n);
    const typicalFull = Math.round(lookback.reduce(
      (sum, m) => sum + (full.get(category.id)?.get(m) || 0), 0) / n);
    if (typicalFull <= 0 && spentNow <= 0) continue;

    const projected = spentNow + Math.max(0, typicalFull - typicalByNow);
    // Everything this category had to spend this month: what is left now
    // plus what has already gone out of it.
    const available = (category.balance || 0) - (category.activity || 0);
    const willRunOut = spentNow > 0 && projected > available + 1000;
    const ahead = spentNow - typicalByNow >= 20000 && spentNow > typicalByNow * 1.25;
    if (!willRunOut && !ahead) continue;

    rows.push({
      id: category.id,
      name: category.name,
      groupName: category.groupName || "",
      spentNow,
      typicalByNow,
      typicalFull,
      projected,
      available,
      shortBy: Math.max(0, projected - available),
      willRunOut,
      ahead,
    });
  }
  return rows.sort((a, b) => b.shortBy - a.shortBy || (b.spentNow - b.typicalByNow) - (a.spentNow - a.typicalByNow));
}
