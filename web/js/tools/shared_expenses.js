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
 *
 * An already-split transaction is always skipped, never converted - YNAB's
 * API will not let its subtransactions be changed via update, and the only
 * alternative (delete + recreate) proved too fragile in practice (a real
 * production category-display bug traced back to it) to keep offering.
 */
export function scan(transactions, rules, startDate, endDate, ratio) {
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
    // on each subtransaction instead - so a plain lookup on the parent
    // never matches one, even when a leg sits in a shared category. Falling
    // back to the legs is what lets an already-split transaction be found
    // at all, so it can be reported and skipped rather than silently
    // invisible.
    if (alreadySplit(transaction)) {
      const legRule = (transaction.subtransactions || [])
        .filter((sub) => !sub.deleted)
        .map((sub) => bySharedId.get(sub.category_id))
        .find(Boolean);
      if (!legRule) continue;

      result.scanned += 1;
      result.skippedAlreadySplit += 1;
      result.skipped.push({ transaction, rule: legRule, reason: "already split" });
      continue;
    }

    const rule = bySharedId.get(transaction.category_id);
    if (!rule) continue;

    result.scanned += 1;

    // Transfers cannot carry a normal category, so a split write would be
    // rejected by YNAB.
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
 * A fresh, single-category transaction with the original details.
 *
 * Confirmed against a real budget: YNAB's API does not remove
 * subtransactions from an already-split transaction, or change its
 * category while it stays split, via update - the write silently drops
 * those fields and keeps the split as it was. The only way back to a
 * single category is to delete the split and create a new transaction in
 * its place.
 *
 * `record.subtransactions` is read here (not written by backupRecord()
 * below anymore) purely so a backup saved by an earlier version of this
 * tool - back when splitting a leg of an already-split transaction was
 * offered, and its Undo needed to restore a full split rather than one
 * category - still restores correctly instead of losing data.
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
  };
}

/**
 * Re-scan and split a previewed set into what is still valid and what moved.
 *
 * A preview can sit on screen for a while. Anything edited in YNAB in the
 * meantime should not be overwritten blindly.
 */
export function driftCheck(planned, freshTransactions, startDate, endDate) {
  const rules = new Map();
  for (const item of planned) rules.set(item.rule.sharedId, item.rule);

  const fresh = scan(freshTransactions, [...rules.values()], startDate, endDate, 0.5);
  const current = new Map(fresh.planned.map((i) => [i.transaction.id, i]));

  const stillValid = [];
  const drifted = [];
  for (const item of planned) {
    const match = current.get(item.transaction.id);
    if (!match) {
      drifted.push({ item, reason: "no longer matches" });
    } else if (match.transaction.amount !== item.transaction.amount) {
      drifted.push({ item, reason: "amount changed" });
    } else if (match.transaction.category_id !== item.transaction.category_id) {
      drifted.push({ item, reason: "category changed" });
    } else {
      // Use the freshly fetched transaction so the write carries YNAB's
      // current cleared/approved/memo values.
      stillValid.push({
        transaction: match.transaction,
        rule: item.rule,
        person1Amount: item.person1Amount,
        person2Amount: item.person2Amount,
      });
    }
  }
  return { stillValid, drifted };
}

/**
 * Convert each planned transaction, backing up the original first so an
 * interrupted run can still be undone.
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

  for (const item of planned) {
    if (shouldStop()) {
      log("Stopped.", "warn");
      break;
    }
    const { transaction, rule, person1Amount, person2Amount } = item;
    try {
      if (!backups.some((record) => record.id === transaction.id)) {
        backups.push(backupRecord(transaction));
      }
      await client.updateTransaction(
        budgetId, transaction.id,
        splitPayload(transaction, person1Amount, person2Amount,
          rule.person1Id, rule.person2Id)
      );
      changed += 1;
      applied.push(item);
      log(`  split ${transaction.date}  ${rule.name}`, "ok");
    } catch (error) {
      failed += 1;
      log(`  FAILED ${transaction.date} ${rule.name}: ${error.message}`, "error");
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
