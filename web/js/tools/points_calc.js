// The Points tab's maths (at explicit user request, 2026-11-16: a points
// calculator "on its own tab and more detailed, like when booking flights
// with Aeroplan to see if it's good or when converting Amex points or using
// PC Optimum"). DOM-free; tested in tests/points_calc.test.js.

import { POINT_TYPES } from "./card_catalogue.js";
import { centsPerPoint, transferRatio } from "./card_rewards.js";

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * What a redemption gets per point. `cash` is what the same thing costs in
 * cash, `fees` what you still pay in cash on the points booking (Aeroplan's
 * taxes and fees), and `backRate` what paying cash on your best card would
 * earn (a fraction, 0.02 for 2%): paying cash earns that, using points does
 * not, so the fair value takes it off.
 *   { cents, fair, saved, verdict: "good" | "close" | "poor" | "" }
 */
export function redemption({ points, cash, fees = 0, backRate = 0, yours = 0 } = {}) {
  const p = Number(points);
  const saved = Number(cash) - (Number(fees) || 0);
  if (!(p > 0) || !(saved > 0)) return { cents: 0, fair: 0, saved: 0, verdict: "" };
  const cents = saved / p * 100;
  const fair = saved * (1 - Math.max(0, Number(backRate) || 0)) / p * 100;
  let verdict = "";
  if (yours > 0) verdict = fair >= yours ? "good" : fair >= yours * 0.85 ? "close" : "poor";
  return { cents: round2(cents), fair: round2(fair), saved: round2(saved), verdict };
}

/**
 * Where points that move elsewhere are best sent: each program they
 * transfer to, at your point values, and using them as they are (a
 * statement credit or travel at the program's standard value). Best first.
 *   [{ to, kind: "transfer" | "keep", ratio, points, worth }]
 */
export function transferOptions(from, amount, { values = {} } = {}) {
  const n = Number(amount) || 0;
  if (!POINT_TYPES[from] || n <= 0) return [];
  const options = [{
    to: from,
    kind: "keep",
    ratio: 1,
    points: n,
    // Used as they are: the program's own standard value, not a value
    // typed for points you plan to move.
    worth: round2(n * (Number(POINT_TYPES[from].cents) || 0) / 100),
  }];
  for (const to of Object.keys(POINT_TYPES[from].transfers || {})) {
    const ratio = transferRatio(from, to);
    if (!ratio) continue;
    options.push({ to, kind: "transfer", ratio, points: Math.floor(n * ratio), worth: round2(n * ratio * centsPerPoint(to, values) / 100) });
  }
  return options.sort((a, b) => b.worth - a.worth);
}

/** Point types that can be moved somewhere else. */
export function transferable() {
  return Object.keys(POINT_TYPES).filter((id) => Object.keys(POINT_TYPES[id].transfers || {}).length);
}

/**
 * A bonus redemption tier ("150,000 points for $225") against a balance:
 * its cents per point, how many times the balance covers it, what is left,
 * and how many more points the next one needs.
 */
export function tierPlan(balance, tierPoints, tierDollars) {
  const b = Math.max(0, Math.floor(Number(balance) || 0));
  const p = Math.floor(Number(tierPoints) || 0);
  const d = Number(tierDollars) || 0;
  if (p <= 0 || d <= 0) return null;
  const times = Math.floor(b / p);
  const left = b - times * p;
  return {
    cents: round2(d / p * 100),
    times,
    dollars: round2(times * d),
    left,
    short: left ? p - left : 0,
  };
}

/** Balances worth, at your point values: { rows: [{ points, balance, worth }], total }. */
export function balancesWorth(balances = {}, values = {}) {
  const rows = Object.entries(balances)
    .filter(([points, n]) => POINT_TYPES[points] && Number(n) > 0)
    .map(([points, n]) => ({ points, balance: Number(n), worth: round2(Number(n) * centsPerPoint(points, values) / 100) }));
  return { rows, total: round2(rows.reduce((s, r) => s + r.worth, 0)) };
}
