// Home's "Needs attention": every tool's warnings turned into one short,
// ordered list. Pure - the page gathers the facts, this decides what is
// worth saying and how loudly.

import { fmt } from "../money.js";

const LEVEL = { error: 0, warn: 1, info: 2 };

/** "2026-10-21" -> "Oct 21". */
function shortDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const names = (list, pick, limit = 3) => {
  const shown = list.slice(0, limit).map(pick).join(", ");
  return list.length > limit ? `${shown} and ${list.length - limit} more` : shown;
};

/**
 * Each fact is optional (a tool switched off, or its data not loaded,
 * simply has nothing to say). Returns alerts, most urgent first:
 * { key, level, title, detail, go, tab }. `go` is the page to open; `tab`
 * a Reports tab to open it on.
 */
export function buildAlerts({
  readyToAssign = null,
  overspent = [],
  pace = [],
  review = null,
  duplicateGroups = 0,
  recurring = null,
  forecast = null,
  settle = [],
} = {}) {
  const alerts = [];
  const add = (alert) => alerts.push(alert);

  if (readyToAssign !== null && readyToAssign < 0) {
    add({
      key: "rta", level: "error", go: "budget",
      title: `Ready to Assign is ${fmt(readyToAssign)}`,
      detail: "More is assigned than you have. RTA Tracker can show when and why.",
    });
  }

  if (overspent.length) {
    const total = overspent.reduce((sum, c) => sum + c.balance, 0);
    add({
      key: "overspent", level: "error", go: "budget",
      title: `${overspent.length} categor${overspent.length === 1 ? "y" : "ies"} overspent by ${fmt(-total)}`,
      detail: names(overspent, (c) => `${c.name} ${fmt(c.balance)}`),
    });
  }

  const negative = (forecast?.accounts || []).filter((a) => a.firstNegative);
  if (negative.length) {
    add({
      key: "cash", level: "error", go: "upcoming",
      title: `${names(negative, (a) => a.name, 2)} could go below zero`,
      detail: names(negative, (a) => `${a.name} reaches ${fmt(a.low)} around ${shortDate(a.lowDate)}`, 2) +
        ", from bills due before the next money comes in.",
    });
  }

  const runningOut = pace.filter((p) => p.willRunOut);
  if (runningOut.length) {
    add({
      key: "pace", level: "warn", go: "reports", tab: "budget",
      title: `${runningOut.length} categor${runningOut.length === 1 ? "y is" : "ies are"} on pace to run out this month`,
      detail: names(runningOut, (p) => `${p.name} short ${fmt(p.shortBy)}`),
    });
  }

  for (const cycle of settle) {
    add({
      key: `settle-${cycle.key}`, level: cycle.status === "possible" ? "info" : "warn", go: "splitsheet",
      title: cycle.status === "possible"
        ? `Check the settle up for ${cycle.label}`
        : `Settle up for ${cycle.label} not paid yet`,
      detail: cycle.status === "possible"
        ? `${cycle.who} - a payment for ${fmt(cycle.paid)} looks like it, but the amount is different.`
        : `${cycle.who}.`,
    });
  }

  if (review && (review.uncategorized || review.unapproved)) {
    const parts = [];
    if (review.uncategorized) parts.push(`${review.uncategorized} with no category`);
    if (review.unapproved) parts.push(`${review.unapproved} to approve`);
    add({
      key: "review", level: review.uncategorized ? "warn" : "info", go: "categorize",
      title: `${parts.join(", ")}`,
      detail: review.suggested
        ? `A category is suggested for ${review.suggested} of them from your history.`
        : "Waiting on you in YNAB.",
    });
  }

  if (duplicateGroups) {
    add({
      key: "duplicates", level: "warn", go: "duplicates",
      title: `${duplicateGroups} possible duplicate${duplicateGroups === 1 ? "" : "s"} in the last 30 days`,
      detail: "Same amount and payee within a few days of each other.",
    });
  }

  if (recurring?.priceUp?.length) {
    add({
      key: "price", level: "info", go: "reports", tab: "recurring",
      title: `${recurring.priceUp.length} subscription${recurring.priceUp.length === 1 ? "" : "s"} went up`,
      detail: names(recurring.priceUp, (r) => `${r.payee} ${fmt(r.priceUp.from)} to ${fmt(r.priceUp.to)}`),
    });
  }
  if (recurring?.fresh?.length) {
    add({
      key: "new", level: "info", go: "reports", tab: "recurring",
      title: `${recurring.fresh.length} new recurring charge${recurring.fresh.length === 1 ? "" : "s"}`,
      detail: names(recurring.fresh, (r) => `${r.payee} ${fmt(r.typical)}`),
    });
  }

  if (forecast?.dueSoon?.count) {
    add({
      key: "bills", level: "info", go: "upcoming",
      title: `${forecast.dueSoon.count} bill${forecast.dueSoon.count === 1 ? "" : "s"} due in the next 7 days`,
      detail: `${fmt(-forecast.dueSoon.total)} in all: ${names(forecast.dueSoon.items, (e) => e.payee)}.`,
    });
  }

  return alerts.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);
}
