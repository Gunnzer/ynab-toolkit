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
