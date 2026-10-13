// Category history: every transaction that touched one category, grouped
// by month. Read only, from the transactions already loaded.
//
// A split transaction's parent carries category_id null - the category
// lives on each leg - so only the legs in this category count, at the leg's
// own amount, never the whole transaction.

function monthOf(date) {
  return String(date || "").slice(0, 7);
}

/** "YYYY-MM" for the month n months before `month`. */
function shiftMonth(month, n) {
  const [y, m] = month.split("-").map(Number);
  const when = new Date(y, m - 1 - n, 1);
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
}

/** One entry per transaction, or split leg, in this category, newest first. */
export function categoryEntries(transactions, categoryId) {
  const out = [];
  for (const t of transactions || []) {
    if (t.deleted) continue;
    const base = {
      id: t.id,
      date: t.date,
      accountId: t.account_id,
      accountName: t.account_name || "",
      cleared: t.cleared,
      approved: t.approved !== false,
    };
    const legs = (t.subtransactions || []).filter((leg) => !leg.deleted);
    if (legs.length) {
      legs.forEach((leg, index) => {
        if (leg.category_id !== categoryId) return;
        out.push({
          ...base,
          key: `${t.id}:${leg.id || index}`,
          payee: leg.payee_name || t.payee_name || "",
          memo: leg.memo || t.memo || "",
          amount: leg.amount || 0,
          splitLeg: true,
        });
      });
    } else if (t.category_id === categoryId) {
      out.push({
        ...base,
        key: t.id,
        payee: t.payee_name || "",
        memo: t.memo || "",
        amount: t.amount || 0,
        splitLeg: false,
      });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

/** Whether an entry matches a search, on payee or memo, case insensitive. */
export function matchesQuery(entry, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return entry.payee.toLowerCase().includes(needle) ||
    entry.memo.toLowerCase().includes(needle);
}

/**
 * Entries grouped by month, newest first. `net` is the month's activity
 * the way YNAB shows it (spending negative); `spent` and `inflow` split it
 * into its two sides, both positive.
 */
export function groupByMonth(entries) {
  const months = new Map();
  for (const entry of entries) {
    const key = monthOf(entry.date);
    if (!months.has(key)) months.set(key, { month: key, entries: [], net: 0, spent: 0, inflow: 0 });
    const group = months.get(key);
    group.entries.push(entry);
    group.net += entry.amount;
    if (entry.amount < 0) group.spent -= entry.amount;
    else group.inflow += entry.amount;
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * Headline figures for the dialog. The average covers the 12 full months
 * before `currentMonth`, months with nothing in them included - an average
 * of only the months that had activity would make an occasional expense
 * look like a monthly one.
 */
export function summarise(groups, currentMonth) {
  const byMonth = new Map(groups.map((group) => [group.month, group]));
  let lastYear = 0;
  for (let n = 1; n <= 12; n += 1) lastYear += byMonth.get(shiftMonth(currentMonth, n))?.net || 0;

  const biggest = groups.reduce(
    (best, group) => (group.net < 0 && (!best || group.net < best.net) ? group : best), null);

  return {
    count: groups.reduce((sum, group) => sum + group.entries.length, 0),
    thisMonth: byMonth.get(currentMonth)?.net || 0,
    average: Math.round(lastYear / 12),
    biggest,
    largestSpend: groups.reduce((max, group) => Math.max(max, group.spent - group.inflow), 0),
  };
}
