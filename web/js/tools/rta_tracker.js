// RTA Tracker: Ready to Assign rebuilt month by month from YNAB's own
// figures, and a line-by-line explanation of each month.
//
// Ready to Assign is not scoped to the current month - it is a running
// total of every unbudgeted inflow since the budget started, carried
// forward. Backdating a transaction (importing a paycheque on the 5th but
// dating it for the prior pay period) makes YNAB recompute every month's
// rollover from that date forward, which shifts the current month's RTA
// even though the transaction itself lives in a past month and never shows
// up if you only look at the current month's own activity.

import { fmt as money } from "../money.js";

/** "YYYY-MM" for today, in the browser's local time. */
export function currentMonthString(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// ---------- reconstruction ----------
//
// Rebuilds Ready to Assign month by month from its parts: every inflow
// categorized to "Inflow: Ready to Assign" so far, minus everything
// assigned so far, and (depending on the budget, see deductsLater in
// reconstruct()) minus whatever is already assigned in a later month.
// Anything YNAB's own
// figure still differs by after that is reported as "other" rather than
// guessed at - cash overspending rolled into the next month is the usual
// cause, and the API has no field that separates cash from credit
// overspending, so it cannot be rebuilt exactly from here.

/** "YYYY-MM-DD" (or "YYYY-MM") -> "YYYY-MM". */
export function monthKey(date) {
  return String(date || "").slice(0, 7);
}

/**
 * Ids of the internal "Inflow: Ready to Assign" category (named "To be
 * Budgeted" in older budgets). Looked up by name inside YNAB's internal
 * group rather than hardcoded, since the id differs per budget.
 */
export function readyToAssignCategoryIds(categoryGroups) {
  const ids = new Set();
  for (const group of categoryGroups || []) {
    if (group.name !== "Internal Master Category") continue;
    for (const category of group.categories || []) {
      if (/^(inflow:|to be budgeted)/i.test(category.name || "")) ids.add(category.id);
    }
  }
  return ids;
}

/**
 * Every transaction (or split leg) categorized to Ready to Assign, as
 * flat `{ id, date, payee, accountId, amount, splitLeg }` entries. A split
 * parent's own category_id is null, so its legs are read instead.
 */
export function readyToAssignInflows(transactions, rtaIds) {
  const out = [];
  for (const t of transactions || []) {
    if (t.deleted) continue;
    const legs = (t.subtransactions || []).filter((s) => !s.deleted);
    if (legs.length) {
      for (const leg of legs) {
        if (!rtaIds.has(leg.category_id)) continue;
        out.push({
          id: t.id, date: t.date, payee: leg.payee_name || t.payee_name || "",
          accountId: t.account_id, amount: leg.amount, splitLeg: true,
          approved: t.approved !== false,
        });
      }
    } else if (rtaIds.has(t.category_id)) {
      out.push({
        id: t.id, date: t.date, payee: t.payee_name || "",
        accountId: t.account_id, amount: t.amount, splitLeg: false,
        approved: t.approved !== false,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Transactions with no category at all, not a transfer and not a split
 * parent. These never touch Ready to Assign - which is the problem when
 * one is actually a paycheque nobody categorized yet.
 */
export function uncategorizedTransactions(transactions) {
  return (transactions || []).filter((t) =>
    !t.deleted && !t.transfer_account_id && t.category_id === null &&
    !t.subtransactions?.some((s) => !s.deleted));
}

function sumByMonth(entries) {
  const out = new Map();
  for (const entry of entries) {
    const key = monthKey(entry.date);
    out.set(key, (out.get(key) || 0) + (entry.amount || 0));
  }
  return out;
}

/**
 * The month-by-month rebuild. `months` is YNAB's /months summary list
 * (`{ month, income, budgeted, to_be_budgeted, deleted }`); transactions
 * are only used to cross-check YNAB's own income figure and to flag
 * uncategorized money. Returns rows oldest first, plus the audit findings.
 */
export function reconstruct({ months, transactions, rtaIds, currentMonth = currentMonthString() }) {
  const all = (months || [])
    .filter((m) => !m.deleted)
    .map((m) => ({ ...m, key: monthKey(m.month) }))
    .sort((a, b) => a.key.localeCompare(b.key));

  // Money already assigned into a future month still comes out of this
  // month's Ready to Assign, so it stays in totalAssigned below - but the
  // future months themselves are not rebuilt, shown or audited. YNAB
  // returns months well past today, and auditing them only produced
  // findings about months that have not happened yet.
  const list = all.filter((m) => m.key <= currentMonth);
  const notFuture = (t) => monthKey(t.date) <= currentMonth;

  const inflows = readyToAssignInflows(transactions, rtaIds).filter(notFuture);
  const txIncome = sumByMonth(inflows);
  const uncategorized = uncategorizedTransactions(transactions).filter(notFuture);
  const uncategorizedSum = sumByMonth(uncategorized);
  const uncategorizedCount = new Map();
  for (const t of uncategorized) {
    const key = monthKey(t.date);
    uncategorizedCount.set(key, (uncategorizedCount.get(key) || 0) + 1);
  }

  const totalAssigned = all.reduce((sum, m) => sum + (m.budgeted || 0), 0);

  // Whether YNAB's per-month figure also subtracts money already assigned
  // in later months is decided from the budget's own numbers, not assumed:
  // whichever model leaves less unexplained across every month wins.
  let income = 0;
  let assigned = 0;
  let missWithout = 0;
  let missWith = 0;
  for (const m of list) {
    income += m.income || 0;
    assigned += m.budgeted || 0;
    const base = income - assigned;
    missWithout += Math.abs((m.to_be_budgeted || 0) - base);
    missWith += Math.abs((m.to_be_budgeted || 0) - (base - (totalAssigned - assigned)));
  }
  const deductsLater = missWith < missWithout;

  let cumIncome = 0;
  let cumAssigned = 0;
  let previous = null;
  const rows = [];

  for (const m of list) {
    cumIncome += m.income || 0;
    cumAssigned += m.budgeted || 0;
    const assignedLater = totalAssigned - cumAssigned;
    const rebuilt = cumIncome - cumAssigned - (deductsLater ? assignedLater : 0);
    const ynab = m.to_be_budgeted || 0;
    const otherTotal = ynab - rebuilt;
    const transactionIncome = txIncome.get(m.key) || 0;

    const row = {
      month: m.key,
      income: m.income || 0,
      transactionIncome,
      incomeMatches: Math.abs(transactionIncome - (m.income || 0)) < 10,
      assigned: m.budgeted || 0,
      assignedLater,
      rebuilt,
      ynab,
      otherTotal,
      other: otherTotal - (previous ? previous.otherTotal : 0),
      change: previous ? ynab - previous.ynab : null,
      uncategorizedCount: uncategorizedCount.get(m.key) || 0,
      uncategorizedSum: uncategorizedSum.get(m.key) || 0,
      negative: ynab < 0,
      wentNegative: ynab < 0 && (!previous || previous.ynab >= 0),
      recovered: ynab >= 0 && Boolean(previous && previous.ynab < 0),
    };
    rows.push(row);
    previous = row;
  }

  return { rows, inflows, uncategorized, deductsLater, ...summarise(rows) };
}

/** Negative stretches, the low point, and a plain-language audit list. */
export function summarise(rows) {
  const stretches = [];
  let open = null;
  for (const row of rows) {
    if (row.negative && !open) open = { from: row.month, to: row.month, lowest: row.ynab };
    if (row.negative && open) {
      open.to = row.month;
      open.lowest = Math.min(open.lowest, row.ynab);
    }
    if (!row.negative && open) {
      stretches.push(open);
      open = null;
    }
  }
  if (open) stretches.push({ ...open, ongoing: true });

  const lowest = rows.reduce(
    (low, row) => (!low || row.ynab < low.ynab ? row : low), null);

  // Only months where Ready to Assign was below zero, at explicit user
  // request: an income mismatch or uncategorized transaction in a month
  // that stayed positive is noise next to finding why it went negative.
  const findings = [];
  for (const row of rows) {
    if (!row.negative) continue;
    if (row.wentNegative) {
      findings.push({
        month: row.month, kind: "negative",
        text: `Went negative (${money(row.ynab)}). Ready to Assign moved ` +
          `${money(row.change ?? row.ynab)} this month: income ${money(row.income)}, ` +
          `assigned ${money(row.assigned)}` +
          (row.other ? `, other ${money(row.other)}` : "") + ".",
      });
    }
    if (!row.incomeMatches) {
      findings.push({
        month: row.month, kind: "income",
        text: `YNAB reports ${money(row.income)} of Ready to Assign income, but ` +
          `the transactions categorized to it add up to ` +
          `${money(row.transactionIncome)}. Refresh, or check for a ` +
          "transaction dated in a different month than you expect.",
      });
    }
    if (Math.abs(row.other) >= 10) {
      findings.push({
        month: row.month, kind: "other",
        text: `${money(row.other)} moved Ready to Assign that is not income or ` +
          "an assigned amount - usually cash overspending from the month " +
          "before being taken out of Ready to Assign.",
      });
    }
    if (row.uncategorizedCount) {
      findings.push({
        month: row.month, kind: "uncategorized",
        text: `${row.uncategorizedCount} uncategorized transaction(s) totalling ` +
          `${money(row.uncategorizedSum)} - not counted in Ready to Assign ` +
          "until categorized. A paycheque left here makes it look short.",
      });
    }
  }

  return {
    stretches,
    lowest,
    firstNegative: rows.find((row) => row.negative) || null,
    currentlyNegative: Boolean(rows.length && rows[rows.length - 1].negative),
    findings,
  };
}

// ---------- why it went negative ----------

const TOP = 5;

/** "2026-07" -> "July 2026". Plain English, like the rest of this file's text. */
export function monthName(key) {
  const [year, month] = String(key).split("-").map(Number);
  const names = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  return names[month - 1] ? `${names[month - 1]} ${year}` : String(key);
}

function byPayee(entries) {
  const out = new Map();
  for (const entry of entries || []) {
    const payee = entry.payee || entry.payee_name || "(no payee)";
    out.set(payee, (out.get(payee) || 0) + (entry.amount || 0));
  }
  return out;
}

function assignable(categories) {
  return (categories || []).filter((c) =>
    !c.deleted && c.category_group_name !== "Internal Master Category" &&
    !/^(inflow:|to be budgeted|uncategorized)/i.test(c.name || ""));
}

/**
 * The concrete causes behind one month's move in Ready to Assign, worked
 * out by comparing it with the month before. The move always splits
 * exactly into income in, assigned out (net of anything already counted
 * against an earlier month - see deductsLater), and "other"; each part
 * that pulled it down is then broken out into the specific categories or
 * payees behind it.
 *
 * `categories`/`previousCategories` are the per-category lists from
 * YNAB's month detail for this month and the one before (the latter is
 * where last month's overspending shows up, as a negative balance - cash
 * and credit overspending look the same there, so it is offered as the
 * likely source of "other", not as proof).
 */
export function explainMonth({
  row, previous, deductsLater = false, categories, previousCategories,
  inflows, previousInflows, uncategorized, movements = [], today = localToday(),
}) {
  const assignedEffect = previous && deductsLater
    ? -(row.assigned + (row.assignedLater - previous.assignedLater))
    : -row.assigned;
  const leftOver = previous ? previous.ynab : 0;

  const before = new Map(assignable(previousCategories).map((c) => [c.id, c.budgeted || 0]));
  const current = assignable(categories);
  const assignedIncreases = current
    .map((c) => ({
      id: c.id, name: c.name, group: c.category_group_name || "",
      budgeted: c.budgeted || 0, previousBudgeted: before.get(c.id) || 0,
    }))
    .map((c) => ({ ...c, change: c.budgeted - c.previousBudgeted }))
    .filter((c) => c.change > 0)
    .sort((a, b) => b.change - a.change);
  const assignedTop = current
    .filter((c) => (c.budgeted || 0) > 0)
    .map((c) => ({ id: c.id, name: c.name, group: c.category_group_name || "", budgeted: c.budgeted }))
    .sort((a, b) => b.budgeted - a.budgeted);

  const nowByPayee = byPayee(inflows);
  const thenByPayee = byPayee(previousInflows);
  const incomeDrops = [...new Set([...thenByPayee.keys(), ...nowByPayee.keys()])]
    .map((payee) => ({
      payee, previous: thenByPayee.get(payee) || 0, current: nowByPayee.get(payee) || 0,
    }))
    .map((p) => ({ ...p, change: p.current - p.previous }))
    .filter((p) => p.change < 0)
    .sort((a, b) => a.change - b.change);

  const overspent = assignable(previousCategories)
    .filter((c) => (c.balance || 0) < 0)
    .map((c) => ({ id: c.id, name: c.name, group: c.category_group_name || "", balance: c.balance }))
    .sort((a, b) => a.balance - b.balance);
  const overspentSum = overspent.reduce((sum, c) => sum + c.balance, 0);

  const uncategorizedInflows = (uncategorized || [])
    .filter((t) => t.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const uncategorizedInflowSum = uncategorizedInflows.reduce((sum, t) => sum + t.amount, 0);

  const list = (items, label) => items.slice(0, TOP).map(label).join(", ") +
    (items.length > TOP ? `, and ${items.length - TOP} more` : "");

  const causes = [];
  const incomeChange = previous ? row.income - previous.income : null;

  if (previous && incomeChange < -9) {
    causes.push({
      kind: "income", amount: incomeChange,
      text: `${money(-incomeChange)} less income than ${monthName(previous.month)}: ` +
        `${money(row.income)} came in, against ${money(previous.income)} the month before.` +
        (incomeDrops.length ? ` Lower or missing: ${list(incomeDrops, (p) =>
          `${p.payee} (${money(p.current)}, was ${money(p.previous)})`)}.` : ""),
    });
  }

  if (assignedEffect < -9) {
    const assignedChange = previous ? row.assigned - previous.assigned : null;
    causes.push({
      kind: "assigned", amount: assignedEffect,
      text: `${money(row.assigned)} assigned this month` +
        (assignedChange > 9 ? `, ${money(assignedChange)} more than ${monthName(previous.month)}` : "") +
        `, against ${money(row.income)} income and ${money(leftOver)} left over.` +
        (previous && assignedIncreases.length
          ? ` Biggest increases: ${list(assignedIncreases, (c) =>
            `${c.name} +${money(c.change)}`)}.`
          : assignedTop.length
            ? ` Largest amounts: ${list(assignedTop, (c) => `${c.name} ${money(c.budgeted)}`)}.`
            : ""),
    });
  }

  const byWho = assignedByWho(movements);
  if (byWho.length) {
    causes.push({
      kind: "who", amount: 0,
      text: "Assigned by: " + byWho.map((w) =>
        `${w.who} ${money(w.assigned)} (${w.count} move${w.count === 1 ? "" : "s"})`).join(", ") + ".",
    });
  }

  if (deductsLater && row.assignedLater > 9) {
    causes.push({
      kind: "later", amount: -row.assignedLater,
      text: `${money(row.assignedLater)} is already assigned in later months, ` +
        "and counts against this month's Ready to Assign too.",
    });
  }

  if (row.other < -9) {
    causes.push({
      kind: "other", amount: row.other,
      text: `${money(-row.other)} taken out that is not income or an assigned amount.` +
        (overspent.length
          ? ` Most likely last month's overspending (${money(overspentSum)} in all): ` +
            `${list(overspent, (c) => `${c.name} ${money(c.balance)}`)}.`
          : " Nothing was overspent last month, so this may be a change YNAB " +
            "made to an earlier month."),
    });
  }

  if (previous && leftOver < 0) {
    causes.push({
      kind: "carried", amount: leftOver,
      text: `Already ${money(leftOver)} going into this month - it was negative before.`,
    });
  }

  if (uncategorizedInflowSum > 0) {
    const covers = row.ynab < 0 && uncategorizedInflowSum >= -row.ynab;
    causes.push({
      kind: "uncategorized", amount: uncategorizedInflowSum,
      text: `${money(uncategorizedInflowSum)} came in this month but is uncategorized, so ` +
        `it never reached Ready to Assign` + (covers ? " - enough to cover the gap on its own" : "") +
        `: ${list(uncategorizedInflows, (t) => `${t.payee_name || "(no payee)"} ${money(t.amount)}`)}.`,
    });
  }

  const backdatedInflows = (inflows || [])
    .map((inflow) => ({ inflow, flag: likelyBackdated(inflow, today) }))
    .filter((item) => item.flag);
  if (backdatedInflows.length) {
    const sum = backdatedInflows.reduce((total, item) => total + item.inflow.amount, 0);
    const oldest = Math.max(...backdatedInflows.map((item) => item.flag.days));
    causes.push({
      kind: "backdated", amount: sum,
      text: `${money(sum)} of this month's income is not approved yet but is dated up to ` +
        `${oldest} days ago - most likely imported late and backdated. YNAB counts it ` +
        "from its date, so until it actually came in, Ready to Assign was that much " +
        `lower than this shows: ${list(backdatedInflows,
          (item) => `${item.inflow.payee || "(no payee)"} ${money(item.inflow.amount)}`)}.`,
    });
  }

  // "who" sits right after the assigned line it breaks down; the
  // uncategorized and backdated ones go last, as warnings rather than causes.
  const rank = (c) => (c.kind === "uncategorized" || c.kind === "backdated" ? 2 : 0);
  causes.sort((a, b) => rank(a) - rank(b) || a.amount - b.amount);
  const whoIndex = causes.findIndex((c) => c.kind === "who");
  const assignedIndex = causes.findIndex((c) => c.kind === "assigned");
  if (whoIndex >= 0 && assignedIndex >= 0) {
    const [who] = causes.splice(whoIndex, 1);
    causes.splice(causes.findIndex((c) => c.kind === "assigned") + 1, 0, who);
  }

  const headline = previous
    ? `Ready to Assign went from ${money(previous.ynab)} to ${money(row.ynab)} ` +
      `(${row.change < 0 ? "" : "+"}${money(row.change)}).`
    : `Ready to Assign started at ${money(row.ynab)}.`;

  return {
    headline, causes, byWho, assignedIncreases, assignedTop, incomeDrops,
    overspent, overspentSum, uncategorizedInflows, uncategorizedInflowSum,
  };
}

/**
 * YNAB's money movements (an assignment, or money moved between two
 * categories) narrowed to the ones that actually change Ready to Assign:
 * money moved out of it into a category (assigning, effect negative) or
 * back into it (positive). A move between two ordinary categories leaves
 * Ready to Assign alone and is dropped. Ready to Assign shows up as a
 * null category id, or as the internal inflow category's own id -
 * either is accepted, since the API docs do not pin down which.
 * `categoryName`/`whoName` are lookups supplied by the caller.
 */
/**
 * A UTC timestamp as local "YYYY-MM-DDTHH:MM:SS". A money movement's
 * moved_at is UTC, so its first ten characters are the UTC date - an
 * evening assignment west of UTC read as the next day. The local form
 * also sorts correctly against a transaction's date, which is local.
 */
export function localStamp(iso) {
  const when = new Date(iso);
  if (!iso || Number.isNaN(when.getTime())) return String(iso || "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
}

// ---------- backdated income ----------
//
// YNAB's API has no "entered at" time for a transaction - only the date it
// carries - so income imported today but dated ten days ago looks, to
// Ready to Assign, as if it had been there all along. Nothing here moves
// it (there is no arrival time to move it to); it is only flagged. The one
// signal left in the data is approval: a fresh import sits unapproved until
// someone approves it, so unapproved income dated a few days back most
// likely only just arrived.

export const BACKDATED_MIN_DAYS = 3;

function localToday() {
  return localStamp(new Date().toISOString()).slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const utc = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(toIso) - utc(fromIso)) / 86400000);
}

/** `{ days }` (how far back it is dated) if an inflow looks backdated, else null. */
export function likelyBackdated(inflow, today = localToday()) {
  if (!inflow || inflow.approved !== false || !inflow.date) return null;
  const days = daysBetween(inflow.date, today);
  return days >= BACKDATED_MIN_DAYS ? { days } : null;
}

export function readyToAssignMovements(movements, { rtaIds = new Set(), categoryName, whoName }) {
  const isRta = (id) => !id || rtaIds.has(id);
  const out = [];
  for (const m of movements || []) {
    if (m.deleted) continue;
    const fromRta = isRta(m.from_category_id);
    const toRta = isRta(m.to_category_id);
    if (fromRta === toRta) continue;
    const categoryId = fromRta ? m.to_category_id : m.from_category_id;
    out.push({
      at: m.moved_at || "",
      month: monthKey(m.month),
      effect: fromRta ? -m.amount : m.amount,
      categoryId,
      category: categoryName ? categoryName(categoryId) : categoryId,
      userId: m.performed_by_user_id || null,
      who: whoName ? whoName(m.performed_by_user_id) : (m.performed_by_user_id || ""),
      note: m.note || "",
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Total assigned (net of anything moved back) per person, biggest first. */
export function assignedByWho(movements) {
  const out = new Map();
  for (const m of movements || []) {
    const entry = out.get(m.who) || { who: m.who, assigned: 0, count: 0 };
    entry.assigned -= m.effect;
    entry.count += 1;
    out.set(m.who, entry);
  }
  return [...out.values()].sort((a, b) => b.assigned - a.assigned);
}

/**
 * One month as a running ledger, line by line, ending exactly on YNAB's
 * own figure: what was left over, then (YNAB applies it on the 1st)
 * anything taken out for overspending, then each Ready to Assign inflow
 * by date, then each category's assigned amount. Assigned amounts carry
 * no date in YNAB, so they come after the month's income, in whatever
 * order `categories` is given (the page passes budget order) - the line
 * marked `wentNegative` is the assignment that no longer fit, not a
 * moment in time. Reconciling lines are added wherever the parts do not
 * add up to YNAB's own totals, so the last balance always matches.
 */
export function buildLedger({
  row, previous, deductsLater = false, categories, inflows, overspent = [],
  movements = [], today = localToday(),
}) {
  const lines = [];
  let balance = 0;
  const add = (line) => {
    const before = balance;
    balance += line.amount;
    lines.push({
      date: "", detail: "", ...line, balance,
      wentNegative: before >= 0 && balance < 0,
      recovered: before < 0 && balance >= 0,
    });
  };

  add({ kind: "start", label: "Left over from last month", amount: previous ? previous.ynab : 0 });
  if (deductsLater && previous && previous.assignedLater) {
    add({
      kind: "later",
      label: "Assigned to this month and later, already taken out last month",
      amount: previous.assignedLater,
    });
  }

  if (row.other) {
    add({
      kind: "other",
      label: "Overspending / other",
      detail: overspent.length
        ? `Overspent last month: ${overspent.slice(0, 5)
          .map((c) => `${c.name} ${money(c.balance)}`).join(", ")}` +
          (overspent.length > 5 ? `, and ${overspent.length - 5} more` : "")
        : "",
      amount: row.other,
    });
  }

  const sortedInflows = [...(inflows || [])].sort((a, b) => a.date.localeCompare(b.date));
  const incomeSeen = sortedInflows.reduce((sum, inflow) => sum + inflow.amount, 0);
  const incomeLine = (inflow) => ({
    kind: "income", date: inflow.date, accountId: inflow.accountId,
    label: inflow.payee || "(no payee)",
    detail: inflow.splitLeg ? "Part of a split" : "",
    amount: inflow.amount,
    backdated: likelyBackdated(inflow, today),
  });
  const incomeGap = Math.abs(row.income - incomeSeen) >= 10 ? {
    kind: "reconcile",
    label: "Income YNAB counted that is not in the loaded transactions",
    amount: row.income - incomeSeen,
  } : null;

  // With YNAB's own money movement history, assignments have a real time
  // and author, so income and assignments interleave in the order they
  // actually happened - the line marked wentNegative is then a moment,
  // not just "the assignment that no longer fit". A transaction has a
  // date but no time, so it sorts at the start of its day.
  const timed = movements.length > 0;
  if (timed) {
    const recorded = movements.reduce((sum, m) => sum - m.effect, 0);
    if (Math.abs(row.assigned - recorded) >= 10) {
      add({
        kind: "reconcile",
        label: "Assigned with no record (before YNAB kept history, or since undone)",
        amount: -(row.assigned - recorded),
      });
    }
    const events = [
      ...sortedInflows.map((inflow) => ({ key: `${inflow.date}T00:00`, line: incomeLine(inflow) })),
      ...movements.map((m) => ({
        key: localStamp(m.at),
        line: {
          kind: "movement", at: m.at, date: localStamp(m.at).slice(0, 10),
          // Money taken back out of a category reads the same as an
          // assignment apart from its sign, so it says what it is.
          label: m.effect > 0 ? `Moved back to Ready to Assign from ${m.category}` : m.category,
          movedBack: m.effect > 0,
          who: m.who, userId: m.userId,
          detail: m.note, amount: m.effect,
        },
      })),
    ].sort((a, b) => a.key.localeCompare(b.key));
    for (const event of events) add(event.line);
    if (incomeGap) add(incomeGap);
  } else {
    for (const inflow of sortedInflows) add(incomeLine(inflow));
    if (incomeGap) add(incomeGap);

    let assignedSeen = 0;
    for (const category of assignable(categories)) {
      if (!category.budgeted) continue;
      assignedSeen += category.budgeted;
      add({
        kind: "assigned",
        label: category.name,
        detail: category.category_group_name || "",
        amount: -category.budgeted,
      });
    }
    if (Math.abs(row.assigned - assignedSeen) >= 10) {
      add({
        kind: "reconcile",
        label: "Assigned in categories not listed (deleted or moved)",
        amount: -(row.assigned - assignedSeen),
      });
    }
  }

  if (deductsLater && row.assignedLater) {
    add({ kind: "later", label: "Already assigned in later months", amount: -row.assignedLater });
  }

  if (Math.abs(row.ynab - balance) >= 10) {
    add({ kind: "reconcile", label: "Difference to YNAB's own figure", amount: row.ynab - balance });
  }

  return { lines, timed, endBalance: balance, matches: Math.abs(row.ynab - balance) < 10 };
}

/** Rows as CSV, oldest first, for an external audit trail. */
export function reconstructionCsv(rows) {
  const header = [
    "Month", "Income", "Income (from transactions)", "Assigned",
    "Assigned in later months", "Rebuilt", "Other", "YNAB Ready to Assign",
    "Change", "Uncategorized count", "Uncategorized total",
  ];
  const d = (milli) => (milli / 1000).toFixed(2);
  const lines = rows.map((r) => [
    r.month, d(r.income), d(r.transactionIncome), d(r.assigned),
    d(r.assignedLater), d(r.rebuilt), d(r.otherTotal), d(r.ynab),
    r.change === null ? "" : d(r.change), r.uncategorizedCount, d(r.uncategorizedSum),
  ].join(","));
  return [header.join(","), ...lines].join("\n") + "\n";
}

