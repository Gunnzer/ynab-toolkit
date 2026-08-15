// Shared Expenses: convert transactions in a shared category into a native
// YNAB split between two people.
//
// Ported from the desktop app, which was itself a port of the original
// splitter script. The arithmetic is unchanged: person 1 gets a rounded
// share and person 2 absorbs the remainder, so the two always sum back to
// the original total.

import { splitMilliunits } from "../money.js";

export function isComplete(rule) {
  return Boolean(rule.sharedId && rule.person1Id && rule.person2Id);
}

export function alreadySplit(transaction) {
  return (transaction.subtransactions || []).length > 0;
}

export function withinEndDate(date, endDate) {
  return !endDate || date <= endDate;
}

export function splitAmounts(total, person1Ratio) {
  return splitMilliunits(total, person1Ratio);
}

/**
 * Find every transaction the current rules would convert.
 * Writes nothing; drives both the preview and the apply step so what you
 * see is what gets sent.
 */
export function scan(transactions, rules, startDate, endDate, ratio, {
  skipAlreadySplit = true,
} = {}) {
  const bySharedId = new Map();
  for (const rule of rules) {
    if (isComplete(rule)) bySharedId.set(rule.sharedId, rule);
  }

  const result = {
    planned: [],
    skippedAlreadySplit: 0,
    skippedTransfers: 0,
    scanned: 0,
    // Every skipped transaction, not just its count, so a preview can show
    // exactly which ones and why - not just "N were skipped."
    skipped: [],
  };
  if (bySharedId.size === 0) return result;

  for (const transaction of transactions) {
    if (transaction.deleted) continue;
    if (startDate && transaction.date < startDate) continue;
    if (!withinEndDate(transaction.date, endDate)) continue;

    // A split transaction carries no category_id of its own - YNAB puts it
    // on each subtransaction instead - so this branches entirely on the
    // legs rather than trying a parent-level lookup that can never match.
    if (alreadySplit(transaction)) {
      const legMatches = (transaction.subtransactions || [])
        .map((sub, index) => ({ sub, index }))
        .filter(({ sub }) => !sub.deleted)
        .map(({ sub, index }) => ({ index, rule: bySharedId.get(sub.category_id) }))
        .filter(({ rule }) => rule);
      // Nothing on this split concerns any of the current rules at all.
      if (!legMatches.length) continue;

      result.scanned += 1;

      if (skipAlreadySplit) {
        result.skippedAlreadySplit += 1;
        result.skipped.push({ transaction, rule: legMatches[0].rule, reason: "already split" });
        continue;
      }

      // Split just the leg(s) sitting in a shared category - e.g. a dinner
      // paid in full by one person, already split between what a friend
      // transferred back and the genuinely shared portion, where only that
      // shared leg needs dividing between the two people. Any other leg is
      // carried through untouched (see splitLegPayload). Each matching leg
      // becomes its own planned item, keyed by legIndex so several legs on
      // one transaction preview and can be unticked separately, even
      // though applying them still has to be one write per transaction
      // (see applySplits).
      for (const { index, rule } of legMatches) {
        const legAmount = transaction.subtransactions[index].amount;
        const [person1Amount, person2Amount] = splitAmounts(legAmount, ratio);
        result.planned.push({ transaction, rule, person1Amount, person2Amount, legIndex: index });
      }
      continue;
    }

    const rule = bySharedId.get(transaction.category_id);
    if (!rule) continue;

    result.scanned += 1;

    // Transfers cannot carry a normal category, so a split write would be
    // rejected by YNAB. (A split transaction is never itself a transfer,
    // so this only applies to the plain, not-yet-split branch above.)
    if (transaction.transfer_account_id) {
      result.skippedTransfers += 1;
      result.skipped.push({ transaction, rule, reason: "transfer" });
      continue;
    }

    const [person1Amount, person2Amount] = splitAmounts(transaction.amount, ratio);
    result.planned.push({ transaction, rule, person1Amount, person2Amount });
  }

  result.planned.sort((a, b) => a.transaction.date.localeCompare(b.transaction.date));
  result.skipped.sort((a, b) => a.transaction.date.localeCompare(b.transaction.date));
  return result;
}

/** The exact body sent to YNAB to turn one transaction into a split. */
export function splitPayload(transaction, person1Amount, person2Amount, p1Cat, p2Cat) {
  return {
    id: transaction.id,
    account_id: transaction.account_id,
    date: transaction.date,
    payee_id: transaction.payee_id ?? null,
    memo: transaction.memo || "",
    cleared: transaction.cleared,
    approved: transaction.approved,
    flag_color: transaction.flag_color ?? null,
    category_id: null, // required for split transactions
    amount: transaction.amount, // keep the original total
    subtransactions: [
      { amount: person1Amount, memo: transaction.memo || "", category_id: p1Cat },
      { amount: person2Amount, memo: transaction.memo || "", category_id: p2Cat },
    ],
  };
}

