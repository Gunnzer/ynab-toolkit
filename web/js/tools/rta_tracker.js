// RTA Tracker: history of Ready to Assign over time, and a best-effort
// explanation for why it moved between two snapshots.
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

/** "YYYY-MM" -> "YYYY-MM-01", the first day of that month. */
export function monthStartIso(monthString) {
  return `${String(monthString).slice(0, 7)}-01`;
}

/**
 * Transactions dated before the current month that are still true
 * uncategorized inflows (or outflows) rather than something already
 * accounted for elsewhere - these are what could plausibly have shifted
 * Ready to Assign since the last snapshot.
 *
 * category_id: null also appears on a split transaction's own parent
 * record (the category lives on each subtransaction instead - see
 * shared_expenses.js's gotcha for the same trap in a different tool), so
 * a transaction with subtransactions is not flagged even though its own
 * category_id reads null. Transfers carry category_id: null too but never
 * touch Ready to Assign on their own, so those are excluded as well.
 */
export function findFlaggedTransactions(transactions, currentMonthStart) {
  return (transactions || []).filter((transaction) => {
    if (transaction.deleted) return false;
    if (transaction.transfer_account_id) return false;
    if (transaction.category_id !== null) return false;
    if (transaction.subtransactions?.length) return false;
    return transaction.date < currentMonthStart;
  });
}

/** Sum of milliunit amounts, e.g. for a flagged-transaction list. */
export function sumAmount(transactions) {
  return (transactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);
}

/**
 * A plain-language explanation for an RTA move of deltaMilli, given
 * whichever flagged transactions were found in the same delta-synced
 * batch. `flaggedSum` is compared back against the actual delta as a
 * sanity check - if they don't match, something outside this batch (a
 * budgeted-amount edit, a category move, a transaction outside the delta
 * window) also played a part, and the summary says so rather than
 * pretending the flagged list is the whole story.
 */
export function buildAttribution(deltaMilli, flagged) {
  const flaggedSum = sumAmount(flagged);
  const lines = [...(flagged || [])]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .map((t) => ({
      id: t.id,
      date: t.date,
      payee: t.payee_name || "(no payee)",
      amount: t.amount,
    }));

  const explained = Math.abs(flaggedSum - deltaMilli) < 10; // within a cent
  let summary;
  if (!deltaMilli) {
    summary = flagged?.length
      ? "Ready to Assign did not change, but backdated transaction(s) were " +
        "found anyway - they may have offset each other."
      : "Ready to Assign did not change since the last snapshot.";
  } else if (!flagged?.length) {
    summary = "Ready to Assign moved, but no backdated or uncategorized " +
      "transactions were found to explain it - check for a budgeted-amount " +
      "change instead.";
  } else if (explained) {
    summary = `Fully explained by ${flagged.length} backdated/uncategorized ` +
      `transaction(s) dated before this month.`;
  } else {
    summary = `${flagged.length} backdated/uncategorized transaction(s) ` +
      `found, totalling $${(flaggedSum / 1000).toFixed(2)}, which does not ` +
      `fully account for the $${(deltaMilli / 1000).toFixed(2)} shift - ` +
      "something else (a budgeted amount edit, most likely) also moved it.";
  }

  return { summary, lines, flaggedSum, explained };
}

/**
 * One run's worth of work: compare the just-fetched RTA to the previous
 * snapshot, find what changed transaction-wise since the last delta sync,
 * and build the attribution. Pure and network-free - the caller does the
 * actual fetching and passes in what came back.
 */
export function buildSnapshot({
  month, toBeBudgeted, previousSnapshot, deltaTransactions, serverKnowledge,
}) {
  const currentMonthStart = monthStartIso(month);
  const flagged = findFlaggedTransactions(deltaTransactions, currentMonthStart);
  const delta = previousSnapshot
    ? toBeBudgeted - previousSnapshot.toBeBudgeted : null;
  const attribution = delta === null ? null : buildAttribution(delta, flagged);

  return {
    timestamp: Date.now(),
    month,
    toBeBudgeted,
    delta,
    flagged: attribution?.lines || [],
    flaggedSum: attribution?.flaggedSum ?? 0,
    summary: attribution?.summary ||
      "First snapshot - nothing to compare against yet.",
    serverKnowledge,
  };
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
        });
      }
    } else if (rtaIds.has(t.category_id)) {
      out.push({
        id: t.id, date: t.date, payee: t.payee_name || "",
        accountId: t.account_id, amount: t.amount, splitLeg: false,
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
export function reconstruct({ months, transactions, rtaIds }) {
  const list = (months || [])
    .filter((m) => !m.deleted)
    .map((m) => ({ ...m, key: monthKey(m.month) }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const inflows = readyToAssignInflows(transactions, rtaIds);
  const txIncome = sumByMonth(inflows);
  const uncategorized = uncategorizedTransactions(transactions);
  const uncategorizedSum = sumByMonth(uncategorized);
  const uncategorizedCount = new Map();
  for (const t of uncategorized) {
    const key = monthKey(t.date);
    uncategorizedCount.set(key, (uncategorizedCount.get(key) || 0) + 1);
  }

  const totalAssigned = list.reduce((sum, m) => sum + (m.budgeted || 0), 0);

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

  const findings = [];
  for (const row of rows) {
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
  inflows, previousInflows, uncategorized,
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

  causes.sort((a, b) => {
    if (a.kind === "uncategorized") return 1;
    if (b.kind === "uncategorized") return -1;
    return a.amount - b.amount;
  });

  const headline = previous
    ? `Ready to Assign went from ${money(previous.ynab)} to ${money(row.ynab)} ` +
      `(${row.change < 0 ? "" : "+"}${money(row.change)}).`
    : `Ready to Assign started at ${money(row.ynab)}.`;

  return {
    headline, causes, assignedIncreases, assignedTop, incomeDrops,
    overspent, overspentSum, uncategorizedInflows, uncategorizedInflowSum,
  };
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

  let incomeSeen = 0;
  for (const inflow of [...(inflows || [])].sort((a, b) => a.date.localeCompare(b.date))) {
    incomeSeen += inflow.amount;
    add({
      kind: "income", date: inflow.date, accountId: inflow.accountId,
      label: inflow.payee || "(no payee)",
      detail: inflow.splitLeg ? "Part of a split" : "",
      amount: inflow.amount,
    });
  }
  if (Math.abs(row.income - incomeSeen) >= 10) {
    add({
      kind: "reconcile",
      label: "Income YNAB counted that is not in the loaded transactions",
      amount: row.income - incomeSeen,
    });
  }

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

  if (deductsLater && row.assignedLater) {
    add({ kind: "later", label: "Already assigned in later months", amount: -row.assignedLater });
  }

  if (Math.abs(row.ynab - balance) >= 10) {
    add({ kind: "reconcile", label: "Difference to YNAB's own figure", amount: row.ynab - balance });
  }

  return { lines, endBalance: balance, matches: Math.abs(row.ynab - balance) < 10 };
}

/**
 * Earliest recorded snapshot showing a negative Ready to Assign, if any.
 * The month view can only say which month went negative (assigned amounts
 * carry no date), so a snapshot is the closest thing to an actual moment.
 */
export function firstNegativeSnapshot(snapshots) {
  return (snapshots || []).find((s) => s.toBeBudgeted < 0) || null;
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

