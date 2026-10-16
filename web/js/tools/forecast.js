// Upcoming bills and a cash forecast: what is due in the next few weeks,
// and whether each everyday account covers it.
//
// Two sources, in this order of trust:
//   - YNAB's own scheduled transactions, exactly as set up there
//   - regular charges and income spotted in your history (recurring.js),
//     only where no scheduled transaction already covers the same payee
// Amounts are milliunits; outflows negative, as in YNAB.

import { normalizePayee } from "./recurring.js";

// Accounts whose balance is actual money on hand. A credit card's balance
// is a debt, so a charge on it does not touch the cash forecast.
export const CASH_TYPES = new Set(["checking", "savings", "cash"]);

const DAY = 86400000;

/** YNAB's frequency names, in words. */
export const FREQUENCY_LABELS = {
  never: "Once", daily: "Daily", weekly: "Weekly", everyOtherWeek: "Every 2 weeks",
  twiceAMonth: "Twice a month", every4Weeks: "Every 4 weeks", monthly: "Monthly",
  everyOtherMonth: "Every 2 months", every3Months: "Every 3 months",
  every4Months: "Every 4 months", twiceAYear: "Twice a year", yearly: "Yearly",
  everyOtherYear: "Every 2 years",
};

export function dayNumber(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export function isoFromDay(day) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

function addMonths(iso, months, anchorDay) {
  const [y, m] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, last));
  return target.toISOString().slice(0, 10);
}

const MONTHLY = {
  monthly: 1, everyOtherMonth: 2, every3Months: 3, every4Months: 4,
  twiceAYear: 6, yearly: 12, everyOtherYear: 24,
};
const DAILY = { daily: 1, weekly: 7, everyOtherWeek: 14, every4Weeks: 28 };

/** Every date a YNAB frequency lands on, from `first` up to `until` (inclusive). */
export function occurrences(first, frequency, until) {
  const out = [];
  if (!first) return out;
  const anchor = Number(first.slice(8, 10));
  let date = first;
  for (let guard = 0; guard < 400 && date <= until; guard += 1) {
    out.push(date);
    if (!frequency || frequency === "never") break;
    if (DAILY[frequency]) {
      date = isoFromDay(dayNumber(date) + DAILY[frequency]);
    } else if (MONTHLY[frequency]) {
      date = addMonths(first, MONTHLY[frequency] * out.length, anchor);
    } else if (frequency === "twiceAMonth") {
      // YNAB's "twice a month": the same day, and 15 days on from it.
      const half = out.length % 2 === 1;
      date = half
        ? isoFromDay(dayNumber(addMonths(first, Math.floor(out.length / 2), anchor)) + 15)
        : addMonths(first, out.length / 2, anchor);
    } else {
      break;
    }
  }
  return out;
}

/**
 * Everything due between today and `days` days from now, oldest first.
 * Each event: { date, accountId, transferAccountId, payee, amount,
 * categoryId, source ("scheduled" | "expected"), how (a frequency or
 * cadence label), late (an expected one that is already past due) }.
 */
export function upcomingEvents({ scheduled = [], recurringOut = [], recurringIn = [], today, days }) {
  const until = isoFromDay(dayNumber(today) + days);
  const events = [];
  const covered = [];

  for (const s of scheduled) {
    if (s.deleted) continue;
    covered.push({ payee: normalizePayee(s.payee_name), amount: Math.abs(s.amount || 0) });
    for (const date of occurrences(s.date_next, s.frequency, until)) {
      if (date < today) continue;
      events.push({
        date,
        accountId: s.account_id,
        transferAccountId: s.transfer_account_id || null,
        payee: s.payee_name || "",
        amount: s.amount || 0,
        categoryId: s.category_id || null,
        // A split's categories are on its legs - kept so a per-person view
        // can take each person's share instead of crediting the whole bill
        // to whoever's account it is on.
        legs: (s.subtransactions || []).filter((leg) => !leg.deleted)
          .map((leg) => ({ categoryId: leg.category_id || null, amount: leg.amount || 0 })),
        source: "scheduled",
        how: s.frequency,
        late: false,
      });
    }
  }

  const isCovered = (item) => covered.some((c) => c.payee &&
    c.payee === normalizePayee(item.payee) &&
    Math.abs(c.amount - item.typical) <= Math.max(c.amount, item.typical) * 0.35);

  for (const item of [...recurringOut, ...recurringIn]) {
    if (item.stopped || isCovered(item)) continue;
    const sign = item.direction === "in" ? 1 : -1;
    let day = dayNumber(item.nextDate);
    const late = day < dayNumber(today);
    if (late) day = dayNumber(today);
    const step = Math.max(1, item.intervalDays || 30);
    for (let first = true; day <= dayNumber(until); day += step, first = false) {
      events.push({
        date: isoFromDay(day),
        accountId: item.accountId,
        transferAccountId: null,
        payee: item.payee,
        amount: sign * item.typical,
        categoryId: item.categoryId,
        // Which recurring charge this came from, for the same reason.
        recurringKey: item.key,
        source: "expected",
        how: item.cadenceLabel,
        late: late && first,
      });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) ||
    (b.amount > 0) - (a.amount > 0) || a.payee.localeCompare(b.payee));
  // A stable id, so a forecast line can be matched back to its event.
  events.forEach((event, index) => { event.index = index; });
  return events;
}

/**
 * Each everyday account (chequing, savings, cash) run forward through the
 * events that touch it: today's balance, the lowest it gets and when, the
 * balance at the end, and the first day it would go below zero. A
 * scheduled transfer moves money out of one account and into the other.
 */
export function forecastAccounts(accounts, events, { today }) {
  const out = [];
  for (const account of accounts || []) {
    if (account.deleted || account.closed || account.on_budget === false) continue;
    if (!CASH_TYPES.has(account.type)) continue;

    let balance = account.balance || 0;
    let low = balance;
    let lowDate = today;
    let firstNegative = balance < 0 ? today : null;
    const touched = [];
    for (const event of events) {
      let change = 0;
      if (event.accountId === account.id) change = event.amount;
      else if (event.transferAccountId === account.id) change = -event.amount;
      else continue;
      balance += change;
      touched.push({ ...event, change, balanceAfter: balance });
      if (balance < low) {
        low = balance;
        lowDate = event.date;
      }
      if (balance < 0 && !firstNegative) firstNegative = event.date;
    }
    out.push({
      id: account.id,
      name: account.name,
      type: account.type,
      start: account.balance || 0,
      low,
      lowDate,
      end: balance,
      firstNegative,
      events: touched,
    });
  }
  return out.sort((a, b) => a.low - b.low);
}