/**
 * The exact body sent to YNAB to further split one or more legs of an
 * already-split transaction, leaving every other leg exactly as it was.
 *
 * YNAB's update endpoint will not let a split transaction's subtransactions
 * be patched at all once it already has any (same limitation documented on
 * restoreCreatePayload below), so this is a create body, not an update one
 * - the caller deletes the original first and creates this in its place.
 * `legItems` are the planned items (from scan(), each carrying a
 * `legIndex`) that were actually selected for this transaction; any leg not
 * among them is copied through unchanged.
 */
export function splitLegPayload(transaction, legItems) {
  const replaced = new Map(legItems.map((item) => [item.legIndex, item]));
  const subtransactions = [];
  (transaction.subtransactions || []).forEach((sub, index) => {
    if (sub.deleted) return;
    const item = replaced.get(index);
    if (!item) {
      subtransactions.push(
        { amount: sub.amount, category_id: sub.category_id, memo: sub.memo || "" });
      return;
    }
    subtransactions.push(
      { amount: item.person1Amount, memo: sub.memo || "", category_id: item.rule.person1Id },
      { amount: item.person2Amount, memo: sub.memo || "", category_id: item.rule.person2Id });
  });
  return {
    account_id: transaction.account_id,
    date: transaction.date,
    amount: transaction.amount,
    payee_id: transaction.payee_id ?? null,
    payee_name: transaction.payee_id ? null : (transaction.payee_name || null),
    memo: transaction.memo || "",
    cleared: transaction.cleared,
    approved: transaction.approved,
    flag_color: transaction.flag_color ?? null,
    category_id: null,
    subtransactions,
  };
}

/**
 * A fresh transaction with the original details - either a single category,
 * or (when the backup carries `subtransactions`) the exact original split,
 * legs and all.
 *
 * Confirmed against a real budget: YNAB's API does not remove
 * subtransactions from an already-split transaction, or change its
 * category while it stays split, via update - the write silently drops
 * those fields and keeps the split as it was. The only way back to a
 * single category (or, for a transaction that was already split before a
 * leg of it got further divided, back to that original split) is to
 * delete it and create a new transaction in its place.
 */
export function restoreCreatePayload(record) {
  const base = {
    account_id: record.accountId,
    date: record.date,
    amount: record.amount,
    payee_id: record.payeeId || null,
    payee_name: record.payeeId ? null : (record.payeeName || null),
    memo: record.memo || "",
    cleared: record.cleared,
    approved: record.approved,
    flag_color: record.flagColor ?? null,
  };
  if (record.subtransactions?.length) {
    return { ...base, category_id: null, subtransactions: record.subtransactions };
  }
  return { ...base, category_id: record.categoryId };
}

/** The pre-change state of a transaction, kept so it can be restored. */
export function backupRecord(transaction) {
  return {
    id: transaction.id,
    accountId: transaction.account_id,
    date: transaction.date,
    payeeId: transaction.payee_id ?? null,
    payeeName: transaction.payee_name || "",
    memo: transaction.memo || "",
    cleared: transaction.cleared,
    approved: transaction.approved,
    flagColor: transaction.flag_color ?? null,
    categoryId: transaction.category_id ?? null,
    amount: transaction.amount,
    // Only set when the original was already a split (see
    // splitLegPayload) - undo has to recreate the exact original legs,
    // not a single category, or whatever else was on the transaction
    // (a friend's repayment, say) would be lost.
    subtransactions: alreadySplit(transaction)
      ? transaction.subtransactions
        .filter((sub) => !sub.deleted)
        .map((sub) => ({ amount: sub.amount, category_id: sub.category_id, memo: sub.memo || "" }))
      : undefined,
  };
}

/**
 * Re-scan and split a previewed set into what is still valid and what moved.
 *
 * A preview can sit on screen for a while. Anything edited in YNAB in the
 * meantime should not be overwritten blindly.
 */
export function driftCheck(planned, freshTransactions, startDate, endDate, {
  skipAlreadySplit = true,
} = {}) {
  const rules = new Map();
  for (const item of planned) rules.set(item.rule.sharedId, item.rule);

  const fresh = scan(
    freshTransactions, [...rules.values()], startDate, endDate, 0.5,
    { skipAlreadySplit }
  );
  // Several planned items can share one transaction id (one per shared leg
  // of an already-split transaction - see scan()), so the id alone is not
  // a unique key here the way it is everywhere else.
  const keyOf = (item) => item.legIndex !== undefined
    ? `${item.transaction.id}:${item.legIndex}` : item.transaction.id;
  const current = new Map(fresh.planned.map((i) => [keyOf(i), i]));
  const legAmount = (transaction, legIndex) => transaction.subtransactions?.[legIndex]?.amount;

  const stillValid = [];
  const drifted = [];
  for (const item of planned) {
    const match = current.get(keyOf(item));
    const itemAmount = item.legIndex !== undefined
      ? legAmount(item.transaction, item.legIndex) : item.transaction.amount;
    if (!match) {
      drifted.push({ item, reason: "no longer matches" });
    } else if (
      (item.legIndex !== undefined
        ? legAmount(match.transaction, item.legIndex) : match.transaction.amount) !== itemAmount
    ) {
      drifted.push({ item, reason: "amount changed" });
    } else if (item.legIndex === undefined &&
      match.transaction.category_id !== item.transaction.category_id) {
      drifted.push({ item, reason: "category changed" });
    } else {
      // Use the freshly fetched transaction so the write carries YNAB's
      // current cleared/approved/memo values.
      stillValid.push({
        transaction: match.transaction,
        rule: item.rule,
        person1Amount: item.person1Amount,
        person2Amount: item.person2Amount,
        legIndex: item.legIndex,
      });
    }
  }
  return { stillValid, drifted };
}

