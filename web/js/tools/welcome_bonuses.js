// Welcome bonuses: which card's sign-up offer is worth the most in its
// first year, and how a bonus you are working towards is going (at explicit
// user request, a separate tool under Card Rewards).
//
// The offers are data, in each card's `welcome` in web/data/cards.json
// (format at the top of card_catalogue.js), re-checked every week with the
// rest of the card details. Points are turned into dollars with the same
// cautious values as Card Rewards (centsPerPoint), so the two tools agree.

import { centsPerPoint } from "./card_rewards.js";

// What Chexy charges to put rent on a Canadian credit card (October 2026),
// for the "how much would it cost to close the gap with rent" line.
export const CHEXY_FEE = 0.0175;

const round2 = (n) => Math.round(n * 100) / 100;

/** The bonus in dollars: points at their value, plus any cash. */
export function bonusValue(card, values = {}) {
  const w = card?.welcome;
  if (!w) return 0;
  return round2((Number(w.points) || 0) * centsPerPoint(card.points, values) / 100 + (Number(w.cash) || 0));
}

/** What the first year costs: the offer's own first-year fee, else the card's. */
export function firstYearFee(card) {
  const fee = card?.welcome?.firstYearFee;
  return typeof fee === "number" ? fee : Number(card?.annualFee) || 0;
}

/**
 * Every card with a current welcome offer, best first-year value first:
 *   [{ card, value, fee, net, held }]
 * `net` is the bonus less the first year's fee. An offer whose `ends` is
 * before today is left out. `held` are card ids you already have.
 */
export function rankOffers(cards, { values = {}, held = [], today = "" } = {}) {
  const list = [];
  for (const card of cards || []) {
    const w = card?.welcome;
    if (!w) continue;
    if (w.ends && today && w.ends < today) continue;
    const value = bonusValue(card, values);
    const fee = firstYearFee(card);
    list.push({ card, value, fee, net: round2(value - fee), held: held.includes(card.id) });
  }
  return list.sort((a, b) => b.net - a.net || a.fee - b.fee || a.card.name.localeCompare(b.card.name));
}

function parse(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return { y, m, d };
}

function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The same day `months` later, pulled back to the month's end (Jan 31 + 1 = Feb 28). */
export function addMonths(date, months) {
  const { y, m, d } = parse(date);
  const index = (m - 1) + months;
  const year = y + Math.floor(index / 12);
  const month = (index % 12 + 12) % 12 + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return iso(year, month, Math.min(d, last));
}

/** Whole days from one date to another (negative when `to` is earlier). */
export function daysBetween(from, to) {
  const a = parse(from);
  const b = parse(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

/**
 * How a bonus you are working towards is going, on `today`:
 *   { spent, minSpend, left, pct, deadline, daysLeft, perDay, status, chexyFee }
 * The deadline is `months` after the day the card was opened. status is
 * "done" (spent enough), "missed" (past the deadline without it), "behind"
 * (spent less than an even pace would have by now) or "on-track".
 */
export function progress(tracked, today) {
  const minSpend = Math.max(0, Number(tracked?.minSpend) || 0);
  const spent = Math.max(0, round2(Number(tracked?.spent) || 0));
  const deadline = addMonths(tracked.opened, Math.max(1, Number(tracked?.months) || 1));
  const left = round2(Math.max(0, minSpend - spent));
  const daysLeft = daysBetween(today, deadline);
  const total = Math.max(1, daysBetween(tracked.opened, deadline));
  const elapsed = Math.min(total, Math.max(0, daysBetween(tracked.opened, today)));
  let status;
  if (left === 0) status = "done";
  else if (daysLeft < 0) status = "missed";
  else status = spent + 0.005 < minSpend * elapsed / total ? "behind" : "on-track";
  return {
    spent,
    minSpend,
    left,
    pct: minSpend ? Math.min(1, spent / minSpend) : 1,
    deadline,
    daysLeft,
    perDay: left && daysLeft >= 0 ? round2(left / (daysLeft + 1)) : 0,
    status,
    chexyFee: round2(left * CHEXY_FEE),
  };
}

/**
 * Spending on one account between two dates (inclusive), in dollars, from
 * YNAB transactions (milliunits): purchases count, refunds come off, and
 * transfers (paying the card off) are left out. Split legs are not needed,
 * since the parent carries the whole amount. Never below zero.
 */
export function spentOnAccount(transactions, accountId, since, until) {
  let milli = 0;
  for (const t of transactions || []) {
    if (t.deleted || t.account_id !== accountId || t.transfer_account_id) continue;
    if (t.date < since || (until && t.date > until)) continue;
    milli -= t.amount;
  }
  return Math.max(0, round2(milli / 1000));
}
