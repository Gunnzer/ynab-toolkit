// Recurring charges: subscriptions and bills, found by looking for the
// same payee charging a similar amount on a regular schedule.

export const CADENCES = [
  { key: "weekly", label: "Weekly", days: 7, min: 5, max: 9, perYear: 52 },
  { key: "biweekly", label: "Every 2 weeks", days: 14, min: 12, max: 16, perYear: 26 },
  { key: "monthly", label: "Monthly", days: 30, min: 25, max: 36, perYear: 12 },
  { key: "bimonthly", label: "Every 2 months", days: 61, min: 54, max: 68, perYear: 6 },
  { key: "quarterly", label: "Quarterly", days: 91, min: 80, max: 102, perYear: 4 },
  { key: "yearly", label: "Yearly", days: 365, min: 345, max: 385, perYear: 1 },
];

// Two charges from one payee more than this far apart in size are treated
// as different things (two subscriptions from the same company, say).
const AMOUNT_SPREAD = 0.35;
const LOOKBACK_DAYS = 460;

function dayNumber(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function isoFromDay(day) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The part of a payee name that stays the same from charge to charge:
 * lower case, anything after a "*" (card processors put order numbers
 * there) and runs of digits dropped.
 */
export function normalizePayee(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\*.*$/, "")
    .replace(/#?\d{3,}/g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cadenceFor(intervals) {
  const typical = median(intervals);
  const cadence = CADENCES.find((c) => typical >= c.min && typical <= c.max);
  if (!cadence) return null;
  const regular = intervals.filter((d) => d >= cadence.min && d <= cadence.max).length;
  return regular / intervals.length >= 0.75 ? cadence : null;
}

/**
 * Every recurring charge found in the last ~15 months, biggest yearly cost
 * first. Each: payee, cadence, the latest amount and the usual one, yearly
 * cost, last and next expected date, the most used category, and flags:
 *   priceUp   the latest charge is above the usual one (fixed-price only)
 *   varies    the amount moves around (a utility bill, not a subscription)
 *   isNew     first seen within the last three cycles
 *   stopped   overdue by more than half a cycle (and at least a week)
 */
export function findRecurring(transactions, { today }) {
  const todayDay = dayNumber(today);
  const byPayee = new Map();
  for (const t of transactions || []) {
    if (t.deleted || (t.amount || 0) >= 0) continue;
    // A transfer is money moving between your own accounts (a card
    // payment, a regular move to savings or investments), not a charge.
    if (t.transfer_account_id) continue;
    if (todayDay - dayNumber(t.date) > LOOKBACK_DAYS) continue;
    const key = normalizePayee(t.payee_name);
    if (!key) continue;
    const list = byPayee.get(key) || [];
    list.push(t);
    byPayee.set(key, list);
  }

  const found = [];
  for (const list of byPayee.values()) {
    const clusters = [];
    for (const t of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
      const amount = -t.amount;
      const home = clusters.find((c) => Math.abs(amount - median(c.amounts)) <= median(c.amounts) * AMOUNT_SPREAD);
      if (home) {
        home.items.push(t);
        home.amounts.push(amount);
      } else {
        clusters.push({ items: [t], amounts: [amount] });
      }
    }

    for (const cluster of clusters) {
      const items = cluster.items;
      const days = items.map((t) => dayNumber(t.date));
      const intervals = days.slice(1).map((d, i) => d - days[i]).filter((d) => d > 0);
      if (!intervals.length) continue;
      const cadence = cadenceFor(intervals);
      if (!cadence) continue;
      if (items.length < (cadence.key === "yearly" ? 2 : 3)) continue;

      const amounts = cluster.amounts;
      const latest = amounts[amounts.length - 1];
      // A price increase is a step: a steady old price, then the latest
      // price held ever since. Found by walking back from the latest charge
      // while the amount stays the same, so a new price that has already
      // been charged a couple of times is still recognised as a step and
      // not mistaken for a bill that varies.
      let stepStart = amounts.length - 1;
      while (stepStart > 0 && Math.abs(amounts[stepStart - 1] - latest) <= latest * 0.01) stepStart -= 1;
      const before = amounts.slice(0, stepStart);
      const spreadOf = (list) => (list.length > 1
        ? (Math.max(...list) - Math.min(...list)) / (median(list) || 1) : 0);
      const steppedUp = before.length >= 2 && spreadOf(before) <= 0.1 &&
        latest - median(before) >= 500 && latest > median(before) * 1.02;
      const usual = Math.round(median(steppedUp ? before : amounts.slice(0, -1)));
      const varies = !steppedUp && spreadOf(amounts.slice(0, -1)) > 0.1;
      // A bill that varies (hydro, phone) comes monthly or less often.
      // Something weekly or fortnightly that varies is a shopping habit -
      // the same grocery store twice a month - not a recurring charge.
      if (varies && cadence.days < 25) continue;
      const typical = varies ? Math.round(amounts.slice(-3).reduce((a, b) => a + b, 0) /
        Math.min(3, amounts.length)) : latest;
      const lastDay = days[days.length - 1];
      const interval = Math.round(median(intervals));
      const overdue = todayDay - (lastDay + interval);

      const categories = new Map();
      for (const t of items) {
        if (t.category_id) categories.set(t.category_id, (categories.get(t.category_id) || 0) + 1);
      }
      const categoryId = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      found.push({
        key: `${normalizePayee(items[0].payee_name)}|${usual}`,
        // "SPOTIFY*P2A1B3" reads as just "SPOTIFY".
        payee: String(items[items.length - 1].payee_name || "").split("*")[0].trim(),
        cadence: cadence.key,
        cadenceLabel: cadence.label,
        count: items.length,
        firstDate: items[0].date,
        lastDate: items[items.length - 1].date,
        nextDate: isoFromDay(lastDay + interval),
        latest,
        usual,
        typical,
        yearly: typical * cadence.perYear,
        varies,
        // Only while the new price is recent - a rise from a year ago is just the price now.
        priceUp: steppedUp && amounts.length - stepStart <= 3 ? { from: usual, to: latest } : null,
        isNew: todayDay - days[0] <= interval * 3 + 7,
        stopped: overdue > Math.max(7, interval / 2),
        categoryId,
        transactionIds: items.map((t) => t.id),
      });
    }
  }
  return found.sort((a, b) => Number(a.stopped) - Number(b.stopped) || b.yearly - a.yearly);
}

/** Yearly and monthly cost of everything still active. */
export function recurringTotals(found) {
  const yearly = found.filter((r) => !r.stopped).reduce((sum, r) => sum + r.yearly, 0);
  return { yearly, monthly: Math.round(yearly / 12) };
}