/**
 * Convert each planned transaction, backing up the original first so an
 * interrupted run can still be undone.
 *
 * Several planned items can point at the same already-split transaction
 * (one per shared leg - see scan()); each previews and can be unticked
 * separately, but YNAB only accepts a split transaction's legs all at
 * once, so they are grouped back into a single write per transaction here.
 */
export async function applySplits(client, budgetId, planned, backups, {
  log = () => {}, shouldStop = () => false,
} = {}) {
  let changed = 0;
  let failed = 0;
  // Exactly the items that actually got written, for the caller to show a
  // "here's what just happened" review afterwards - counts alone do not
  // say which ones.
  const applied = [];

  const groups = new Map();
  for (const item of planned) {
    const list = groups.get(item.transaction.id) || [];
    list.push(item);
    groups.set(item.transaction.id, list);
  }

  for (const items of groups.values()) {
    if (shouldStop()) {
      log("Stopped.", "warn");
      break;
    }
    const { transaction } = items[0];
    const legItems = items.filter((item) => item.legIndex !== undefined);
    const alreadyBackedUp = backups.some((record) => record.id === transaction.id);

    try {
      if (legItems.length) {
        // Already split, and YNAB will not let an update patch the
        // subtransactions of a transaction that is already split - delete
        // and recreate instead, same mechanism undoFromBackup uses. That
        // gives the transaction a brand new id, so the backup is recorded
        // with THAT id, not the deleted original - a later Undo deletes
        // whatever currently holds the record, and "d1" would 404 once it
        // no longer exists.
        await client.deleteTransaction(budgetId, transaction.id);
        const created = await client.createTransactions(
          budgetId, [splitLegPayload(transaction, legItems)]);
        const newId = created?.transaction_ids?.[0] || null;
        if (!alreadyBackedUp) {
          const backup = backupRecord(transaction);
          if (newId) backup.id = newId;
          backups.push(backup);
        }
        for (const item of items) {
          changed += 1;
          applied.push({ ...item, transaction: { ...transaction, id: newId || transaction.id } });
          log(`  split ${transaction.date}  ${item.rule.name}`, "ok");
        }
      } else {
        if (!alreadyBackedUp) backups.push(backupRecord(transaction));
        const item = items[0];
        await client.updateTransaction(
          budgetId, transaction.id,
          splitPayload(transaction, item.person1Amount, item.person2Amount,
            item.rule.person1Id, item.rule.person2Id)
        );
        changed += 1;
        applied.push(item);
        log(`  split ${transaction.date}  ${item.rule.name}`, "ok");
      }
    } catch (error) {
      failed += items.length;
      log(`  FAILED ${transaction.date}: ${error.message}`, "error");
    }
  }
  return { changed, failed, applied };
}

/**
 * Restore transactions from the backup list.
 * ``ids`` limits the restore; anything not restored stays available.
 */
export async function undoFromBackup(client, budgetId, backups, {
  ids = null, log = () => {}, shouldStop = () => false,
} = {}) {
  const wanted = ids ? new Set(ids) : null;
  const targets = wanted ? backups.filter((r) => wanted.has(r.id)) : [...backups];
  const remaining = wanted ? backups.filter((r) => !wanted.has(r.id)) : [];

  let restored = 0;
  let failed = 0;
  // The records actually put back, each with the id of the transaction
  // that now holds them (delete-and-recreate means a new id), for the
  // caller to update its own cached copies with.
  const restoredRecords = [];

  for (const record of targets) {
    if (shouldStop()) {
      log("Stopped.", "warn");
      remaining.push(record);
      continue;
    }
    try {
      await client.deleteTransaction(budgetId, record.id);
      const created = await client.createTransactions(
        budgetId, [restoreCreatePayload(record)]);
      const newId = created?.transaction_ids?.[0] || null;
      restored += 1;
      restoredRecords.push({ ...record, newId });
      log(`  restored ${record.date}`, "ok");
    } catch (error) {
      failed += 1;
      remaining.push(record);
      log(`  FAILED ${record.id}: ${error.message}`, "error");
    }
  }
  return { restored, failed, remaining, restoredRecords };
}
